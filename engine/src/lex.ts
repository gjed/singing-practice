import type { Span } from "./ast.js";

export const isBlank = (c: string) => c === " " || c === "\t";
export const isDigit = (c: string) => c >= "0" && c <= "9";
export const isLower = (c: string) => c >= "a" && c <= "z";
export const isWordChar = (c: string) => isLower(c) || isDigit(c);
export const isNameChar = (c: string) => isWordChar(c) || c === "-";
export const isControl = (code: number) => (code < 0x20 && code !== 0x09) || code === 0x7f;

export function skipBlanks(s: string, i: number, end = s.length): number {
  while (i < end && isBlank(s.charAt(i))) i++;
  return i;
}

export function utf8Length(text: string): number {
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
export function sp(line: number, start: number, end: number): Span {
  return { line, column: start + 1, endLine: line, endColumn: end + 1 };
}

export function describe(c: string): string {
  return c === "" ? "end of line" : `"${c}"`;
}

/** Matches one code point as a Unicode letter, or as a letter or combining mark. */
export const LETTER = /^\p{L}$/u;
export const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
