//------------------//
// Type Definitions //
//------------------//

import * as fs from "fs";
import * as os from "os";
import { Position, TextDocument } from "vscode-languageserver-textdocument";
import { awaitSpawn, isStringEmpty, tryUnlink, unuri } from "../util";
import { CompletionItemKind } from "vscode-languageserver";
import * as which from "which";
import * as sarif from "sarif";
import path = require("path");
import { glob } from "glob";
import { getSymbolTextAtPos } from "../symbol/symbol";

/** The main container of diagnostics results from cppfront compilation */
export type CppfrontResult = {
  symbols: CppfrontSymbol[];
  errors: CppfrontError[];
  cppErrors: CppfrontError[];
  scopes: CppfrontScopes;
};

/** The symbols declared in a cppfront diagnostics file */
export type CppfrontSymbol = {
  symbol: string;
  kind: "function" | "var" | "type" | "namespace";
  scope: string;
  lineno: number;
  colno: number;
};

/** The error information from a cppfront diagnostics file */
export type CppfrontError = {
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
  cppfrontIncludePath: string | null,
  cppCompilerPath: string,
  document: TextDocument
) {
  const diagnosticsFile = getDiagnosticsFilename(unuri(document.uri));

  const compileResult = await runCppfront(
    diagnosticsFile,
    cppfrontPath,
    document.getText()
  );

  await genCppDiagnostics(
    diagnosticsFile,
    cppfrontPath,
    cppCompilerPath,
    cppfrontIncludePath,
    compileResult.stdout
  );

  return getDiagnostics(document);
}

/**
 * Get the name of the diagnostics file for the given file
 *
 * **Note**:
 * This might not be right, but for now, we remove the weird uri stuff and make it
 * back into a local file style reference. Otherwise, cppfront fails to read the file
 */
const getDiagnosticsFilename = (fn: string) => `${fn}-diagnostics.json`;

/**
 * Given a document uri, parses the diagnostics files from cppfront and the cpp compiler
 * and returns the results for usage by the main language server
 */
export async function getDiagnostics(document: TextDocument) {
  //
  const sourceFile = unuri(document.uri);
  const diagnosticsFile = getDiagnosticsFilename(sourceFile);

  const cpp2Diagnostics = await parseCpp2Diagnostics(diagnosticsFile);
  const cppDiagnostics = await parseCppDiagnostics(`${diagnosticsFile}.sarif`);
  return combineDiagnostics(
    document,
    sourceFile,
    cpp2Diagnostics,
    cppDiagnostics
  );
}

/**
 * Augment our cpp2 diagnostics with the info results of the cpp compiler
 */
function combineDiagnostics(
  document: TextDocument,
  sourceFile: string,
  cpp2Diagnostics: CppfrontResult,
  cppDiagnostics: sarif.Log | null
) {
  if (!cppDiagnostics) return cpp2Diagnostics;
  const source = document.getText();

  // Loop through our cpp diagnostics and merge its errors with cpp2diagnostics
  //
  for (const d of cppDiagnostics.runs.flatMap((x) => x.results)) {
    if (!d) continue;

    const line = d.locations?.[0].physicalLocation?.region?.startLine;
    const col = d.locations?.[0].physicalLocation?.region?.startColumn;
    if (!line || !col) continue;

    // Some hacky workaround to try and approximate where the errors really are
    // in the cpp2 code.
    //
    const symbol = getSymbolTextAtPos(
      { line: Math.max(0, line - 1), character: col },
      source
    );

    // Finally, construct and push a new error to the set of cpp2 errors
    //
    // Note: We need to construct `cppErrors` before we start pushing to it.
    // The other fields of CppFrontResult are parsed from json, but this one isn't, so
    // it starts out initially as undefined
    //
    cpp2Diagnostics.cppErrors = [];
    cpp2Diagnostics.cppErrors.push({
      file: sourceFile,
      msg: d.message.markdown ?? d.message.text ?? "",
      symbol: symbol.symbol,
      lineno: line,
      colno: symbol.start == -1 ? col : symbol.start + 1,
    });
  }

  return cpp2Diagnostics;
}

//----------------------//
// Cppfront Diagnostics //
//----------------------//

async function parseCpp2Diagnostics(diagnosticsFile: string) {
  //
  const text = await fs.promises.readFile(diagnosticsFile);
  return tryParseDiagnostics(text.toString());
}

/** Run Cppfront on the specified text document
 *
 * (This will be the one referenced by `validateTextDocument`)
 */
async function runCppfront(
  diagnosticsFile: string,
  cppfrontPath: string,
  source: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    //
    // Run the source through cppfront. Diagnostics are written to `diagnosticsFile`
    const result = await awaitSpawn(
      `${cppfrontPath}`,
      ["-di", diagnosticsFile, "stdin", "-o", "stdout"],
      source
    );

    console.log(result);

    return { stdout: result, stderr: "" };
  } catch (err: any) {
    return { stdout: "", stderr: err.toString() };
  }
}

/**
 * Tries to parse the json or returns an empty CppFrontResult
 */
function tryParseDiagnostics(s: string): CppfrontResult {
  try {
    return JSON.parse(s);
  } catch (err) {
    console.log("Error parsing json", s, err);
    return { errors: [], cppErrors: [], symbols: [], scopes: {} };
  }
}

//-----------------//
// Cpp Diagnostics //
//-----------------//

/**
 * Compile generated cpp code and generate cpp diagnostics file
 */
async function genCppDiagnostics(
  fn: string,
  cppfrontPath: string,
  compilerPath: string,
  cppfrontIncludePath: string | null,
  cpp: string
): Promise<void> {
  //
  // Make sure we can compile our cpp file
  //
  if (isStringEmpty(compilerPath)) return;
  if (isStringEmpty(cppfrontIncludePath)) {
    cppfrontIncludePath = await searchForCppfrontInclude(cppfrontPath);
  }

  // Compile the cpp file and get the diagnostics
  //
  await runCppCompiler(fn, compilerPath, cppfrontIncludePath!, cpp);
}

/**
 * Parse the results of the cpp sarif file for use in diagnostics
 */
async function parseCppDiagnostics(
  sarifFile: string
): Promise<sarif.Log | null> {
  try {
    const text = await fs.promises.readFile(sarifFile);
    return JSON.parse(text.toString());
  } catch (err) {
    return null;
  }
}

/**
 * Generate the cppfront include path to use from the cppfront binary
 */
export async function searchForCppfrontInclude(
  cppfrontPath: string
): Promise<string> {
  const binaryPath = await which(cppfrontPath);
  return path.join(binaryPath, "..", "..", "include");
}

/**
 * Runs the main cpp compiler to get diagnostics
 */
async function runCppCompiler(
  fn: string,
  compilerPath: string,
  cppfrontIncludePath: string,
  source: string
) {
  const result = await tryRunCppCompiler(
    fn,
    compilerPath,
    cppfrontIncludePath,
    source
  );

  if (compilerPath.includes("clang")) {
    await fs.promises.writeFile(`${fn}.sarif`, result.stdout);
  }

  return { stdout: result, stderr: "" };
}

/**
 * Runs the main cpp compiler to get diagnostics
 */
async function tryRunCppCompiler(
  fn: string,
  compilerPath: string,
  cppfrontIncludePath: string,
  source: string
) {
  const tempSource = await writeTempFile(source);
  try {
    const args = makeCompilerArgs(
      fn,
      compilerPath,
      cppfrontIncludePath,
      tempSource
    );

    const result = await awaitSpawn(compilerPath, args);

    return { stdout: result, stderr: "" };
  } catch (err: any) {
    return { stdout: err.toString(), stderr: "" };
  } finally {
    await deleteTempFiles(tempSource);
  }
}

/**
 * Takes `contents` string and writes it to a temporary file
 *
 * For the case when we're using tools which can't receive their input from stdin
 * (I'm looking at you msvc...)
 */
async function writeTempFile(contents: string) {
  const tempPath = path.join(os.tmpdir(), `tempfile-${Date.now()}.cpp`);
  await fs.promises.writeFile(tempPath, contents);

  return tempPath;
}

/**
 * Delete all the temp files generated by the cpp compiler
 */
async function deleteTempFiles(fn: string) {
  // Delete the main temp file `fn`
  console.log("Deleting files:", fn);
  await tryUnlink(fn);

  // Glob for local compiler artifacts in the main directory and delete them
  const tempGlob = path.join(".", path.basename(fn.replace(".cpp", ".*")));
  const tempFiles = await glob.glob(tempGlob);
  tempFiles.forEach(async (f) => {
    await fs.promises.unlink(f);
  });
}

/**
 * Generate a list of compiler args based on the compiler used (msvc, clang, or gcc)
 */
export function makeCompilerArgs(
  fn: string,
  compilerPath: string,
  cppfrontIncludePath: string,
  source: string
): string[] {
  const sarif = `${fn}.sarif`;

  // Clang
  //
  if (compilerPath.includes("clang")) {
    return [
      "-std=c++20",
      `-I"${cppfrontIncludePath}"`,
      "-fdiagnostics-format=sarif",
      source,
    ];
  }
  // GCC
  //
  else if (compilerPath.includes("gcc") || compilerPath.includes("g++")) {
    return [
      "-std=c++20",
      `-I"${cppfrontIncludePath}"`,
      "-fdiagnostics-format=sarif-file",
      sarif,
      source,
    ];
  }
  // MSVC
  //
  else if (compilerPath.includes("cl")) {
    return [
      "-EHsc",
      "-std:c++20",
      `-I${cppfrontIncludePath}`,
      "-experimental:log",
      sarif,
      source,
    ];
  }

  return [];
}

//----------------------------//
// Query Diagnostics for info //
//----------------------------//

export function findSymbolByText(
  symbolText: string,
  diagnostics: CppfrontResult
) {
  return diagnostics.symbols.find((s) => s.symbol == symbolText);
}

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

//-------------------------------//
//-- Merge Diagnostics results --//
//-------------------------------//
/**
 * Merge our cached diagnostics result with the freshly generated diagnostics
 */
export function mergeDiagnostics(
  incoming: CppfrontResult,
  cached: CppfrontResult | null | undefined
): CppfrontResult {
  //
  // If we don't have a cache, return the new results
  //
  if (!cached) return incoming;

  // Update our cached errors with the new errors
  //
  cached.errors = incoming.errors;
  cached.cppErrors = incoming.cppErrors;

  // Only update the cache's symbols and scope if `incoming` doesn't have errors
  //
  if (incoming.errors.length > 0) {
    return cached;
  }

  cached.symbols = incoming.symbols;
  cached.scopes = incoming.scopes;

  return cached;
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
  const file = getDiagnosticsFilename(unuri(textDocument.uri));
  await tryUnlink(file);
  await tryUnlink(`${file}.sarif`);
}
