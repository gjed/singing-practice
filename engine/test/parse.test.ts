import { describe, expect, it } from "vitest";
import { parse } from "../src/index.js";
import type { Exercise, ParseError, PatternItem, Pitch } from "../src/index.js";

/** A column given as a number, or as the first (or last) place a string occurs in the source. */
type At = number | { find: string; last?: boolean };

function column(source: string, at: At): number {
  if (typeof at === "number") return at;
  const index = at.last ? source.lastIndexOf(at.find) : source.indexOf(at.find);
  if (index < 0) throw new Error(`"${at.find}" is not in the source`);
  return index + 1;
}

const summary = (errors: ParseError[]) => errors.map((e) => `${e.code} ${e.line}:${e.column}`);

function errorsOf(source: string): string[] {
  return summary(parse(source).errors);
}

function exerciseOf(source: string): Exercise {
  const result = parse(source);
  if (!result.ok) throw new Error(`expected a valid file, got ${summary(result.errors).join(", ")}`);
  return result.exercise;
}

const withHeader = (body: string, extra = "") => `{title: T}\n${extra}${body}`;

// ---------------------------------------------------------------------------------------------------
// Conformance examples > Valid
// ---------------------------------------------------------------------------------------------------

function pitchText(p: Pitch): string {
  const mark = p.octave < 0 ? ",".repeat(-p.octave) : "'".repeat(p.octave);
  return `${p.alter < 0 ? "b" : p.alter > 0 ? "#" : ""}${p.degree}${mark}`;
}

/** Writes the items back as compact text, from the AST fields rather than the source text. */
function itemsText(items: PatternItem[]): string[] {
  return items.flatMap((item): string[] => {
    const dur = (d: { numerator: number; denominator: number; span?: unknown }) =>
      d.span ? `:${d.numerator}${d.denominator === 1 ? "" : `/${d.denominator}`}` : "";
    switch (item.kind) {
      case "note":
        return [
          pitchText(item.pitch) +
            (item.glideTo ? `~${pitchText(item.glideTo)}` : "") +
            (item.syllable === undefined ? "" : `/${item.syllable}`) +
            dur(item.duration),
        ];
      case "rest":
        return [`r${dur(item.duration)}`];
      case "chord":
        return [`[${item.numeral}${item.quality}${item.duration ? dur(item.duration) : ""}]`];
      case "chord-off":
        return ["[-]"];
      case "bar":
        return ["|"];
      case "conditional":
        return [
          `IF ${item.param}=${item.value}`,
          ...itemsText(item.then),
          ...(item.else ? ["ELSE", ...itemsText(item.else)] : []),
          "END",
        ];
    }
  });
}

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

// ---------------------------------------------------------------------------------------------------
// Syntax errors beyond the conformance table
// ---------------------------------------------------------------------------------------------------

type Row = [source: string, code: string, at: At, line?: number];

function checkRows(rows: Row[]) {
  it.each(rows)("%j", (source, code, at, line = 1) => {
    const errors = errorsOf(source);
    expect(errors).toEqual([`${code} ${line}:${column(source.split("\n")[line - 1] ?? "", at)}`]);
  });
}

describe("syntax errors: lines and characters", () => {
  checkRows([
    ["R", "unexpected-character", 1],
    ["1 }", "unexpected-character", 3],
    ["{title: x} y", "unexpected-character", 12],
    ["{title: \u{1F600}} y", "unexpected-character", 13],
    ["1\u00a02", "expected-blank", 2],
    ["\u00a01", "unexpected-character", 1],
    ["{title: a\u0001b}", "unexpected-character", 10],
    ["1 \u0001", "unexpected-character", 3],
    ["{title: T}\r1", "unexpected-character", 11],
    ["1\r", "unexpected-character", 2],
    ["\uFEFF{meter: 4/4}", "invalid-value", 10],
  ]);

  it("reads \\r\\n line ends and a leading byte order mark", () => {
    const exercise = exerciseOf("\uFEFF{title: T}\r\n1 2\r\n\r\n3\r\n");
    expect(itemsText(exercise.pattern)).toEqual(["1", "2", "3"]);
    expect(exercise.pattern[0]).toMatchObject({ span: { line: 2, column: 1 } });
  });

  it("counts columns in UTF-16 code units and a tab as one", () => {
    expect(errorsOf("{title: T}\n\t1/😀")).toEqual(["invalid-syllable 2:4"]);
    expect(errorsOf("{title: T}\n\t\t1 x")).toEqual(["unexpected-character 2:5"]);
  });

  it("rejects a file over 65 536 bytes at 1:1, and accepts one of exactly that size", () => {
    const head = "{title: ";
    const exact = `${head}${"a".repeat(65_536 - head.length - 3)}}\n1`;
    expect(new TextEncoder().encode(exact).length).toBe(65_536);
    expect(errorsOf(exact)).toEqual([]);
    expect(errorsOf(`${exact} `)).toEqual(["file-too-large 1:1"]);
  });

  it("rejects a file of 3-byte characters over the limit by bytes, not characters", () => {
    expect(errorsOf(`{title: ${"€".repeat(21_845)}}\n1`)).toEqual(["file-too-large 1:1"]);
  });
});

describe("syntax errors: directives", () => {
  checkRows([
    ["{Title: x}", "unknown-directive", 2],
    ["{}", "unknown-directive", 2],
    ["{title}", "missing-value", 7],
    ["{title x}", "missing-value", 8],
    ["{title: }", "missing-value", 9],
    ["{title.it}", "missing-value", 10],
    ["{title.it x", "missing-value", 11],
    ["{title.english: x}", "invalid-translation", 7],
    ["{author.it: x}", "invalid-translation", 8],
    ["{focus.it: x}", "invalid-translation", 7],
    ["{title.en: x}", "invalid-translation", 7],
    ["{title: a\\xb}", "invalid-value", { find: "\\x" }],
    ["{title: a\\}", "unterminated", 1],
    ["{focus: Range}", "invalid-value", 9],
    ["{focus: a,}", "invalid-value", 11],
    ["{focus: a,,b}", "invalid-value", 11],
    ["{level: a, b}", "invalid-value", 10],
    ["{technique: lip  trill}", "invalid-value", { find: "trill" }],
    ["{focus: a\\b}", "invalid-value", { find: "\\" }],
    ["{vowel: a2}", "invalid-value", 10],
    ["{vowel: abcdefghijklmnopq}", "invalid-value", 9],
    ["{cue: I}", "invalid-value", 7],
    ["{cue: [I] x}", "invalid-value", 11],
    ["{cue: [-]}", "invalid-chord", 8],
    ["{cue: [I}", "unterminated", 7],
    ["{cue: [I x]}", "invalid-chord", 8],
    ["{meter: 0}", "invalid-value", 9],
    ["{meter: 17}", "invalid-value", 9],
    ["{meter: x}", "invalid-value", 9],
    ["{meter: 4 x}", "invalid-value", 11],
  ]);
});

describe("syntax errors: {defaults} and {param}", () => {
  checkRows([
    ["{defaults: tempo=500}", "invalid-value", { find: "500" }],
    ["{defaults: tempo=19}", "invalid-value", { find: "19" }],
    ["{defaults: tempo=1x0}", "invalid-value", { find: "x0" }],
    ["{defaults: tempo = 90}", "invalid-value", { find: " =" }],
    ["{defaults: tempo= 90}", "invalid-value", { find: " 90" }],
    ["{defaults: Tempo=90}", "invalid-value", 12],
    ["{defaults: tempo=90,}", "invalid-value", { find: "," }],
    ["{defaults: step=1}", "invalid-value", { find: "1}" }],
    ["{defaults: step=-1}", "invalid-value", { find: "-1" }],
    ["{defaults: step=+13}", "invalid-value", { find: "+13" }],
    ["{defaults: step=+0}", "invalid-value", { find: "+0" }],
    ["{defaults: direction=sideways}", "invalid-value", { find: "sideways" }],
    ["{defaults: direction=UP}", "invalid-value", { find: "UP" }],
    ["{defaults: cue=maybe}", "invalid-value", { find: "maybe" }],
    ["{defaults: voice=castrato}", "invalid-value", { find: "castrato" }],
    ["{defaults: count-in=0bar}", "invalid-value", { find: "0bar" }],
    ["{defaults: count-in=5bar}", "invalid-value", { find: "5bar" }],
    ["{defaults: count-in=1bars}", "invalid-value", { find: "s}" }],
    ["{defaults: count-in=1}", "invalid-value", { find: "}" }],
    ["{defaults: count-in=on}", "invalid-value", { find: "on" }],
    ["{defaults: start=H3}", "invalid-value", { find: "H3" }],
    ["{defaults: start=C}", "invalid-value", { find: "}" }],
    ["{defaults: start=C44}", "invalid-value", { find: "4}" }],
    ["{defaults: start=C-2}", "invalid-value", { find: "C-2" }],
    ["{defaults: end=G#9}", "invalid-value", { find: "G#9" }],
    ["{defaults: tuning=a\\b}", "invalid-value", { find: "\\" }],
    ["{param: Scale = a | b}", "invalid-value", 9],
    ["{param: 1a = a | b}", "invalid-value", 9],
    ["{param: a b = x | y}", "invalid-value", { find: "b =" }],
    ["{param: a x | y}", "invalid-value", { find: "x |" }],
    ["{param: a =}", "invalid-value", 12],
    ["{param: a = x}", "invalid-value", 14],
    ["{param: a = x | x}", "invalid-value", { find: "x}", last: true }],
    ["{param: a = x | }", "invalid-value", 16],
    ["{param: a = x | | y}", "invalid-value", { find: "| y" }],
    ["{param: a = x | Y}", "invalid-value", { find: "Y" }],
    ["{param: a = x y}", "invalid-value", { find: "y}" }],
    ["{param: scale = major | foo}", "invalid-value", { find: "foo" }],
    ["{param: scale = 1..3}", "invalid-value", { find: "1.." }],
    ["{param: speed = 3..1}", "invalid-value", { find: "1}" }],
    ["{param: speed = 2..2}", "invalid-value", { find: "2}" }],
    ["{param: speed = 1..100}", "invalid-value", { find: "100" }],
    ["{param: speed = 100..200}", "invalid-value", { find: "100" }],
    ["{param: speed = 1..}", "invalid-value", { find: "}" }],
    ["{param: speed = 1..3 | 4}", "invalid-value", { find: " | 4" }],
  ]);

  it("accepts the limits", () => {
    const extras = [
      "{defaults: tempo=20 step=+12 start=C-1 end=G9 count-in=4bar cue=off}",
      "{defaults: tempo=300 step=+1 voice=bass count-in=off}",
      "{param: speed = 0..99}",
      "{param: a = x | y | z-1 | 2}",
    ];
    for (const line of extras) expect(errorsOf(withHeader("1\n", `${line}\n`))).toEqual([]);
  });
});

describe("syntax errors: pattern items", () => {
  checkRows([
    ["1:8<>", "expected-blank", 4],
    ["1,,,,", "expected-blank", 5],
    ["1,'", "expected-blank", 3],
    ["5,3", "expected-blank", 3],
    ["1b3", "expected-blank", 2],
    ["rx", "expected-blank", 2],
    ["r5", "expected-blank", 2],
    ["1/ma3", "expected-blank", 5],
    ["1/ma/x", "expected-blank", 5],
    ["1~5~3", "expected-blank", 4],
    ["{if a=1}1 {end}", "expected-blank", 9],
    ["1~", "unexpected-character", 3],
    ["1~x", "unexpected-character", 3],
    ["b", "unexpected-character", 2],
    ["bx", "unexpected-character", 2],
    ["bb3", "unexpected-character", 2],
    ["0", "invalid-degree", 1],
    ["07", "invalid-degree", 1],
    ["11", "invalid-degree", 1],
    ["b0", "invalid-degree", 2],
    ["1~11", "invalid-degree", 3],
    ["1:", "invalid-duration", 2],
    ["1:x", "invalid-duration", 2],
    ["1:1/3", "invalid-duration", 2],
    ["1:2/1", "invalid-duration", 2],
    ["1:65", "invalid-duration", 2],
    ["1:129/2", "invalid-duration", 2],
    ["r:0", "invalid-duration", 2],
    ["[I:0]", "invalid-duration", 3],
    ["[I:1/3]", "invalid-duration", 3],
    ["1/", "invalid-syllable", 3],
    ["1/:2", "invalid-syllable", 3],
    ["1/\u0301a", "invalid-syllable", 3],
    ["1/abcdefghijklmnopq", "invalid-syllable", 3],
    ["[]", "invalid-chord", 2],
    ["[x]", "invalid-chord", 2],
    ["[VIII]", "invalid-chord", 2],
    ["[IIII]", "invalid-chord", 2],
    ["[Iv]", "invalid-chord", 2],
    ["[imaj7]", "invalid-chord", 2],
    ["[Idim]", "invalid-chord", 2],
    ["[I9]", "invalid-chord", 2],
    ["[I x]", "invalid-chord", 2],
    ["[-:2]", "invalid-chord", 2],
    ["[- ]", "invalid-chord", 2],
    ["[I] [", "unterminated", 5],
    ["[I]x", "expected-blank", 4],
    ["{else if a=1}", "invalid-conditional", 7],
    ["{if}", "invalid-conditional", 4],
    ["{if a}", "invalid-conditional", 6],
    ["{if a>1}", "invalid-conditional", 6],
    ["{if a==1}", "invalid-conditional", 7],
    ["{if A=1}", "invalid-conditional", 5],
    ["{if a=}", "invalid-conditional", 7],
    ["{if a=1 x}", "invalid-conditional", 9],
    ["{else x}", "invalid-conditional", 7],
    ["{end 1}", "invalid-conditional", 6],
    ["{if a=1", "unterminated", 1],
    ["1 {end", "unterminated", 3],
    ["{end}", "unmatched-conditional", 1],
    ["{else}", "unmatched-conditional", 1],
    ["1 {end}", "unmatched-conditional", 3],
    ["{if a=1} 1 {else} 2 {else} 3 {end}", "unmatched-conditional", { find: "{else}", last: true }],
  ]);

  it("accepts a degree, an octave mark and a duration at their limits", () => {
    expect(errorsOf(withHeader("10 1,,, 1''' 1:64 1:128/2 1:256/4 r:64 1/abcdefghijklmnop\n"))).toEqual([]);
  });

  it("counts a syllable in code points, marks included", () => {
    const sixteen = "a\u0300".repeat(8);
    expect(errorsOf(withHeader(`1/${sixteen}\n`))).toEqual([]);
    expect(errorsOf(withHeader(`1/${sixteen}a\n`))).toEqual(["invalid-syllable 2:3"]);
    const [note] = exerciseOf(withHeader("1/ma\u0300 2/ñ\n")).pattern;
    expect(note).toMatchObject({ syllable: "ma\u0300" });
  });
});

describe("syntax errors: blocks and recovery", () => {
  it("reports an unclosed {if} at its {", () => {
    expect(errorsOf(withHeader("1\n  {if a=1} 1 2\n3\n"))).toEqual(["unclosed-if 3:3"]);
  });

  it("reports a directive line inside a block at its {", () => {
    expect(errorsOf(withHeader("{if a=1}\n  {vowel: ah}\n{end}\n"))).toEqual(["directive-in-conditional 3:3"]);
    expect(errorsOf(withHeader("{if a=1}\n{unknown: x}\n{end}\n"))).toEqual(["directive-in-conditional 3:1"]);
  });

  it("lets a block span lines", () => {
    const source = withHeader("{if a=x}\n1 2\n{else}\n3\n{end}\n", "{param: a = x | y}\n");
    expect(errorsOf(source)).toEqual([]);
  });

  it("reports one error per line and recovers at the next line", () => {
    const source = "{meter: 4/4}\n1 2 3 11 x y\n[I\n1\n{title: T";
    expect(errorsOf(source)).toEqual([
      "invalid-value 1:10",
      "invalid-degree 2:7",
      "unterminated 3:1",
      "unterminated 5:1",
    ]);
  });

  it("does not repeat an unclosed {if} on a line that already has an error", () => {
    expect(errorsOf("{if a=1} 1 x\n2")).toEqual(["unexpected-character 1:12"]);
  });

  it("sorts errors by line and column, and returns no AST", () => {
    const result = parse("{title.en: x}\n1 R\n");
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("exercise");
    expect(summary(result.errors)).toEqual(["invalid-translation 1:7", "unexpected-character 2:3"]);
  });

  it("gives every error a message", () => {
    for (const source of ["{meter: 4/4}", "1 R", "{title: x}\n"]) {
      for (const error of parse(source).errors) expect(error.message.length).toBeGreaterThan(0);
    }
  });
});

describe("limits", () => {
  const items = (n: number) => Array.from({ length: n }, () => "1").join(" ");

  it("allows 1 024 pattern items and rejects the 1 025th", () => {
    expect(errorsOf(withHeader(`${items(1024)}\n`))).toEqual([]);
    expect(errorsOf(withHeader(`${items(1025)}\n`))).toEqual([`too-many-items 2:${2 * 1024 + 1}`]);
  });

  it("counts bar lines, chords and conditional tokens, in every branch", () => {
    const body = `{if a=x}\n${items(510)} | [I]\n{else}\n${items(510)}\n{end}\n`;
    // {if} + 510 notes + bar + chord + {else} + 510 notes + {end} = 1 025 items
    expect(errorsOf(withHeader(body, "{param: a = x | y}\n"))).toEqual(["too-many-items 7:1"]);
    expect(errorsOf(withHeader(body.replace("| [I]", "|"), "{param: a = x | y}\n"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// File-level errors
// ---------------------------------------------------------------------------------------------------

describe("file-level errors", () => {
  checkRows([
    ["1", "missing-title", 1],
    ["{title: T}", "missing-pattern", 1],
  ]);

  it("reports every violation, in table order at the same position", () => {
    expect(errorsOf("{level: a}")).toEqual(["missing-title 1:1", "missing-pattern 1:1"]);
  });

  it("reports a repeated directive, translation or parameter at the later {", () => {
    expect(errorsOf("{title: A}\n{title: B}\n1")).toEqual(["duplicate-directive 2:1"]);
    expect(errorsOf("{title: A}\n{title.it: B}\n{title.it: C}\n1")).toEqual(["duplicate-directive 3:1"]);
    expect(errorsOf("{title: A}\n{focus: a}\n  {focus: b}\n1")).toEqual(["duplicate-directive 3:3"]);
    expect(errorsOf("{title: A}\n{param: a = x | y}\n{param: a = 1..3}\n1")).toEqual(["duplicate-directive 3:1"]);
    expect(errorsOf("{title: A}\n{defaults: tempo=60}\n{defaults: tempo=70}\n1")).toEqual(["duplicate-directive 3:1"]);
    expect(errorsOf("{title: A}\n{title.it: B}\n{description: C}\n{description.it: D}\n1")).toEqual([]);
  });

  it("reports a repeated {defaults} key at the second key", () => {
    const source = "{title: A}\n{defaults: tempo=60 step=+1 tempo=70}\n1";
    expect(errorsOf(source)).toEqual([`duplicate-directive 2:${column(source.split("\n")[1] ?? "", { find: "tempo=70" })}`]);
  });

  it("reports a parameter named like a setting at its name", () => {
    expect(errorsOf(withHeader("1", "{param: tempo = 1..3}\n"))).toEqual(["reserved-param-name 2:9"]);
    expect(errorsOf(withHeader("1", "{param: count-in = a | b}\n"))).toEqual(["reserved-param-name 2:9"]);
  });

  it("reports {vowel} with {param: vowel} at the later one", () => {
    expect(errorsOf(withHeader("1", "{vowel: ah}\n{param: vowel = ah | eh}\n"))).toEqual(["conflicting-directives 3:1"]);
    expect(errorsOf(withHeader("1", "{param: vowel = ah | eh}\n{vowel: ah}\n"))).toEqual(["conflicting-directives 3:1"]);
  });

  it("reports an unknown {defaults} key, and still checks the range order", () => {
    const source = "{defaults: foo=1 start=G4 end=C4}\n{title: T}\n1";
    expect(errorsOf(source)).toEqual(["unknown-key 1:12", "range-order 1:27"]);
  });

  it("rejects the reserved names", () => {
    const line = (directive: string) => withHeader("1", `${directive}\n`);
    expect(errorsOf(line("{dynamics: p}"))).toEqual(["unknown-directive 2:2"]);
    expect(errorsOf(line("{tuning: 440}"))).toEqual(["unknown-directive 2:2"]);
    expect(errorsOf(line("{style: block}"))).toEqual(["unknown-directive 2:2"]);
    expect(errorsOf(line("{accompaniment: block}"))).toEqual(["unknown-directive 2:2"]);
    expect(errorsOf(line("{defaults: style=block}"))).toEqual(["unknown-key 2:12"]);
    expect(errorsOf(line("{defaults: tuning=440}"))).toEqual(["unknown-key 2:12"]);
    expect(errorsOf(line("{defaults: tuning=A4}"))).toEqual(["unknown-key 2:12"]);
    expect(errorsOf(line("1:8<>"))).toEqual(["expected-blank 2:4"]);
  });

  it("checks a {defaults} value against the parameter, and an {if} against its parameter", () => {
    const params = "{param: a = x | y}\n{param: speed = 1..3}\n";
    expect(errorsOf(withHeader("1", `${params}{defaults: a=z speed=4 speed=2}\n`))).toEqual([
      "invalid-param-value 4:14",
      "invalid-param-value 4:22",
      "duplicate-directive 4:24",
    ]);
    expect(errorsOf(withHeader("1", `${params}{defaults: a=y speed=3}\n`))).toEqual([]);
    expect(errorsOf(withHeader("{if speed=5} 1 {end}\n{if a=z} 1 {end}\n", params))).toEqual([
      "invalid-param-value 4:11",
      "invalid-param-value 5:7",
    ]);
    expect(errorsOf(withHeader("{if foo=1} 1 {end}\n", params))).toEqual(["unknown-param 4:5"]);
  });

  it("uses the first declaration of a parameter name", () => {
    const source = withHeader("{if a=y} 1 {end}\n", "{param: a = x | y}\n{param: a = 1..3}\n");
    expect(errorsOf(source)).toEqual(["duplicate-directive 3:1"]);
  });

  it("compares a lone start or end with the built-in value of the other", () => {
    const defaults = (text: string) => errorsOf(withHeader("1", `{defaults: ${text}}\n`));
    expect(defaults("start=C4")).toEqual([]);
    expect(defaults("start=D4")).toEqual(["range-order 2:12"]);
    expect(defaults("end=C3")).toEqual([]);
    expect(defaults("end=B2")).toEqual(["range-order 2:12"]);
    expect(defaults("start=C4 end=C3")).toEqual(["range-order 2:21"]);
    expect(defaults("start=C4 end=C4")).toEqual([]);
    expect(defaults("end=C3 start=D3")).toEqual(["range-order 2:12"]);
    expect(defaults("voice=tenor start=D5")).toEqual([]);
    expect(defaults("start=Bb2 end=A#2")).toEqual([]);
    expect(defaults("start=Cb4 end=B3")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Bar checking
// ---------------------------------------------------------------------------------------------------

describe("bar checking", () => {
  const meter = (body: string, n = 4) => errorsOf(`{title: T}\n{meter: ${n}}\n${body}\n`);

  it("checks nothing without {meter}", () => {
    expect(errorsOf(withHeader("[I] 1:1/2 8:1/2 5 3 | 1:2 r:2\n1 2 3 4 5 6 7\n"))).toEqual([]);
  });

  it("requires every bar to add up to the meter, counting quarter beats exactly", () => {
    expect(meter("[I] 1 2 3 4 | 5 4 3 2 | 1:2 r:2")).toEqual([]);
    expect(meter("1:1/4 2:1/4 3:1/2 4:3/2 5:1/2 6:1/2 7:1/2")).toEqual([]);
    expect(meter("1 2 3")).toEqual(["bar-length 3:6"]);
    expect(meter("1 2 3 4 5")).toEqual(["bar-length 3:10"]);
    expect(meter("1 2 3 4 | 5 6 | 7 8 9", 4)).toEqual(["bar-length 3:15", "bar-length 3:22"]);
    expect(meter("3:1/4 | 1 2", 3)).toEqual(["bar-length 3:7", "bar-length 3:12"]);
    expect(meter("1 2 3", 3)).toEqual([]);
    expect(meter("1", 1)).toEqual([]);
    expect(meter("1:16", 16)).toEqual([]);
  });

  it("closes a bar at every line end", () => {
    expect(meter("1 2 3 4\n5 6 7 8")).toEqual([]);
    expect(meter("1 2\n3 4")).toEqual(["bar-length 3:4", "bar-length 4:4"]);
  });

  it("ignores empty bars (a leading or doubled bar line) but not bars with only a chord", () => {
    expect(meter("| 1 2 3 4 | | 5 6 7 8 |")).toEqual([]);
    expect(meter("[I]\n1 2 3 4")).toEqual(["bar-length 3:4"]);
    expect(meter("1 2 3 4 | [I] | 5 6 7 8")).toEqual(["bar-length 3:15"]);
    expect(meter("[I] 1 2 3 4 | [V7] 5 6 7 8 | [-]")).toEqual(["bar-length 3:33"]);
  });

  it("lets {if}, {else} and {end} close a bar", () => {
    const params = "{param: a = x | y}\n";
    const check = (body: string) => errorsOf(`{title: T}\n${params}{meter: 4}\n${body}\n`);
    expect(check("{if a=x} 1 2 3 4 {else} 1 2 3 4 | 5 6 7 8 {end}")).toEqual([]);
    expect(check("1 2 3 4 {if a=x} 1 2 3 4 {end} 5 6 7 8")).toEqual([]);
    expect(check("{if a=x} 1 2 3 {else} 1 2 3 4 {end}")).toEqual(["bar-length 4:16"]);
    expect(check("{if a=x} 1 2 3 4 {else} 1 2 3 4 5 {end}")).toEqual(["bar-length 4:35"]);
    expect(check("1 2 {if a=x} 1 2 3 4 {end}")).toEqual(["bar-length 4:5"]);
    expect(check("{if a=x}\n1 2 3 4\n{else}\n1 2 3 4\n{end}")).toEqual([]);
  });

  it("is not run when there is a syntax error", () => {
    expect(meter("1 2 3 x")).toEqual(["unexpected-character 3:7"]);
  });
});

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
