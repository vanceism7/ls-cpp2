//------------------//
// Type Definitions //
//------------------//

import * as fs from "fs";
import { Position, TextDocument } from "vscode-languageserver-textdocument";
import { awaitExec, unuri } from "./util";

/** The main container of diagnostics results from cppfront compilation */
type CppfrontResult = {
  symbols: CppfrontSymbol[];
  errors: CppfrontError[];
  scopes: CppfrontScopes;
};

/** The symbols declared in a cppfront diagnostics file */
type CppfrontSymbol = {
  symbol: string;
  kind: string;
  scope: string[];
  lineno: number;
  colno: number;
};

/** The error information from a cppfront diagnostics file */
type CppfrontError = {
  file: string;
  lineno: number;
  colno: number;
  msg: string;
  symbol: string;
};

type SourcePos = {
  lineno: number;
  colno: number;
};

type SourceRange = {
  start: SourcePos;
  end: SourcePos;
};

type CppfrontScopes = {
  [key: string]: SourceRange;
};

//----------------//
// Main Functions //
//----------------//

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

export function inScope(pos: Position, scope: SourceRange) {
  console.log(pos, scope);
  return (
    pos.line > scope.start.lineno && pos.line <= scope.end.lineno
    // pos.character >= scope.start.colno &&
    // pos.character <= scope.end.colno
  );
}

//

/** Clears out diagnostic files */
export async function cleanDiagnosticsFile(textDocument: TextDocument) {
  const file = `${unuri(textDocument.uri)}-diagnostics`;
  await fs.promises.unlink(file);
}
