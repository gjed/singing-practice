import { describe, expect, it } from "vitest";
import { parse } from "../src/index.js";
import { column, errorsOf, exerciseOf, itemsText, summary, withHeader } from "./parse-helpers.js";

// ---------------------------------------------------------------------------------------------------
// Conformance examples > Valid
// ---------------------------------------------------------------------------------------------------

const validRows: [string, string[]][] = [
  ["[I] 1 3 5 3 | 1:2 r:2", ["[I]", "1", "3", "5", "3", "|", "1:2", "r:2"]],
  [
    "[I] 1/ma 2/me 3/mi 4/mo 5/mu 4 3 2 | 1:2 r:2",
    ["[I]", "1/ma", "2/me", "3/mi", "4/mo", "5/mu", "4", "3", "2", "|", "1:2", "r:2"],
  ],
  ["[I] 1:1/2 8:1/2 5 3 | 1:2 r:2", ["[I]", "1:1/2", "8:1/2", "5", "3", "|", "1:2", "r:2"]],
  ["[I] 1~8:4 8~1:4 | r:4", ["[I]", "1~8:4", "8~1:4", "|", "r:4"]],
  ["5, 5' b3 #4 10", ["5,", "5'", "b3", "#4", "10"]],
  ["1:1/4 2:1/4 3:3/2", ["1:1/4", "2:1/4", "3:3/2"]],
  ["1~b3'/ng:2", ["1~b3'/ng:2"]],
  ["[I] 1 [V7:2] 5 [-] r", ["[I]", "1", "[V7:2]", "5", "[-]", "r"]],
  ["[ii7] 2 [viidim] 7", ["[ii7]", "2", "[viidim]", "7"]],
  [
    "{if speed=3} 1 2 3 4 5 4 3 2 1:2 {else} 1 3 5 3 1:2 {end}",
    [
      "IF speed=3",
      ...["1", "2", "3", "4", "5", "4", "3", "2", "1:2"],
      "ELSE",
      ...["1", "3", "5", "3", "1:2"],
      "END",
    ],
  ],
];

describe("conformance: valid pattern lines", () => {
  it.each(validRows)("%s", (line, items) => {
    const exercise = exerciseOf(withHeader(`${line}\n`, "{param: speed = 1..3}\n"));
    expect(itemsText(exercise.pattern)).toEqual(items);
  });

  it("keeps both branches of a conditional, with positions", () => {
    const line = "{if speed=3} 1 2 3 4 5 4 3 2 1:2 {else} 1 3 5 3 1:2 {end}";
    const [node] = exerciseOf(withHeader(`${line}\n`, "{param: speed = 1..3}\n")).pattern;
    if (node?.kind !== "conditional") throw new Error("expected a conditional");
    expect(node.then).toHaveLength(9);
    expect(node.else).toHaveLength(5);
    expect(node).toMatchObject({
      param: "speed",
      value: "3",
      ifSpan: { line: 3, column: 1, endColumn: 13 },
      elseSpan: { column: 34, endColumn: 40 },
      endSpan: { column: 53, endColumn: 58 },
      span: { line: 3, column: 1, endLine: 3, endColumn: 58 },
    });
  });

  it("reads glide, syllable and duration of one note", () => {
    const [note] = exerciseOf(withHeader("1~b3'/ng:2\n")).pattern;
    expect(note).toMatchObject({
      kind: "note",
      pitch: { alter: 0, degree: 1, octave: 0 },
      glideTo: { alter: -1, degree: 3, octave: 1 },
      syllable: "ng",
      duration: { numerator: 2, denominator: 1 },
    });
  });

  it("gives a note without a duration one beat", () => {
    const [note] = exerciseOf(withHeader("1\n")).pattern;
    expect(note).toMatchObject({ duration: { numerator: 1, denominator: 1 } });
    expect(note).not.toHaveProperty("duration.span");
  });

  it("accepts bar lines that touch their neighbours, and empty bars", () => {
    expect(itemsText(exerciseOf(withHeader("|3|1||r|\n")).pattern)).toEqual(["|", "3", "|", "1", "|", "|", "r", "|"]);
  });
});

const validDirectives = [
  "{defaults: start=A2 end=E4 tempo=120 direction=up-down}",
  "{defaults: start=C3 end=G4 tempo=100 step=+1 direction=up-down}",
  "{defaults: start=C3 end=C4 tempo=60 step=+2}",
  "{focus: range, warm-up}",
  "{param: scale = major | minor}",
  "{param: vowel = ah | eh | ee | oh | oo}",
  "{param: speed = 1..3}",
  "{vowel: ng}",
  "{cue: [I:2]}",
];

describe("conformance: valid directive lines", () => {
  it.each(validDirectives)("%s", (line) => {
    expect(errorsOf(withHeader("1\n", `${line}\n`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Conformance examples > Rejected
// ---------------------------------------------------------------------------------------------------

const rejectedRows: [source: string, code: string, line: number, column: number][] = [
  ["{meter: 4/4}", "invalid-value", 1, 10],
  ["[I] 1:0", "invalid-duration", 1, 6],
  ["1 2 3 11", "invalid-degree", 1, 7],
  ["1:2/ma", "expected-blank", 1, 4],
  ["[I]1 3", "expected-blank", 1, 4],
  ["1/2", "invalid-syllable", 1, 3],
  ["{if a=1} {if b=2} 1 {end} {end}", "nested-if", 1, 10],
  ["{title.en: Arpeggio}", "invalid-translation", 1, 7],
  ["{title: Siren", "unterminated", 1, 1],
  ["[V7:2", "unterminated", 1, 1],
  ["[bVII] 1", "invalid-chord", 1, 2],
  ["1 {title: x}", "misplaced-directive", 1, 3],
  ["{strudel: note(\"c e g\")}", "unknown-directive", 1, 2],
];

describe("conformance: rejected sources", () => {
  it.each(rejectedRows)("%s", (source, code, line, col) => {
    expect(errorsOf(source)).toEqual([`${code} ${line}:${col}`]);
  });

  it("rejects the conditional line under {meter: 4} at the {else}", () => {
    const source = "{title: T}\n{param: speed = 1..3}\n{meter: 4}\n{if speed=3} 1 2 3 4 5 4 3 2 1:2 {else} 1 3 5 3 1:2 {end}\n";
    const errors = parse(source).errors;
    expect(summary(errors)[0]).toBe(`bar-length 4:${column(source.split("\n")[3] ?? "", { find: "{else}" })}`);
  });

  it("accepts the same line written with bar lines", () => {
    const source = [
      "{title: T}",
      "{param: speed = 1..3}",
      "{meter: 4}",
      "{if speed=3} 1 2 3 4 | 5 4 3 2 | 1:2 r:2 {else} 1 3 5 3 | 1:2 r:2 {end}",
    ].join("\n");
    expect(errorsOf(source)).toEqual([]);
  });
});
