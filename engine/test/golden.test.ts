import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverFixtures, isUpdateMode, runFixture } from "./golden.js";
import { transform } from "./transform.js";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
const { fixtures, orphanJson } = discoverFixtures(fixturesDir);
const update = isUpdateMode();

describe("golden fixtures", () => {
  it("has a .vex for every expected .json", () => {
    expect(orphanJson, "expected .json files with no .vex beside them").toEqual([]);
  });

  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      const outcome = await runFixture(fixture, transform, update);
      if (outcome.status === "missing") expect.fail(outcome.message);
      if (outcome.status === "compared") expect(outcome.actual).toEqual(outcome.expected);
    });
  }
});
