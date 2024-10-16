//------------------//
// Type Definitions //
//------------------//

import * as fs from "fs";
import { TextDocument } from "vscode-languageserver-textdocument";
import { awaitExec, unuri } from "./util";

/** The main container of diagnostics results from cppfront compilation */
type CppfrontResult = {
  symbols: CppfrontSymbol[];
  errors: CppfrontError[];
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

//----------------//
// Main Functions //
//----------------//

/** The main function to read diagnostics from the cppfront diagnostics file */
export async function getDiagnostics(
  cppfrontPath: string,
  document: TextDocument
) {
  await runCppfront(cppfrontPath, document);
  const text = await readDiagnostics(document);

  return parseCppfrontDiagnostics(text);
}

/** Run Cppfront on the specified text document
 *
 * (This will be the one referenced by `validateTextDocument`)
 */
async function runCppfront(
  cppfrontPath: string,
  textDocument: TextDocument
): Promise<{ stdout: string; stderr: string }> {
  // This might not be right, but for now, we remove the weird uri stuff and make it
  // back into a local file style reference. Otherwise, cppfront fails to read the file
  const uri = unuri(textDocument.uri);

  // Finally, we run the file through cppfront. Diagnostics are written to file on disk
  try {
    const { stdout, stderr } = await awaitExec(
      `${cppfrontPath} ${uri} -di -o stdout`
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
async function readDiagnostics(textDocument: TextDocument) {
  const file = `${unuri(textDocument.uri)}-diagnostics`;

  const text = await fs.promises.readFile(file);
  return text.toString();
}

/**
 * Takes the text content of a diagnostics file and parses it into our main type
 * (Currently needs to remove trailing commas because cppfront emits the json wrong,
 * which is my own fault)
 */
function parseCppfrontDiagnostics(text: string): CppfrontResult {
  const fixedText = text.replace(/,\]/g, "]");
  const json = tryParseDiagnostics(fixedText);

  console.log(json);
  return json ?? { errors: [], symbols: [] };
}

/** Tries to parse the json or returns an empty CppFrontResult */
function tryParseDiagnostics(s: string): CppfrontResult | null {
  try {
    return JSON.parse(s);
  } catch (err) {
    console.log("Error parsing json", s, err);
    return { errors: [], symbols: [] };
  }
}

//

/** Clears out diagnostic files */
export async function cleanDiagnosticsFile(textDocument: TextDocument) {
  const file = `${unuri(textDocument.uri)}-diagnostics`;
  await fs.promises.unlink(file);
}
