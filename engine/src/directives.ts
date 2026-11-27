import type { Chord, DefaultPair, DirectiveNode, Param } from "./ast.js";
import { describe, isBlank, isDigit, isLower, isNameChar, isWordChar, skipBlanks, sp } from "./lex.js";
import { Fail, type State } from "./state.js";
import { MAX_SYLLABLE, parseChord, readSyllable } from "./tokens.js";

const DIRECTIVES = new Set([
  "title",
  "description",
  "author",
  "focus",
  "technique",
  "level",
  "voice",
  "defaults",
  "param",
  "vowel",
  "cue",
  "meter",
]);
const TRANSLATABLE = new Set(["title", "description"]);
export const SETTINGS = new Set(["start", "end", "voice", "tempo", "step", "direction", "cue", "count-in"]);
const SCALES = ["major", "minor", "harmonic-minor", "dorian"];
const VOICES = ["soprano", "mezzo", "alto", "tenor", "baritone", "bass"];
const DIRECTIONS = ["up", "down", "up-down", "down-up"];

function parseTextValue(s: string, start: number, end: number): string {
  let out = "";
  for (let p = start; p < end; p++) {
    const c = s.charAt(p);
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = p + 1 < end ? s.charAt(p + 1) : "";
    if (next !== "}" && next !== "\\") throw new Fail("invalid-value", p + 1, "a backslash escapes only } or \\");
    out += next;
    p++;
  }
  return out;
}

function parseFacets(s: string, start: number, end: number, multi: boolean): string[] {
  const items: string[] = [];
  let p = start;
  for (;;) {
    const from = p;
    if (p >= end || !isWordChar(s.charAt(p)))
      throw new Fail("invalid-value", p + 1, "a facet value is lowercase letters and digits");
    while (p < end && isWordChar(s.charAt(p))) p++;
    while (p + 1 < end && (s.charAt(p) === " " || s.charAt(p) === "-") && isWordChar(s.charAt(p + 1))) {
      p++;
      while (p < end && isWordChar(s.charAt(p))) p++;
    }
    items.push(s.slice(from, p));
    p = skipBlanks(s, p, end);
    if (p >= end) return items;
    if (!multi || s.charAt(p) !== ",") throw new Fail("invalid-value", p + 1, `unexpected ${describe(s.charAt(p))}`);
    p = skipBlanks(s, p + 1, end);
  }
}

function parseMeter(s: string, start: number, end: number): number {
  let p = start;
  while (p < end && isDigit(s.charAt(p))) p++;
  if (p === start) throw new Fail("invalid-value", start + 1, "a meter is an integer, 1 to 16");
  const rest = skipBlanks(s, p, end);
  if (rest < end) throw new Fail("invalid-value", rest + 1, "a meter is a beat count, not a time signature");
  const n = Number(s.slice(start, p));
  if (n < 1 || n > 16) throw new Fail("invalid-value", start + 1, "a meter is 1 to 16 beats");
  return n;
}

function parseVowel(s: string, start: number, end: number): string {
  const syllable = readSyllable(s, start, end);
  const rest = skipBlanks(s, syllable.end, end);
  if (syllable.count === 0 || rest < end) throw new Fail("invalid-value", rest + 1, "a vowel is one syllable of letters");
  if (syllable.count > MAX_SYLLABLE)
    throw new Fail("invalid-value", start + 1, `a syllable is at most ${MAX_SYLLABLE} characters`);
  return syllable.text;
}

function parseCue(s: string, start: number, end: number, line: number): Chord {
  if (s.charAt(start) !== "[") throw new Fail("invalid-value", start + 1, "a cue is one chord, such as [I:2]");
  const chord = parseChord(s, start, end, line);
  if (chord.kind === "chord-off") throw new Fail("invalid-chord", start + 2, "[-] is not allowed in a cue");
  const after = skipBlanks(s, start + (chord.span.endColumn - chord.span.column), end);
  if (after < end) throw new Fail("invalid-value", after + 1, "a cue is a single chord");
  return chord;
}

export function noteNameMidi(s: string, a: number, b: number): number {
  const first = s.charAt(a);
  if (first < "A" || first > "G" || a >= b) throw new Fail("invalid-value", a + 1, "a note name starts with A to G");
  let p = a + 1;
  let semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[first as "C"];
  if (s.charAt(p) === "#") {
    semitone++;
    p++;
  } else if (s.charAt(p) === "b") {
    semitone--;
    p++;
  }
  let negative = false;
  if (s.charAt(p) === "-") {
    negative = true;
    p++;
  }
  if (p >= b || !isDigit(s.charAt(p))) throw new Fail("invalid-value", p + 1, "a note name ends with an octave digit");
  const octave = (negative ? -1 : 1) * Number(s.charAt(p));
  p++;
  if (p < b) throw new Fail("invalid-value", p + 1, `unexpected ${describe(s.charAt(p))} in a note name`);
  const midi = 12 * (octave + 1) + semitone;
  if (midi < 0 || midi > 127) throw new Fail("invalid-value", a + 1, "a note must be MIDI 0 to 127");
  return midi;
}

function checkEnum(s: string, a: number, b: number, allowed: string[]): void {
  for (let p = a; p < b; p++) {
    const c = s.charAt(p);
    if (!(p === a ? isWordChar(c) : isNameChar(c))) throw new Fail("invalid-value", p + 1, `unexpected ${describe(c)}`);
  }
  if (!allowed.includes(s.slice(a, b))) throw new Fail("invalid-value", a + 1, `expected one of ${allowed.join(", ")}`);
}

function checkInteger(s: string, a: number, b: number, from: number, min: number, max: number): void {
  let p = from;
  while (p < b && isDigit(s.charAt(p))) p++;
  if (p === from) throw new Fail("invalid-value", from + 1, "expected an integer");
  if (p < b) throw new Fail("invalid-value", p + 1, `unexpected ${describe(s.charAt(p))}`);
  const n = Number(s.slice(from, b));
  if (n < min || n > max) throw new Fail("invalid-value", a + 1, `expected ${min} to ${max}`);
}

/** Checks the value of one `{defaults}` pair against the syntax its key defines. Returns the MIDI note of start and end. */
function checkSetting(s: string, key: string, a: number, b: number): number | undefined {
  switch (key) {
    case "start":
    case "end":
      return noteNameMidi(s, a, b);
    case "voice":
      checkEnum(s, a, b, VOICES);
      return undefined;
    case "direction":
      checkEnum(s, a, b, DIRECTIONS);
      return undefined;
    case "cue":
      checkEnum(s, a, b, ["on", "off"]);
      return undefined;
    case "tempo":
      checkInteger(s, a, b, a, 20, 300);
      return undefined;
    case "step":
      if (s.charAt(a) !== "+") throw new Fail("invalid-value", a + 1, "a step has a sign, +1 to +12");
      checkInteger(s, a, b, a + 1, 1, 12);
      return undefined;
    case "count-in": {
      if (!isDigit(s.charAt(a))) {
        checkEnum(s, a, b, ["off"]);
        return undefined;
      }
      let p = a;
      while (p < b && isDigit(s.charAt(p))) p++;
      for (const expected of "bar") {
        if (p >= b || s.charAt(p) !== expected) throw new Fail("invalid-value", p + 1, "count-in is off, or 1bar to 4bar");
        p++;
      }
      if (p < b) throw new Fail("invalid-value", p + 1, `unexpected ${describe(s.charAt(p))}`);
      const n = Number(s.slice(a, p - 3));
      if (n < 1 || n > 4) throw new Fail("invalid-value", a + 1, "count-in is off, or 1bar to 4bar");
      return undefined;
    }
    default: {
      // Not a setting: the file-level check says whether it is a declared parameter.
      for (let p = a; p < b; p++) {
        if (!/[A-Za-z0-9#+-]/.test(s.charAt(p))) throw new Fail("invalid-value", p + 1, `unexpected ${describe(s.charAt(p))}`);
      }
      return undefined;
    }
  }
}

function parseDefaults(s: string, start: number, end: number, line: number): DefaultPair[] {
  const pairs: DefaultPair[] = [];
  let p = start;
  for (;;) {
    const keyStart = p;
    if (p >= end || !isLower(s.charAt(p))) throw new Fail("invalid-value", p + 1, "expected a setting name");
    p++;
    while (p < end && isNameChar(s.charAt(p))) p++;
    const key = s.slice(keyStart, p);
    if (p >= end || s.charAt(p) !== "=") throw new Fail("invalid-value", p + 1, "expected '=' right after the key");
    const valueStart = p + 1;
    p = valueStart;
    while (p < end && !isBlank(s.charAt(p))) p++;
    if (p === valueStart) throw new Fail("invalid-value", valueStart + 1, "expected a value right after '='");
    checkSetting(s, key, valueStart, p);
    pairs.push({
      key,
      value: s.slice(valueStart, p),
      keySpan: sp(line, keyStart, keyStart + key.length),
      valueSpan: sp(line, valueStart, p),
      span: sp(line, keyStart, p),
    });
    p = skipBlanks(s, p, end);
    if (p >= end) return pairs;
  }
}

function parseParam(s: string, start: number, end: number, line: number, brace: number, close: number): Param {
  let p = start;
  if (p >= end || !isLower(s.charAt(p))) throw new Fail("invalid-value", p + 1, "a parameter name starts with a lowercase letter");
  p++;
  while (p < end && isNameChar(s.charAt(p))) p++;
  const name = s.slice(start, p);
  const nameSpan = sp(line, start, p);
  const span = sp(line, brace, close + 1);
  p = skipBlanks(s, p, end);
  if (p >= end || s.charAt(p) !== "=") throw new Fail("invalid-value", p + 1, "expected '=' after the parameter name");
  p = skipBlanks(s, p + 1, end);
  if (p >= end) throw new Fail("invalid-value", end + 1, "expected the parameter values");

  let q = p;
  while (q < end && isDigit(s.charAt(q))) q++;
  if (q > p && s.startsWith("..", q) && q + 2 <= end) {
    const secondStart = q + 2;
    let r = secondStart;
    while (r < end && isDigit(s.charAt(r))) r++;
    if (r === secondStart) throw new Fail("invalid-value", secondStart + 1, "expected the end of the range");
    if (r < end) throw new Fail("invalid-value", r + 1, `unexpected ${describe(s.charAt(r))}`);
    const min = Number(s.slice(p, q));
    const max = Number(s.slice(secondStart, r));
    if (name === "scale") throw new Fail("invalid-value", p + 1, "the scale parameter lists scale names");
    if (min > 99) throw new Fail("invalid-value", p + 1, "a range bound is 0 to 99");
    if (max > 99) throw new Fail("invalid-value", secondStart + 1, "a range bound is 0 to 99");
    if (max <= min) throw new Fail("invalid-value", secondStart + 1, "a range must increase");
    return { kind: "range", name, min, max, nameSpan, span };
  }

  const values: string[] = [];
  for (;;) {
    const from = p;
    if (p >= end || !isWordChar(s.charAt(p))) throw new Fail("invalid-value", p + 1, "a value is lowercase letters, digits and hyphens");
    while (p < end && isNameChar(s.charAt(p))) p++;
    const value = s.slice(from, p);
    if (values.includes(value)) throw new Fail("invalid-value", from + 1, `"${value}" is listed twice`);
    if (name === "scale" && !SCALES.includes(value))
      throw new Fail("invalid-value", from + 1, `"${value}" is not a scale (${SCALES.join(", ")})`);
    values.push(value);
    p = skipBlanks(s, p, end);
    if (p >= end) break;
    if (s.charAt(p) !== "|") throw new Fail("invalid-value", p + 1, `unexpected ${describe(s.charAt(p))}`);
    p = skipBlanks(s, p + 1, end);
  }
  if (values.length < 2) throw new Fail("invalid-value", end + 1, "a parameter lists two or more values, or a range such as 1..3");
  return { kind: "options", name, values, nameSpan, span };
}

export function parseDirective(st: State, s: string, line: number, brace: number): void {
  let p = skipBlanks(s, brace + 1);
  const nameStart = p;
  while (p < s.length && !isBlank(s.charAt(p)) && !".:}{".includes(s.charAt(p))) p++;
  const name = s.slice(nameStart, p);
  if (!DIRECTIVES.has(name)) throw new Fail("unknown-directive", nameStart + 1, `unknown directive "${name}"`);

  let lang: string | undefined;
  if (s.charAt(p) === ".") {
    const dot = p;
    p++;
    const langStart = p;
    while (p < s.length && !isBlank(s.charAt(p)) && s.charAt(p) !== ":" && s.charAt(p) !== "}") p++;
    lang = s.slice(langStart, p);
    if (!TRANSLATABLE.has(name) || !/^[a-z]{2,3}$/.test(lang) || lang === "en")
      throw new Fail("invalid-translation", dot + 1, `"${name}.${lang}" is not a translation the format allows`);
  }

  p = skipBlanks(s, p);
  if (s.charAt(p) !== ":") throw new Fail("missing-value", p + 1, `expected ':' after "${name}"`);
  p++;
  let close = p;
  while (close < s.length && s.charAt(close) !== "}") close += s.charAt(close) === "\\" ? 2 : 1;
  if (close >= s.length) throw new Fail("unterminated", brace + 1, "a directive closes with '}' on its own line");

  const valueStart = skipBlanks(s, p, close);
  let valueEnd = close;
  while (valueEnd > valueStart && isBlank(s.charAt(valueEnd - 1))) valueEnd--;
  if (valueStart >= valueEnd) throw new Fail("missing-value", valueStart + 1, `"${name}" needs a value`);

  const occurrence = (key: string) => st.occurrences.push({ key, line, column: brace + 1 });
  let parsed: () => void;
  switch (name) {
    case "title":
    case "description":
    case "author": {
      const value = parseTextValue(s, valueStart, valueEnd);
      occurrence(lang ? `${name}.${lang}` : name);
      parsed = () => {
        if (lang) st.translations[name as "title" | "description"][lang] ??= value;
        else st[name as "title" | "description" | "author"] ??= value;
      };
      break;
    }
    case "focus":
    case "technique": {
      const value = parseFacets(s, valueStart, valueEnd, true);
      occurrence(name);
      parsed = () => void (st[name] ??= value);
      break;
    }
    case "level":
    case "voice": {
      const value = parseFacets(s, valueStart, valueEnd, false)[0] ?? "";
      occurrence(name);
      parsed = () => void (st[name] ??= value);
      break;
    }
    case "defaults": {
      const pairs = parseDefaults(s, valueStart, valueEnd, line);
      occurrence(name);
      parsed = () => void st.defaultsLists.push(pairs);
      break;
    }
    case "param": {
      const param = parseParam(s, valueStart, valueEnd, line, brace, close);
      occurrence(`param:${param.name}`);
      parsed = () => void st.params.push({ param, line, column: brace + 1 });
      break;
    }
    case "vowel": {
      const value = parseVowel(s, valueStart, valueEnd);
      occurrence(name);
      parsed = () => void (st.vowel ??= { value, line, column: brace + 1 });
      break;
    }
    case "cue": {
      const value = parseCue(s, valueStart, valueEnd, line);
      occurrence(name);
      parsed = () => void (st.cue ??= value);
      break;
    }
    default: {
      const value = parseMeter(s, valueStart, valueEnd);
      occurrence(name);
      parsed = () => void (st.meter ??= value);
    }
  }

  const trailing = skipBlanks(s, close + 1);
  if (trailing < s.length) throw new Fail("unexpected-character", trailing + 1, `unexpected ${describe(s.charAt(trailing))} after '}'`);

  parsed();
  const node: DirectiveNode = { name, span: sp(line, brace, close + 1) };
  if (lang) node.lang = lang;
  st.directives.push(node);
}
