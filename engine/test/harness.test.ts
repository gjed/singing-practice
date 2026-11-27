import { describe, expect, it } from "vitest";
import { isUpdateMode, normalize, pairFixtureFiles, serialize } from "./golden.js";

describe("pairFixtureFiles", () => {
  it("pairs .vex with .json by name, including nested folders", () => {
    const { fixtures, orphanJson } = pairFixtureFiles(
      ["b.vex", "b.json", "range/a.vex", "range/a.json"],
      "fx",
    );
    expect(fixtures.map((f) => f.name)).toEqual(["b", "range/a"]);
    expect(fixtures[1]).toMatchObject({ vexPath: "fx/range/a.vex", jsonPath: "fx/range/a.json" });
    expect(orphanJson).toEqual([]);
  });

  it("keeps a .vex without .json as a fixture and reports a .json without .vex", () => {
    const { fixtures, orphanJson } = pairFixtureFiles(["new.vex", "stale.json", "notes.md"]);
    expect(fixtures.map((f) => f.name)).toEqual(["new"]);
    expect(orphanJson).toEqual(["stale.json"]);
  });

  it("finds nothing in an empty directory", () => {
    expect(pairFixtureFiles([])).toEqual({ fixtures: [], orphanJson: [] });
  });
});

describe("serialize", () => {
  it("writes two-space JSON with a trailing newline", () => {
    expect(serialize({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}\n');
  });

  it("drops what JSON drops, so comparison matches the file on disk", () => {
    expect(normalize({ a: undefined, b: 1 })).toEqual({ b: 1 });
  });

  it("rejects values JSON cannot represent", () => {
    expect(() => normalize(undefined)).toThrow(/not JSON-serialisable/);
  });
});

describe("isUpdateMode", () => {
  it("is on only for UPDATE_GOLDEN=1", () => {
    expect(isUpdateMode({ UPDATE_GOLDEN: "1" })).toBe(true);
    expect(isUpdateMode({ UPDATE_GOLDEN: "0" })).toBe(false);
    expect(isUpdateMode({})).toBe(false);
  });
});
