import { describe, expect, it } from "vitest";
import { exerciseOf, withHeader } from "./parse-helpers.js";

// ---------------------------------------------------------------------------------------------------
// The AST
// ---------------------------------------------------------------------------------------------------

describe("the Exercise AST", () => {
  const full = [
    "{title: Siren}",
    "{title.it: Sirena}",
    "{description: Open the \\} vowel, then \\\\ slide}",
    '{description.it: Scivolo continuo su "ng"}',
    "{author: M. {Rossi\\}}",
    "{focus: range, lip trill}",
    "{technique: legato}",
    "{level: beginner}",
    "{voice: tenor}",
    "{defaults: voice=tenor tempo=90 speed=2}",
    "{param: scale = major | minor}",
    "{param: speed = 1..3}",
    "{vowel: ng}",
    "{cue: [V7:1/2]}",
    "{meter: 4}",
    "1 2 3 4",
  ].join("\n");

  it("collects every directive", () => {
    const exercise = exerciseOf(full);
    expect(exercise).toMatchObject({
      title: "Siren",
      description: "Open the } vowel, then \\ slide",
      author: "M. {Rossi}",
      translations: { title: { it: "Sirena" }, description: { it: 'Scivolo continuo su "ng"' } },
      facets: { focus: ["range", "lip trill"], technique: ["legato"], level: "beginner", voice: "tenor" },
      defaults: [
        { key: "voice", value: "tenor" },
        { key: "tempo", value: "90" },
        { key: "speed", value: "2" },
      ],
      params: [
        { kind: "options", name: "scale", values: ["major", "minor"] },
        { kind: "range", name: "speed", min: 1, max: 3 },
      ],
      vowel: "ng",
      cue: { kind: "chord", numeral: "V", degree: 5, quality: "7", duration: { numerator: 1, denominator: 2 } },
      meter: 4,
    });
    expect(exercise.directives.map((d) => [d.name, d.lang, d.span.line])).toEqual([
      ["title", undefined, 1],
      ["title", "it", 2],
      ["description", undefined, 3],
      ["description", "it", 4],
      ["author", undefined, 5],
      ["focus", undefined, 6],
      ["technique", undefined, 7],
      ["level", undefined, 8],
      ["voice", undefined, 9],
      ["defaults", undefined, 10],
      ["param", undefined, 11],
      ["param", undefined, 12],
      ["vowel", undefined, 13],
      ["cue", undefined, 14],
      ["meter", undefined, 15],
    ]);
  });

  it("allows blanks in a directive, and directives between pattern lines", () => {
    const exercise = exerciseOf("{ title : T }  \n1\n\t{  level:beginner}\n2");
    expect(exercise).toMatchObject({ title: "T", facets: { level: "beginner" } });
    expect(exercise.pattern).toHaveLength(2);
  });

  it("keeps the spans of items", () => {
    const [chord, note, bar] = exerciseOf("{title: T}\n  [I] 5,:2 |").pattern;
    expect(chord).toMatchObject({ span: { line: 2, column: 3, endLine: 2, endColumn: 6 } });
    expect(note).toMatchObject({
      pitch: { alter: 0, degree: 5, octave: -1, span: { column: 7, endColumn: 9 } },
      duration: { numerator: 2, span: { column: 9, endColumn: 11 } },
      span: { column: 7, endColumn: 11 },
    });
    expect(bar).toMatchObject({ kind: "bar", span: { column: 12, endColumn: 13 } });
  });

  it("has no {else} branch when the block has none", () => {
    const [node] = exerciseOf(withHeader("{if a=x} 1 {end}\n", "{param: a = x | y}\n")).pattern;
    expect(node).toMatchObject({ kind: "conditional", then: [{ kind: "note" }] });
    expect(node).not.toHaveProperty("else");
  });
});
