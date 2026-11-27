import { describe, expect, it } from "vitest";
import { checkRows, column, errorsOf, withHeader } from "./parse-helpers.js";

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
