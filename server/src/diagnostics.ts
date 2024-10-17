//------------------//
// Type Definitions //
//------------------//

import * as fs from "fs";
import { Position, TextDocument } from "vscode-languageserver-textdocument";
import { awaitExec, unuri } from "./util";
import { CompletionItemKind } from "vscode-languageserver";

/** The main container of diagnostics results from cppfront compilation */
type CppfrontResult = {
  symbols: CppfrontSymbol[];
  errors: CppfrontError[];
  scopes: CppfrontScopes;
};

/** The symbols declared in a cppfront diagnostics file */
type CppfrontSymbol = {
  symbol: string;
  kind: "function" | "var" | "type" | "namespace";
  scope: string;
  lineno: number;
  colno: number;
};

/** The error information from a cppfront diagnostics file */
type CppfrontError = {
  file: string;
  msg: string;
  symbol: string;
} & SourcePos;

/** Some position in the source code */
type SourcePos = {
  lineno: number;
  colno: number;
};

/** A range in the source code */
type SourceRange = {
  start: SourcePos;
  end: SourcePos;
};

/** A mapping of scopes to their source ranges */
type CppfrontScopes = {
  [key: string]: SourceRange;
};

//-----------------//
// Gen Diagnostics //
//-----------------//

/** The main function to read diagnostics from the cppfront diagnostics file */
export async function genDiagnostics(
  cppfrontPath: string,
  documentUri: string
) {
  // This might not be right, but for now, we remove the weird uri stuff and make it
  // back into a local file style reference. Otherwise, cppfront fails to read the file
  const sourceFile = unuri(documentUri);

  await runCppfront(cppfrontPath, sourceFile);
  return getDiagnostics(documentUri);
}

export async function getDiagnostics(uri: string) {
  const sourceFile = unuri(uri);
  const text = await readDiagnostics(sourceFile);
  return parseCppfrontDiagnostics(text);
}

/** Run Cppfront on the specified text document
 *
 * (This will be the one referenced by `validateTextDocument`)
 */
async function runCppfront(
  cppfrontPath: string,
  sourceFile: string
): Promise<{ stdout: string; stderr: string }> {
  // Finally, we run the file through cppfront. Diagnostics are written to file on disk
  try {
    const { stdout, stderr } = await awaitExec(
      `${cppfrontPath} ${sourceFile} -di -o stdout`
    );
    return { stdout, stderr };
  } catch (err: any) {
    return { stdout: "", stderr: err.toString() };
  }
}

/**
 * Read the diagnostics file, which is a slightly-ill-formatted json string
 * (to be fixed in cppfront later)
 */
async function readDiagnostics(sourceFile: string) {
  const file = `${sourceFile}-diagnostics`;

  const text = await fs.promises.readFile(file);
  return text.toString();
}

/**
 * Takes the text content of a diagnostics file and parses it into our main type
 * (Currently needs to remove trailing commas because cppfront emits the json wrong,
 * which is my own fault)
 */
function parseCppfrontDiagnostics(text: string): CppfrontResult {
  const fixedText = text.replace(/,\]/g, "]").replace(/,}/g, "}");
  const json = tryParseDiagnostics(fixedText);

  // console.log(json);
  return json;
}

/** Tries to parse the json or returns an empty CppFrontResult */
function tryParseDiagnostics(s: string): CppfrontResult {
  try {
    return JSON.parse(s);
  } catch (err) {
    console.log("Error parsing json", s, err);
    return { errors: [], symbols: [], scopes: {} };
  }
}

//----------------------------//
// Query Diagnostics for info //
//----------------------------//

/**
 * Query our diagnostics info for which scopes we have access to at `position`
 */
export function getInScopeSymbols(
  diagnostics: CppfrontResult,
  position: Position
) {
  // Grab all relevant scopes that our cursor position is in
  const scopes = Object.entries(diagnostics.scopes)
    .filter((s) => inScope(position, s[1]))
    .map((o) => o[0]);

  // Filter our total set of symbols to grab only those in scope + globals
  return diagnostics.symbols.filter(
    (s) => scopes.includes(s.scope) || s.scope == ""
  );
}

/** Check if the `pos` is in the scope of some `SourceRange` */
function inScope(pos: Position, scope: SourceRange): boolean {
  //
  // Seems like the language server's line variable is 0 based, so we need to add 1 to it to
  // get the correct line
  const line = pos.line + 1;

  return (
    //
    // If we're between the lines where the scope is defined, we're "in scope".
    (line > scope.start.lineno && line < scope.end.lineno) ||
    //
    // Otherwise, if we're on the line where the scope starts or ends, we need to check
    // that the character we're on is within the scope.
    (line == scope.start.lineno && pos.character >= scope.start.colno) ||
    (line == scope.end.lineno && pos.character <= scope.end.colno)
  );
}

/**
 * Translates from cppfront's symbol classification to the language server's classification
 */
export function getSymbolKind(symbol: CppfrontSymbol): CompletionItemKind {
  switch (symbol.kind) {
    case "function":
      return CompletionItemKind.Function;
    case "var":
      return CompletionItemKind.Variable;
    case "namespace":
      return CompletionItemKind.Module;
    case "type":
      return CompletionItemKind.TypeParameter;
    default:
      return CompletionItemKind.Text;
  }
}

//

/** Clears out diagnostic files */
export async function cleanDiagnosticsFile(textDocument: TextDocument) {
  const file = `${unuri(textDocument.uri)}-diagnostics`;
  await fs.promises.unlink(file);
}
