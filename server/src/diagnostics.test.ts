import { expect } from "chai";
import { makeCompilerArgs, searchForCppfrontInclude } from "./diagnostics";
import path = require("path");

describe("Diagnostics", () => {
  //
  //
  it("should generate a proper path", async () => {
    const actual = await searchForCppfrontInclude("cppfront");
    const expected = path.join("cppfront", "include");
    expect(actual).to.contain(expected);
  });

  //
  //
  it("should generate a proper cl.exe arguments", async () => {
    const source = "tempfile";
    const includePath = await searchForCppfrontInclude("cppfront");
    const expected = [
      "-EHsc",
      "-std:c++20",
      `-I${includePath}`,
      "-experimental:log",
      "test.cpp.sarif",
      source,
    ];
    const actual = await makeCompilerArgs(
      "test.cpp",
      "cl",
      includePath,
      source
    );
    expect(actual).to.deep.equal(expected);
  });
});
