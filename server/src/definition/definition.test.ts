import { expect } from "chai";
import { findSymbol, getSymbolTextAtPos } from "./definition";
import { CppfrontSymbol } from "../diagnostics/diagnostics";

describe("Definition", () => {
  //
  //
  it("should find the symbol text x", () => {
    const pos = { line: 0, character: 0 };
    const text = "x is the best\nWe are hello\nfreddie is cool\nWasa wasa?";

    const symbol = getSymbolTextAtPos(pos, text);
    expect(symbol).to.equal("x");
  });

  //
  //
  it("should find the symbol text x when its not at 0", () => {
    //
    // characters are 0 based, like most things in programming are
    const pos = { line: 0, character: 5 };
    const text =
      "this x is the best\nWe are hello\nfreddie is cool\nWasa wasa?";

    const symbol = getSymbolTextAtPos(pos, text);
    expect(symbol).to.equal("x");
  });

  //
  //
  it("should find the symbol text freddie", () => {
    const pos = { line: 1, character: 4 };
    const text = "We are hello\nfreddie is cool\nWasa wasa?";

    const symbol = getSymbolTextAtPos(pos, text);
    expect(symbol).to.equal("freddie");
  });

  //
  //
  it("should find the symbol text freddie when the cursor is at the end", () => {
    const pos = { line: 1, character: 6 };
    const text = "We are hello\nfreddie is cool\nWasa wasa?";

    const symbol = getSymbolTextAtPos(pos, text);
    expect(symbol).to.equal("freddie");
  });

  //
  //
  it("shouldn't find the symbol text freddie when the cursor is one past the end", () => {
    const pos = { line: 1, character: 7 };
    const text = "We are hello\nfreddie is cool\nWasa wasa?";

    const symbol = getSymbolTextAtPos(pos, text);
    expect(symbol).to.equal("");
  });
});
