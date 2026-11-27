import { describe, expect, it } from "vitest";
import { parse } from "../src/index.js";
import { checkRows, errorsOf, exerciseOf, itemsText, summary, withHeader } from "./parse-helpers.js";
import type { Row } from "./parse-helpers.js";

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
    ["1~", "invalid-degree", 3],
    ["1~x", "invalid-degree", 3],
    ["b", "invalid-degree", 2],
    ["bx", "invalid-degree", 2],
    ["bb3", "invalid-degree", 2],
    ["#", "invalid-degree", 2],
    ["#x", "invalid-degree", 2],
    ["1 b", "invalid-degree", 4],
    ["1~b", "invalid-degree", 4],
    ["1~#x", "invalid-degree", 4],
    ["0", "invalid-degree", 1],
    ["07", "invalid-degree", 1],
    ["11", "invalid-degree", 1],
    ["b0", "invalid-degree", 2],
    ["1~11", "invalid-degree", 3],
    ["1:", "expected-blank", 2],
    ["1:x", "expected-blank", 2],
    ["r:", "expected-blank", 2],
    ["[I:]", "invalid-chord", 2],
    ["[I:x]", "invalid-chord", 2],
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

  it("keeps applying {if}, {else} and {end} after an error on the same line", () => {
    expect(errorsOf(withHeader("{if a=x} 1 q {end}\n{vowel: ah}\n"))).toEqual(["unexpected-character 2:12"]);
    expect(errorsOf(withHeader("{if a>x} 1 {end}\n{vowel: ah}\n"))).toEqual(["invalid-conditional 2:6"]);
    expect(errorsOf(withHeader("{if a=x}1 {else} 2 {end}\n"))).toEqual(["expected-blank 2:9"]);
    expect(errorsOf(withHeader("{if a=x} 1 q {else} 2 {end}\n{vowel: ah}\n"))).toEqual(["unexpected-character 2:12"]);
    expect(errorsOf(withHeader("{if a=x} 1 {end} q {if b=1} 2 {end}\n"))).toEqual(["unexpected-character 2:18"]);
    expect(errorsOf(withHeader("1 q {end}\n"))).toEqual(["unexpected-character 2:3"]);
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
