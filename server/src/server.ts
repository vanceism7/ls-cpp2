/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
  DocumentDiagnosticReportKind,
  type DocumentDiagnosticReport,
  Position,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
      },
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log("Workspace folder change event received.");
    });
  }
});

// The example settings
interface ExampleSettings {
  cppfrontPath: string;
  clangdPath: string;
  maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = {
  maxNumberOfProblems: 1000,
  cppfrontPath: "cppfront",
  clangdPath: "clangd",
};
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear();
  } else {
    globalSettings = <ExampleSettings>(
      (change.settings.languageServerExample || defaultSettings)
    );
  }
  // Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
  // We could optimize things here and re-fetch the setting first can compare it
  // to the existing setting, but this is out of scope for this example.
  connection.languages.diagnostics.refresh();
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: "cppfront",
    });
    documentSettings.set(resource, result);
  }
  return result;
}

/** Clears out diagnostic files */
async function cleanDiagnosticsFile(textDocument: TextDocument) {
  const file = `${unuri(textDocument.uri)}-diagnostics`;
  await fs.promises.unlink(file);
}

// Only keep settings for open documents
documents.onDidClose((e) => {
  cleanDiagnosticsFile(e.document);
  documentSettings.delete(e.document.uri);
});

connection.languages.diagnostics.on(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (document !== undefined) {
    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: await validateTextDocument(document),
    } satisfies DocumentDiagnosticReport;
  } else {
    // We don't know the document. We can either try to read it from disk
    // or we don't report problems for it.
    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: [],
    } satisfies DocumentDiagnosticReport;
  }
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
  console.log("Change detected in: ", change.document.uri);
  validateTextDocument(change.document);
});

/**
 * Turns a uri into a local file path
 */
const unuri = (uri: string) => uri.replace("file:///", "").replace("%3A", ":");

/** Run Cppfront on the specified text document
 *
 * (This will be the one referenced by `validateTextDocument`)
 */
async function runCppfront(
  cppfrontPath: string,
  textDocument: TextDocument
): Promise<{ stdout: string; stderr: string }> {
  // Make exec awaitable
  const awaitExec = promisify(exec);

  // This might not be right, but for now, we remove the weird uri stuff and make it
  // back into a local file style reference. Otherwise, cppfront fails to read the file
  const uri = unuri(textDocument.uri);

  // Finally, we run the file through cppfront and get back the result in stdout and stderr
  try {
    const { stdout, stderr } = await awaitExec(
      `${cppfrontPath} ${uri} -di -o stdout`
    );
    return { stdout, stderr };
  } catch (err: any) {
    return { stdout: "", stderr: err.toString() };
  }
}

async function readDiagnostics(textDocument: TextDocument) {
  const file = `${unuri(textDocument.uri)}-diagnostics`;

  const text = await fs.promises.readFile(file);
  return text.toString();
}

type CppfrontError = {
  file: string;
  lineno: number;
  colno: number;
  msg: string;
  symbol: string;
};

type CppfrontSymbol = {
  symbol: string;
  kind: string;
  scope: string[];
  lineno: number;
  colno: number;
};

type CppfrontResult = {
  symbols: CppfrontSymbol[];
  errors: CppfrontError[];
};

function tryParseDiagnostics(s: string): CppfrontResult | null {
  try {
    return JSON.parse(s);
  } catch (err) {
    console.log("Error parsing json", s, err);
    return { errors: [], symbols: [] };
  }
}

function parseCppfrontErrors(errors: string): CppfrontResult {
  const fixedErrors = errors.replace(/,\]/g, "]");
  const json = tryParseDiagnostics(fixedErrors);

  console.log(json);
  return json ?? { errors: [], symbols: [] };
}

async function validateTextDocument(
  textDocument: TextDocument
): Promise<Diagnostic[]> {
  // In this simple example we get the settings for every validate run.
  const settings = await getDocumentSettings(textDocument.uri);

  await runCppfront(settings.cppfrontPath, textDocument);
  const stdout = await readDiagnostics(textDocument);

  const result = parseCppfrontErrors(stdout);
  const diagnostics: Diagnostic[] = [];

  for (const e of result.errors) {
    const line = Math.max(e.lineno - 1, 0);
    const column = Math.max(e.colno - 1, 0);
    const length = Math.max(e.symbol.length, 1);

    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(line, column),
        end: Position.create(line, column + length),
      },
      message: e.msg,
      source: e.file,
    };

    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  connection.console.log("We received a file change event");
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    // The pass parameter contains the position of the text document in
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
      {
        label: "TypeScript",
        kind: CompletionItemKind.Text,
        data: 1,
      },
      {
        label: "JavaScript",
        kind: CompletionItemKind.Text,
        data: 2,
      },
    ];
  }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  if (item.data === 1) {
    item.detail = "TypeScript details";
    item.documentation = "TypeScript documentation";
  } else if (item.data === 2) {
    item.detail = "JavaScript details";
    item.documentation = "JavaScript documentation";
  }
  return item;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
