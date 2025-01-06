import { Position } from "vscode-languageserver-textdocument";

/**
 * Finds the symbol/identifier located at the current cursor position
 */
export function getSymbolTextAtPos(
  position: Position,
  text: string
): { symbol: string; start: number } {
  //
  // Break the text into seprate lines so we can grab the line we're looking at
  const lines = text.split(/\r?\n/g);
  const lineText = lines[position.line];

  // Guard against undefined errors
  //
  if (!lineText) return { symbol: "", start: -1 };

  // Find the beginning and end of the symbol/token we're on
  //
  // Note: we need to search one character further than where we're at, so we can
  // find a word when we're at the beginning of it - hence `position.character + 1`
  //
  const start = lineText.slice(0, position.character + 1).search(/\b\w+$/);
  const end = lineText.slice(position.character).search(/\W/);

  const symbol = lineText.slice(
    start,
    end === -1 ? undefined : position.character + end
  );

  return { symbol, start };
}
