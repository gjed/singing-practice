import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Fixture {
  /** Path relative to the fixtures directory, without extension (`range/major-arpeggio`). */
  name: string;
  vexPath: string;
  jsonPath: string;
}

export interface FixtureContext {
  name: string;
  vexPath: string;
}

/** Turns the text of a `.vex` fixture into the value its `.json` file must hold. */
export type Transform = (source: string, ctx: FixtureContext) => unknown | Promise<unknown>;

export interface Discovery {
  /** One entry per `.vex` file; its `.json` may not exist yet. */
  fixtures: Fixture[];
  /** `.json` files with no `.vex` next to them (paths relative to the fixtures directory). */
  orphanJson: string[];
}

/** A settings file next to a fixture (`<name>.settings.json`) is an input, not an expected output. */
export const SETTINGS_SUFFIX = ".settings.json";

/** Pairs `<name>.vex` with `<name>.json` in a list of posix paths relative to the fixtures directory. */
export function pairFixtureFiles(paths: readonly string[], dir = ""): Discovery {
  const vex = new Set<string>();
  const json = new Set<string>();
  for (const path of paths) {
    if (path.endsWith(".vex")) vex.add(path.slice(0, -4));
    else if (path.endsWith(".json") && !path.endsWith(SETTINGS_SUFFIX)) json.add(path.slice(0, -5));
  }
  const fixtures = [...vex].sort().map((name) => ({
    name,
    vexPath: join(dir, `${name}.vex`),
    jsonPath: join(dir, `${name}.json`),
  }));
  const orphanJson = [...json]
    .filter((name) => !vex.has(name))
    .sort()
    .map((name) => `${name}.json`);
  return { fixtures, orphanJson };
}

function listFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? listFiles(join(dir, entry.name), rel) : [rel];
  });
}

export function discoverFixtures(dir: string): Discovery {
  return pairFixtureFiles(listFiles(dir), dir);
}

/** Round-trips through JSON so the comparison sees exactly what would be written to disk. */
export function normalize(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("Transform returned a value that is not JSON-serialisable");
  return JSON.parse(text);
}

export function serialize(value: unknown): string {
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

export function isUpdateMode(env: Record<string, string | undefined> = process.env): boolean {
  return env["UPDATE_GOLDEN"] === "1";
}

export type Outcome =
  | { status: "written" }
  | { status: "missing"; message: string }
  | { status: "compared"; actual: unknown; expected: unknown };

/** Runs one fixture. In update mode the expected file is (re)written instead of compared. */
export async function runFixture(
  fixture: Fixture,
  transform: Transform,
  update: boolean,
): Promise<Outcome> {
  const source = readFileSync(fixture.vexPath, "utf8");
  const actual = normalize(await transform(source, { name: fixture.name, vexPath: fixture.vexPath }));
  if (update) {
    writeFileSync(fixture.jsonPath, serialize(actual));
    return { status: "written" };
  }
  if (!existsSync(fixture.jsonPath)) {
    return {
      status: "missing",
      message: `Missing expected output ${fixture.jsonPath}; run UPDATE_GOLDEN=1 make test to create it`,
    };
  }
  const expected: unknown = JSON.parse(readFileSync(fixture.jsonPath, "utf8"));
  return { status: "compared", actual, expected };
}
