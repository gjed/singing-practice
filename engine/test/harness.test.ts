import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  discoverFixtures,
  isUpdateMode,
  normalize,
  pairFixtureFiles,
  runFixture,
  serialize,
} from "./golden.js";

// Scratch directories live inside the package (gitignored) rather than in the system temp directory.
const scratchRoot = fileURLToPath(new URL("./.tmp-scratch", import.meta.url));
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(join(scratchRoot, "run-"));
afterAll(() => rmSync(scratchRoot, { recursive: true, force: true }));

function fixtureDir(name: string, files: Record<string, string>): string {
  const dir = join(scratch, name);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const lineCount = (source: string) => ({ lines: source.split("\n").length - 1 });

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

  it("does not take a .settings.json for an expected output", () => {
    const { fixtures, orphanJson } = pairFixtureFiles(["a.vex", "a.json", "a.settings.json"]);
    expect(fixtures.map((f) => f.name)).toEqual(["a"]);
    expect(orphanJson).toEqual([]);
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

describe("discoverFixtures", () => {
  it("lists .vex files on disk, nested ones included, and flags a lone .json", () => {
    const dir = fixtureDir("discover", {
      "a.vex": "x\n",
      "a.json": "{}\n",
      "range/b.vex": "y\n",
      "stale.json": "{}\n",
    });
    const { fixtures, orphanJson } = discoverFixtures(dir);
    expect(fixtures.map((f) => f.name)).toEqual(["a", "range/b"]);
    expect(fixtures[1]?.jsonPath).toBe(join(dir, "range/b.json"));
    expect(orphanJson).toEqual(["stale.json"]);
  });

  it("treats a missing directory as empty", () => {
    expect(discoverFixtures(join(scratch, "does-not-exist"))).toEqual({ fixtures: [], orphanJson: [] });
  });
});

describe("runFixture", () => {
  const first = (dir: string) => discoverFixtures(dir).fixtures[0]!;

  it("compares the transform output with the expected JSON", async () => {
    const dir = fixtureDir("compare", { "f.vex": "a\nb\n", "f.json": '{ "lines": 99 }\n' });
    const outcome = await runFixture(first(dir), lineCount, false);
    expect(outcome).toEqual({ status: "compared", actual: { lines: 2 }, expected: { lines: 99 } });
  });

  it("reports a missing expected file without creating it", async () => {
    const dir = fixtureDir("missing", { "f.vex": "a\n" });
    const fixture = first(dir);
    const outcome = await runFixture(fixture, lineCount, false);
    expect(outcome.status).toBe("missing");
    expect(outcome.status === "missing" && outcome.message).toContain("UPDATE_GOLDEN=1");
    expect(() => readFileSync(fixture.jsonPath)).toThrow();
  });

  it("writes the expected file in update mode, creating or overwriting it", async () => {
    const dir = fixtureDir("update", { "f.vex": "a\nb\n", "f.json": '{ "lines": 99 }\n' });
    const fixture = first(dir);
    expect(await runFixture(fixture, lineCount, true)).toEqual({ status: "written" });
    expect(readFileSync(fixture.jsonPath, "utf8")).toBe('{\n  "lines": 2\n}\n');
    expect(await runFixture(fixture, lineCount, false)).toMatchObject({
      status: "compared",
      actual: { lines: 2 },
      expected: { lines: 2 },
    });
  });

  it("passes the source and fixture context to the transform", async () => {
    const dir = fixtureDir("context", { "r/f.vex": "src", "r/f.json": "{}" });
    const fixture = discoverFixtures(dir).fixtures[0]!;
    let seen: unknown;
    await runFixture(fixture, (source, ctx) => (seen = { source, ctx }), false);
    expect(seen).toEqual({ source: "src", ctx: { name: "r/f", vexPath: fixture.vexPath } });
  });
});
