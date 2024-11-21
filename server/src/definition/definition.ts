import { Position, TextDocument } from "vscode-languageserver-textdocument";
import {
  TextDocumentPositionParams,
  TextDocuments,
} from "vscode-languageserver/node";
import {
  CppfrontSymbol,
  findSymbolByText,
  getCpp2Diagnostics,
  getInScopeSymbols,
  type CppfrontResult,
} from "../diagnostics/diagnostics";

/**
 * Finds the symbol/identifier located at the current cursor position
 */
export function getSymbolTextAtPos(position: Position, text: string): string {
  //
  // Break the text into seprate lines so we can grab the line we're looking at
  const lines = text.split(/\r?\n/g);
  const lineText = lines[position.line];

  // Find the beginning and end of the symbol/token we're on
  //
  // Note: we need to search one character further than where we're at, so we can
  // find a word when we're at the beginning of it - hence `position.character + 1`
  //
  const start = lineText.slice(0, position.character + 1).search(/\b\w+$/);
  const end = lineText.slice(position.character).search(/\W/);

  return lineText.slice(
    start,
    end === -1 ? undefined : position.character + end
  );
}

/** Finds a symbol within some set of text */
export function findSymbol(
  position: Position,
  symbols: CppfrontSymbol[],
  documentText: string
) {
  const symbolText = getSymbolTextAtPos(position, documentText);
  if (!symbolText) return null;

  const symbol = symbols.find((s) => s.symbol == symbolText);
  if (!symbol) return null;

  return symbol;
}

/** The main goto definition implementation */
export async function gotoDefinition(
  documents: TextDocuments<TextDocument>,
  params: TextDocumentPositionParams
) {
  const documentText = documents.get(params.textDocument.uri)?.getText();
  if (!documentText) return null;
  const diagnostics = await getCpp2Diagnostics(params.textDocument.uri);
  const inScopeSymbols = getInScopeSymbols(diagnostics, params.position);

  const symbol = findSymbol(params.position, inScopeSymbols, documentText);
  if (!symbol) return null;

  return {
    uri: params.textDocument.uri,
    range: {
      start: { line: symbol.lineno - 1, character: symbol.colno - 1 },
      end: {
        line: symbol.lineno - 1,
        character: symbol.colno + symbol.symbol.length - 1,
      },
    },
  };
}
