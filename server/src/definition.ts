import { Position, TextDocument } from "vscode-languageserver-textdocument";
import {
  TextDocumentPositionParams,
  TextDocuments,
} from "vscode-languageserver/node";
import {
  CppfrontSymbol,
  findSymbolByText,
  getDiagnostics,
  getInScopeSymbols,
  type CppfrontResult,
} from "./diagnostics/diagnostics";
import { getSymbolTextAtPos } from "./symbol/symbol";

/** Finds a symbol within some set of text */
export function findSymbol(
  position: Position,
  symbols: CppfrontSymbol[],
  documentText: string
) {
  const result = getSymbolTextAtPos(position, documentText);
  if (!result) return null;

  const symbol = symbols.find((s) => s.symbol == result.symbol);
  if (!symbol) return null;

  return symbol;
}

/** The main goto definition implementation */
export async function gotoDefinition(
  documents: TextDocuments<TextDocument>,
  params: TextDocumentPositionParams
) {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const diagnostics = await getDiagnostics(document);
  const inScopeSymbols = getInScopeSymbols(diagnostics, params.position);

  const symbol = findSymbol(
    params.position,
    inScopeSymbols,
    document.getText()
  );
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
