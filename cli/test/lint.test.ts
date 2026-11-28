import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "../vex.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const tree = path.join(here, "fixtures/tree");

function vex(argv: string[], root = tree) {
  let stdout = "";
  let stderr = "";
  const code = run(argv, { root, cwd: root, stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) });
  return { code, lines: stdout.split("\n").filter(Boolean), stderr };
}

describe("vex lint", () => {
  it("accepts clean files: no output, exit 0", () => {
    const result = vex(["lint", "exercises/range/01-clean.vex", "collections/clean.yaml"]);
    expect(result.lines).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("0 errors, 0 warnings\n");
  });

  it("reports missing translations as warnings and still exits 0", () => {
    const result = vex(["lint", "exercises/range/02-no-italian.vex"]);
    expect(result.lines).toEqual([
      "exercises/range/02-no-italian.vex:1:1: warning: missing title.it translation, the site falls back to English",
      "exercises/range/02-no-italian.vex:2:1: warning: missing description.it translation, the site falls back to English",
    ]);
    expect(result.code).toBe(0);
  });

  it("rejects facet values the vocabulary does not list", () => {
    const result = vex(["lint", "exercises/range/03-bad-facets.vex"]);
    expect(result.lines).toEqual([
      'exercises/range/03-bad-facets.vex:3:16: error: unknown focus value "falsetto" (known: warm-up, agility, range)',
      'exercises/range/03-bad-facets.vex:4:21: error: unknown technique value "whistle" (known: legato)',
      'exercises/range/03-bad-facets.vex:5:9: error: unknown level value "expert" (known: beginner)',
    ]);
    expect(result.code).toBe(1);
  });

  it("rejects a collection id with no exercise, at its YAML position", () => {
    const result = vex(["lint", "collections/bad-id.yaml"]);
    expect(result.lines).toEqual([
      'collections/bad-id.yaml:5:5: error: unknown exercise id "range/missing": no file under exercises/ has it',
      'collections/bad-id.yaml:6:9: error: unknown exercise id "warm-up/gone": no file under exercises/ has it',
    ]);
    expect(result.code).toBe(1);
  });

  it("passes parse errors through with their line and column", () => {
    const result = vex(["lint", "exercises/range/05-parse-error.vex"]);
    expect(result.lines).toEqual(["exercises/range/05-parse-error.vex:4:7: error: a degree is 1 to 10 without leading zeros"]);
    expect(result.code).toBe(1);
  });

  it("rejects a language the site does not ship", () => {
    expect(vex(["lint", "exercises/range/04-bad-language.vex"]).lines).toEqual([
      'exercises/range/04-bad-language.vex:3:7: error: language "fr" is not shipped by the site (en, it)',
    ]);
    expect(vex(["lint", "collections/bad-facet-and-language.yaml"]).lines).toEqual([
      "collections/bad-facet-and-language.yaml:1:1: warning: missing title.it translation, the site falls back to English",
      'collections/bad-facet-and-language.yaml:2:1: error: language "de" is not shipped by the site (en, it)',
      'collections/bad-facet-and-language.yaml:3:8: error: unknown level value "expert" (known: beginner)',
      "collections/bad-facet-and-language.yaml:6:5: error: an item needs an id or a pause",
    ]);
  });

  it("enforces the library policy: focus present, first focus is the folder, id shape", () => {
    expect(vex(["lint", "exercises/warm-up/01-wrong-folder.vex"]).lines).toEqual([
      'exercises/warm-up/01-wrong-folder.vex:3:9: error: the first focus value "range" decides the folder, but the file is in "warm-up/"',
    ]);
    expect(vex(["lint", "exercises/warm-up/02-no-focus.vex"]).lines).toEqual([
      "exercises/warm-up/02-no-focus.vex:1:1: error: missing {focus}: every library exercise needs at least one focus value",
    ]);
    expect(vex(["lint", "exercises/range/bad-name.vex"]).lines).toEqual([
      "exercises/range/bad-name.vex:1:1: error: a library exercise lives at exercises/<category>/NN-slug.vex, with a kebab-case category and slug",
    ]);
    expect(vex(["lint", "exercises/agility/02-twin.vex"]).lines).toEqual([
      'exercises/agility/02-twin.vex:1:1: error: exercise id "agility/twin" is also used by exercises/agility/01-twin.vex',
    ]);
  });

  it("reports YAML syntax errors with their position", () => {
    expect(vex(["lint", "collections/syntax-error.yaml"]).lines).toEqual([
      "collections/syntax-error.yaml:4:1: error: All mapping items must start at the same column",
    ]);
  });

  it("lints every exercise and collection when given no paths", () => {
    const result = vex(["lint"]);
    const files = new Set(result.lines.map((l) => l.split(":")[0]));
    expect(files).toEqual(
      new Set([
        "exercises/agility/01-twin.vex",
        "exercises/agility/02-twin.vex",
        "exercises/range/02-no-italian.vex",
        "exercises/range/03-bad-facets.vex",
        "exercises/range/04-bad-language.vex",
        "exercises/range/05-parse-error.vex",
        "exercises/range/bad-name.vex",
        "exercises/warm-up/01-wrong-folder.vex",
        "exercises/warm-up/02-no-focus.vex",
        "collections/bad-facet-and-language.yaml",
        "collections/bad-id.yaml",
        "collections/syntax-error.yaml",
      ]),
    );
    expect(result.code).toBe(1);
  });

  it("skips files that are neither exercises nor collections, and errors on missing ones", () => {
    expect(vex(["lint", "site/data/facets.yaml"]).lines).toEqual([]);
    expect(vex(["lint", "exercises/range/nope.vex"])).toMatchObject({
      lines: ["exercises/range/nope.vex:1:1: error: not a file"],
      code: 1,
    });
  });

  it("fails on a vocabulary file with a missing label, an unshipped language or a missing facet", () => {
    const result = vex(["lint"], path.join(tree, "bad-vocab"));
    expect(result.lines).toEqual([
      'site/data/facets.yaml:2:3: error: "range" has no it label',
      'site/data/facets.yaml:3:46: error: "fr" is not a shipped language',
      'site/data/facets.yaml:1:1: error: missing facet "voice": expected a map of values to labels',
    ]);
    expect(result.code).toBe(1);
  });

  it("prints usage and exits 2 for anything but lint", () => {
    expect(vex([]).code).toBe(2);
    expect(vex(["build"]).code).toBe(2);
    expect(vex(["lint", "--fix"]).code).toBe(2);
  });
});

describe("the vex executable", () => {
  const tsx = path.join(repo, "node_modules/.bin/tsx");
  const exec = (...args: string[]) => spawnSync(tsx, [path.join(repo, "cli/vex.ts"), ...args], { cwd: repo, encoding: "utf8" });

  it("exits 1 with errors on stdout", () => {
    const result = exec("lint", "cli/test/fixtures/tree/exercises/range/05-parse-error.vex");
    expect(result.stdout).toBe("cli/test/fixtures/tree/exercises/range/05-parse-error.vex:4:7: error: a degree is 1 to 10 without leading zeros\n");
    expect(result.status).toBe(1);
  });

  it("exits 0 when there are only warnings", () => {
    const result = exec("lint", "exercises/range/02-octave-jump.vex");
    expect(result.stdout).toBe(
      "exercises/range/02-octave-jump.vex:1:1: warning: missing title.it translation, the site falls back to English\n",
    );
    expect(result.status).toBe(0);
  });
});
