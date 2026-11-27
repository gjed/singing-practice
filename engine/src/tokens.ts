import type { Chord, ChordOff, ChordQuality, Duration, Pitch } from "./ast.js";
import { LETTER, LETTER_OR_MARK, describe, isDigit, sp } from "./lex.js";
import { Fail } from "./state.js";

export const MAX_SYLLABLE = 16;
const MAX_BEATS = 64;
const UPPER_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
const LOWER_NUMERALS = ["i", "ii", "iii", "iv", "v", "vi", "vii"];
const QUALITIES: ChordQuality[] = ["maj7", "dim", "7"];

/**
 * Reads a duration at a `:`. Without a digit after the colon there is no duration, so the item ends before
 * the colon and the caller's separation (or chord) check reports it.
 */
export function parseDuration(s: string, colon: number, line: number): { duration: Duration; end: number } | undefined {
  const bad = (why: string) => new Fail("invalid-duration", colon + 1, why);
  let p = colon + 1;
  if (!isDigit(s.charAt(p))) return undefined;
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

export function parsePitch(s: string, start: number, line: number): { pitch: Pitch; end: number } {
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
  if (!isDigit(s.charAt(p))) throw new Fail("invalid-degree", p + 1, `expected a degree number, found ${describe(s.charAt(p))}`);
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
export function readSyllable(s: string, start: number, limit: number): { text: string; end: number; count: number } {
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
export function parseChord(s: string, open: number, limit: number, line: number): Chord | ChordOff {
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
    if (d) {
      duration = d.duration;
      p = d.end;
    }
  }
  if (p !== close) throw bad(`unexpected ${describe(s.charAt(p))} in a chord`);
  const chord: Chord = { kind: "chord", numeral, degree, quality, span };
  if (duration) chord.duration = duration;
  return chord;
}
