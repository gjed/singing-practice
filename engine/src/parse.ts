import type {
  Bar,
  Chord,
  ChordOff,
  ChordQuality,
  Conditional,
  DefaultPair,
  DirectiveNode,
  Duration,
  ErrorCode,
  Exercise,
  Note,
  Param,
  ParseError,
  ParseResult,
  PatternItem,
  Pitch,
  Span,
} from "./ast.js";

const MAX_BYTES = 65_536;
const MAX_ITEMS = 1_024;
const MAX_SYLLABLE = 16;
const MAX_BEATS = 64;

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
const TEXT_DIRECTIVES = new Set(["title", "description", "author"]);
const SETTINGS = new Set(["start", "end", "voice", "tempo", "step", "direction", "cue", "count-in"]);
const SCALES = ["major", "minor", "harmonic-minor", "dorian"];
const VOICES = ["soprano", "mezzo", "alto", "tenor", "baritone", "bass"];
const DIRECTIONS = ["up", "down", "up-down", "down-up"];
const UPPER_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
const LOWER_NUMERALS = ["i", "ii", "iii", "iv", "v", "vi", "vii"];
const QUALITIES: ChordQuality[] = ["maj7", "dim", "7"];

/** Position order of codes in the spec's tables, used to order errors at the same position. */
const CODE_ORDER: ErrorCode[] = [
  "missing-title",
  "missing-pattern",
  "duplicate-directive",
  "reserved-param-name",
  "conflicting-directives",
  "unknown-key",
  "invalid-param-value",
  "range-order",
  "unknown-param",
  "bar-length",
];

/** A syntax error found while reading one line. It ends that line; the parser recovers at the next. */
class Fail extends Error {
  constructor(
    readonly code: ErrorCode,
    /** 1-based column. */
    readonly column: number,
    message: string,
  ) {
    super(message);
  }
}

interface Located {
  line: number;
  column: number;
}

interface BarRecord extends Located {
  quarters: number;
  hasContent: boolean;
}

interface IfRef {
  name: string;
  value: string;
  nameSpan: Span;
  valueSpan: Span;
}

interface ParamDecl extends Located {
  param: Param;
}

interface State {
  errors: ParseError[];
  errorLines: Set<number>;
  directives: DirectiveNode[];
  /** Every directive in source order, keyed `name`, `name.lang` or `param:name`, for duplicate checks. */
  occurrences: (Located & { key: string })[];
  title?: string;
  description?: string;
  author?: string;
  translations: { title: Record<string, string>; description: Record<string, string> };
  focus?: string[];
  technique?: string[];
  level?: string;
  voice?: string;
  defaultsLists: DefaultPair[][];
  params: ParamDecl[];
  vowel?: Located & { value: string };
  cue?: Chord;
  meter?: number;
  top: PatternItem[];
  block?: { node: Conditional; inElse: boolean };
  itemCount: number;
  overflowed: boolean;
  noteCount: number;
  bars: BarRecord[];
  ifRefs: IfRef[];
}

const isBlank = (c: string) => c === " " || c === "\t";
const isDigit = (c: string) => c >= "0" && c <= "9";
const isLower = (c: string) => c >= "a" && c <= "z";
const isWordChar = (c: string) => isLower(c) || isDigit(c);
const isNameChar = (c: string) => isWordChar(c) || c === "-";
const isControl = (code: number) => (code < 0x20 && code !== 0x09) || code === 0x7f;

function skipBlanks(s: string, i: number, end = s.length): number {
  while (i < end && isBlank(s.charAt(i))) i++;
  return i;
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low < 0xe000) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** Span from a 0-based start index to a 0-based exclusive end index on one line. */
function sp(line: number, start: number, end: number): Span {
  return { line, column: start + 1, endLine: line, endColumn: end + 1 };
}

function describe(c: string): string {
  return c === "" ? "end of line" : `"${c}"`;
}

/** Matches one code point as a Unicode letter, or as a letter or combining mark. */
const LETTER = /^\p{L}$/u;
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;

// ---------------------------------------------------------------------------------------------------
// Tokens shared by directive values and pattern lines
// ---------------------------------------------------------------------------------------------------

function parseDuration(s: string, colon: number, line: number): { duration: Duration; end: number } {
  const bad = (why: string) => new Fail("invalid-duration", colon + 1, why);
  let p = colon + 1;
  if (!isDigit(s.charAt(p))) throw bad("a duration is ':' followed by a positive integer or a fraction");
  let q = p;
  while (isDigit(s.charAt(q))) q++;
  const numerator = Number(s.slice(p, q));
  let denominator = 1;
  let fraction = false;
  p = q;
  if (s.charAt(p) === "/" && isDigit(s.charAt(p + 1))) {
    fraction = true;
    q = p + 1;
    while (isDigit(s.charAt(q))) q++;
    denominator = Number(s.slice(p + 1, q));
    p = q;
  }
  if (numerator < 1) throw bad("a duration must be positive");
  if (fraction && denominator !== 2 && denominator !== 4)
    throw bad("the denominator of a duration is 2 or 4");
  if (numerator / denominator > MAX_BEATS) throw bad(`a duration is at most ${MAX_BEATS} beats`);
  return {
    duration: { numerator, denominator: denominator as 1 | 2 | 4, span: sp(line, colon, p) },
    end: p,
  };
}

function parsePitch(s: string, start: number, line: number): { pitch: Pitch; end: number } {
  let p = start;
  let alter: -1 | 0 | 1 = 0;
  const first = s.charAt(p);
  if (first === "b") {
    alter = -1;
    p++;
  } else if (first === "#") {
    alter = 1;
    p++;
  }
  const digits = p;
  if (!isDigit(s.charAt(p))) throw new Fail("unexpected-character", p + 1, `expected a degree, found ${describe(s.charAt(p))}`);
  while (isDigit(s.charAt(p))) p++;
  const text = s.slice(digits, p);
  const degree = Number(text);
  if ((text.length > 1 && text.startsWith("0")) || degree < 1 || degree > 10)
    throw new Fail("invalid-degree", digits + 1, "a degree is 1 to 10 without leading zeros");
  let octave = 0;
  const mark = s.charAt(p);
  if (mark === "," || mark === "'") {
    let n = 0;
    while (n < 3 && s.charAt(p) === mark) {
      p++;
      n++;
    }
    octave = mark === "," ? -n : n;
  }
  return { pitch: { alter, degree, octave, span: sp(line, start, p) }, end: p };
}

/** Reads a syllable from `start` (the first character after the `/`), stopping at the first non-letter. */
function readSyllable(s: string, start: number, limit: number): { text: string; end: number; count: number } {
  let p = start;
  let count = 0;
  while (p < limit) {
    const cp = s.codePointAt(p);
    if (cp === undefined) break;
    const ch = String.fromCodePoint(cp);
    if (!(count === 0 ? LETTER : LETTER_OR_MARK).test(ch)) break;
    p += ch.length;
    count++;
  }
  return { text: s.slice(start, p), end: p, count };
}

/** `[…]` at `open`, whose closing `]` must come before `limit`. */
function parseChord(s: string, open: number, limit: number, line: number): Chord | ChordOff {
  const close = s.indexOf("]", open + 1);
  if (close < 0 || close >= limit) throw new Fail("unterminated", open + 1, "a chord closes with ']' on its own line");
  const start = open + 1;
  const bad = (why: string) => new Fail("invalid-chord", start + 1, why);
  const span = sp(line, open, close + 1);
  if (s.charAt(start) === "-") {
    if (close === start + 1) return { kind: "chord-off", span };
    throw bad("[-] takes nothing inside the brackets");
  }
  const first = s.charAt(start);
  const letters = first === "I" || first === "V" ? "IV" : first === "i" || first === "v" ? "iv" : "";
  if (letters === "") throw bad("a chord starts with a Roman numeral, I to VII or i to vii");
  let p = start;
  while (p < close && letters.includes(s.charAt(p))) p++;
  const numeral = s.slice(start, p);
  const degree = (letters === "IV" ? UPPER_NUMERALS : LOWER_NUMERALS).indexOf(numeral) + 1;
  if (degree === 0) throw bad(`"${numeral}" is not a numeral from I to VII`);
  let quality: ChordQuality = "";
  for (const q of QUALITIES) {
    if (s.startsWith(q, p) && p + q.length <= close) {
      quality = q;
      p += q.length;
      break;
    }
  }
  if (quality === "maj7" && letters !== "IV") throw bad("maj7 needs an upper-case numeral");
  if (quality === "dim" && letters !== "iv") throw bad("dim needs a lower-case numeral");
  let duration: Duration | undefined;
  if (p < close && s.charAt(p) === ":") {
    const d = parseDuration(s, p, line);
    duration = d.duration;
    p = d.end;
  }
  if (p !== close) throw bad(`unexpected ${describe(s.charAt(p))} in a chord`);
  const chord: Chord = { kind: "chord", numeral, degree, quality, span };
  if (duration) chord.duration = duration;
  return chord;
}

// ---------------------------------------------------------------------------------------------------
// Directive lines
// ---------------------------------------------------------------------------------------------------

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

function noteNameMidi(s: string, a: number, b: number): number {
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

function parseDirective(st: State, s: string, line: number, brace: number): void {
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

// ---------------------------------------------------------------------------------------------------
// Pattern lines
// ---------------------------------------------------------------------------------------------------

type Token =
  | { kind: "if"; name: string; value: string; nameSpan: Span; valueSpan: Span; end: number }
  | { kind: "else" | "end"; end: number };

function parseConditionalToken(s: string, open: number, line: number): Token {
  let p = skipBlanks(s, open + 1);
  let q = p;
  while (isNameChar(s.charAt(q))) q++;
  const word = s.slice(p, q);
  if (word !== "if" && word !== "else" && word !== "end")
    throw new Fail("misplaced-directive", open + 1, "a directive starts a line");
  if (s.indexOf("}", open + 1) < 0) throw new Fail("unterminated", open + 1, `{${word}} closes with '}' on its own line`);
  const bad = (at: number, why: string) => new Fail("invalid-conditional", at + 1, why);
  if (word !== "if") {
    p = skipBlanks(s, q);
    if (s.charAt(p) !== "}") throw bad(p, `{${word}} takes nothing`);
    return { kind: word, end: p + 1 };
  }
  p = q;
  if (!isBlank(s.charAt(p))) throw bad(p, "{if} needs a parameter name");
  p = skipBlanks(s, p);
  const nameStart = p;
  if (!isLower(s.charAt(p))) throw bad(p, "a parameter name starts with a lowercase letter");
  p++;
  while (isNameChar(s.charAt(p))) p++;
  const nameEnd = p;
  p = skipBlanks(s, p);
  if (s.charAt(p) !== "=") throw bad(p, "{if} compares with '=' only");
  p = skipBlanks(s, p + 1);
  const valueStart = p;
  if (!isWordChar(s.charAt(p))) throw bad(p, "{if} needs a value");
  while (isNameChar(s.charAt(p))) p++;
  const valueEnd = p;
  p = skipBlanks(s, p);
  if (s.charAt(p) !== "}") throw bad(p, "expected '}' after the value");
  return {
    kind: "if",
    name: s.slice(nameStart, nameEnd),
    value: s.slice(valueStart, valueEnd),
    nameSpan: sp(line, nameStart, nameEnd),
    valueSpan: sp(line, valueStart, valueEnd),
    end: p + 1,
  };
}

function currentList(st: State): PatternItem[] {
  if (!st.block) return st.top;
  const { node, inElse } = st.block;
  return inElse ? (node.else ??= []) : node.then;
}

/** Records the 1 025th item as an error and carries on, so the structure after it still parses. */
function countItem(st: State, line: number, index: number): void {
  if (st.overflowed) return;
  st.itemCount++;
  if (st.itemCount > MAX_ITEMS) {
    st.overflowed = true;
    addError(st, "too-many-items", line, index + 1, `a file holds at most ${MAX_ITEMS} pattern items`, true);
  }
}

const quartersOf = (d: Duration) => (d.numerator * 4) / d.denominator;

function parsePatternLine(st: State, s: string, line: number): void {
  let quarters = 0;
  let hasContent = false;
  const endBar = (index: number) => {
    st.bars.push({ line, column: index + 1, quarters, hasContent });
    quarters = 0;
    hasContent = false;
  };

  let i = skipBlanks(s, 0);
  while (i < s.length) {
    const c = s.charAt(i);
    let end: number;
    let isBar = false;

    if (c === "b" || c === "#" || isDigit(c)) {
      countItem(st, line, i);
      const first = parsePitch(s, i, line);
      end = first.end;
      let glideTo: Pitch | undefined;
      if (s.charAt(end) === "~") {
        const second = parsePitch(s, end + 1, line);
        glideTo = second.pitch;
        end = second.end;
      }
      let syllable: string | undefined;
      if (s.charAt(end) === "/") {
        const read = readSyllable(s, end + 1, s.length);
        if (read.count === 0 || read.count > MAX_SYLLABLE)
          throw new Fail("invalid-syllable", end + 2, `a syllable is 1 to ${MAX_SYLLABLE} letters`);
        syllable = read.text;
        end = read.end;
      }
      let duration: Duration = { numerator: 1, denominator: 1 };
      if (s.charAt(end) === ":") {
        const d = parseDuration(s, end, line);
        duration = d.duration;
        end = d.end;
      }
      const note: Note = { kind: "note", pitch: first.pitch, duration, span: sp(line, i, end) };
      if (glideTo) note.glideTo = glideTo;
      if (syllable !== undefined) note.syllable = syllable;
      currentList(st).push(note);
      st.noteCount++;
      quarters += quartersOf(duration);
      hasContent = true;
    } else if (c === "r") {
      countItem(st, line, i);
      end = i + 1;
      let duration: Duration = { numerator: 1, denominator: 1 };
      if (s.charAt(end) === ":") {
        const d = parseDuration(s, end, line);
        duration = d.duration;
        end = d.end;
      }
      currentList(st).push({ kind: "rest", duration, span: sp(line, i, end) });
      st.noteCount++;
      quarters += quartersOf(duration);
      hasContent = true;
    } else if (c === "[") {
      countItem(st, line, i);
      const chord = parseChord(s, i, s.length, line);
      end = chord.span.endColumn - 1;
      currentList(st).push(chord);
    } else if (c === "|") {
      countItem(st, line, i);
      end = i + 1;
      isBar = true;
      const bar: Bar = { kind: "bar", span: sp(line, i, end) };
      currentList(st).push(bar);
      endBar(i);
    } else if (c === "{") {
      countItem(st, line, i);
      const token = parseConditionalToken(s, i, line);
      end = token.end;
      const span = sp(line, i, end);
      endBar(i);
      if (token.kind === "if") {
        if (st.block) throw new Fail("nested-if", i + 1, "{if} blocks do not nest");
        const node: Conditional = {
          kind: "conditional",
          param: token.name,
          value: token.value,
          paramSpan: token.nameSpan,
          valueSpan: token.valueSpan,
          then: [],
          ifSpan: span,
          endSpan: span,
          span,
        };
        st.top.push(node);
        st.block = { node, inElse: false };
        st.ifRefs.push({ name: token.name, value: token.value, nameSpan: token.nameSpan, valueSpan: token.valueSpan });
      } else if (token.kind === "else") {
        if (!st.block || st.block.inElse) throw new Fail("unmatched-conditional", i + 1, "{else} without an open {if}, or a second {else}");
        st.block.node.else = [];
        st.block.node.elseSpan = span;
        st.block.inElse = true;
      } else {
        if (!st.block) throw new Fail("unmatched-conditional", i + 1, "{end} without an open {if}");
        const node = st.block.node;
        node.endSpan = span;
        node.span = { line: node.ifSpan.line, column: node.ifSpan.column, endLine: line, endColumn: end + 1 };
        st.block = undefined;
      }
    } else {
      throw new Fail("unexpected-character", i + 1, `unexpected ${describe(c)}`);
    }

    if (!isBar) {
      const next = s.charAt(end);
      if (end < s.length && !isBlank(next) && next !== "|")
        throw new Fail("expected-blank", end + 1, `expected a blank, '|' or the end of the line, found ${describe(next)}`);
    }
    i = skipBlanks(s, end);
  }
  endBar(s.length);
}

// ---------------------------------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------------------------------

type LineKind = "blank" | "directive" | "pattern";

function classify(s: string): LineKind {
  const first = skipBlanks(s, 0);
  if (first >= s.length) return "blank";
  if (s.charAt(first) !== "{") return "pattern";
  const start = skipBlanks(s, first + 1);
  let end = start;
  while (isNameChar(s.charAt(end))) end++;
  const word = s.slice(start, end);
  return word === "if" || word === "else" || word === "end" ? "pattern" : "directive";
}

function addError(st: State, code: ErrorCode, line: number, column: number, message: string, once = false): void {
  if (once) {
    if (st.errorLines.has(line)) return;
    st.errorLines.add(line);
  }
  st.errors.push({ code, line, column, message });
}

function processLine(st: State, s: string, line: number): void {
  const kind = classify(s);
  if (kind === "blank") return;
  if (kind === "pattern") return parsePatternLine(st, s, line);
  const brace = skipBlanks(s, 0);
  if (st.block) throw new Fail("directive-in-conditional", brace + 1, "a directive line cannot sit inside an {if} block");
  parseDirective(st, s, line, brace);
}

function paramAllows(param: Param, value: string): boolean {
  if (param.kind === "options") return param.values.includes(value);
  return /^\d+$/.test(value) && Number(value) >= param.min && Number(value) <= param.max;
}

const BUILT_IN = { start: 48, end: 60 };

function fileLevelErrors(st: State): void {
  const at = (code: ErrorCode, line: number, column: number, message: string) =>
    addError(st, code, line, column, message);

  if (st.title === undefined) at("missing-title", 1, 1, "a file needs a {title}");
  if (st.noteCount === 0) at("missing-pattern", 1, 1, "a file needs at least one note or rest");

  const seen = new Set<string>();
  for (const o of st.occurrences) {
    if (seen.has(o.key)) at("duplicate-directive", o.line, o.column, `"${o.key.replace("param:", "param ")}" appears twice`);
    seen.add(o.key);
  }

  const params = new Map<string, Param>();
  for (const { param } of st.params) {
    if (SETTINGS.has(param.name))
      at("reserved-param-name", param.nameSpan.line, param.nameSpan.column, `"${param.name}" is a setting name`);
    if (!params.has(param.name)) params.set(param.name, param);
  }

  const vowelParam = st.params.find((d) => d.param.name === "vowel");
  if (st.vowel && vowelParam) {
    const later = [st.vowel, vowelParam].sort((a, b) => a.line - b.line)[1] ?? vowelParam;
    at("conflicting-directives", later.line, later.column, "{vowel} and {param: vowel} cannot both be set");
  }

  for (const pairs of st.defaultsLists) {
    const keys = new Set<string>();
    const first = new Map<string, DefaultPair>();
    for (const pair of pairs) {
      if (keys.has(pair.key)) at("duplicate-directive", pair.keySpan.line, pair.keySpan.column, `"${pair.key}" appears twice`);
      keys.add(pair.key);
      if (!first.has(pair.key)) first.set(pair.key, pair);
      if (SETTINGS.has(pair.key)) continue;
      const param = params.get(pair.key);
      if (!param) at("unknown-key", pair.keySpan.line, pair.keySpan.column, `"${pair.key}" is not a setting or a declared parameter`);
      else if (!paramAllows(param, pair.value))
        at("invalid-param-value", pair.valueSpan.line, pair.valueSpan.column, `"${pair.value}" is not a value of ${pair.key}`);
    }
    const start = first.get("start");
    const end = first.get("end");
    if (first.has("voice") || (!start && !end)) continue;
    const midi = (pair: DefaultPair | undefined, fallback: number) =>
      pair ? noteNameMidi(pair.value, 0, pair.value.length) : fallback;
    if (midi(start, BUILT_IN.start) > midi(end, BUILT_IN.end)) {
      const where = (end ?? start)?.keySpan;
      if (where) at("range-order", where.line, where.column, "start is above end");
    }
  }

  for (const ref of st.ifRefs) {
    const param = params.get(ref.name);
    if (!param) at("unknown-param", ref.nameSpan.line, ref.nameSpan.column, `"${ref.name}" is not a declared parameter`);
    else if (!paramAllows(param, ref.value))
      at("invalid-param-value", ref.valueSpan.line, ref.valueSpan.column, `"${ref.value}" is not a value of ${ref.name}`);
  }

  if (st.meter !== undefined) {
    for (const bar of st.bars) {
      if (bar.hasContent && bar.quarters !== st.meter * 4)
        at("bar-length", bar.line, bar.column, `bar has ${bar.quarters / 4} beats, expected ${st.meter}`);
    }
  }
}

function sortErrors(errors: ParseError[]): ParseError[] {
  const rank = (code: ErrorCode) => CODE_ORDER.indexOf(code);
  return errors.sort((a, b) => a.line - b.line || a.column - b.column || rank(a.code) - rank(b.code));
}

/**
 * Parses `.vex` text into an Exercise AST. Never throws on bad input: every error found comes back in
 * `errors`, and a file with any error has no AST.
 */
export function parse(source: string): ParseResult {
  if (utf8Length(source) > MAX_BYTES)
    return {
      ok: false,
      errors: [{ code: "file-too-large", line: 1, column: 1, message: `a file is at most ${MAX_BYTES} bytes` }],
    };

  const st: State = {
    errors: [],
    errorLines: new Set(),
    directives: [],
    occurrences: [],
    translations: { title: {}, description: {} },
    defaultsLists: [],
    params: [],
    top: [],
    itemCount: 0,
    overflowed: false,
    noteCount: 0,
    bars: [],
    ifRefs: [],
  };

  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const lines = text.split("\n");
  lines.forEach((raw, index) => {
    const line = index + 1;
    // A `\r` ends a line only as part of `\r\n`; any other one is a control character.
    const s = index < lines.length - 1 && raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    let control = -1;
    for (let i = 0; i < s.length; i++) {
      if (isControl(s.charCodeAt(i))) {
        control = i;
        break;
      }
    }
    let failure: Fail | undefined;
    try {
      processLine(st, s, line);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      failure = e;
    }
    if (control >= 0 && (!failure || failure.code === "unterminated" || failure.column > control)) {
      failure = new Fail("unexpected-character", control + 1, "control characters are not allowed");
    }
    if (failure) addError(st, failure.code, line, failure.column, failure.message, true);
  });

  if (st.block) {
    const { line, column } = st.block.node.ifSpan;
    addError(st, "unclosed-if", line, column, "{if} is never closed by {end}", true);
  }

  if (st.errors.length === 0) fileLevelErrors(st);
  if (st.errors.length > 0) return { ok: false, errors: sortErrors(st.errors) };

  const exercise: Exercise = {
    title: st.title ?? "",
    translations: st.translations,
    facets: { focus: st.focus ?? [], technique: st.technique ?? [] },
    defaults: st.defaultsLists[0] ?? [],
    params: st.params.map((d) => d.param),
    pattern: st.top,
    directives: st.directives,
  };
  if (st.description !== undefined) exercise.description = st.description;
  if (st.author !== undefined) exercise.author = st.author;
  if (st.level !== undefined) exercise.facets.level = st.level;
  if (st.voice !== undefined) exercise.facets.voice = st.voice;
  if (st.vowel) exercise.vowel = st.vowel.value;
  if (st.cue) exercise.cue = st.cue;
  if (st.meter !== undefined) exercise.meter = st.meter;
  return { ok: true, exercise, errors: [] };
}
