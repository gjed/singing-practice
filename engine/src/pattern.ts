import type { Bar, Conditional, Duration, Note, PatternItem, Pitch, Span } from "./ast.js";
import { describe, isBlank, isDigit, isLower, isNameChar, isWordChar, skipBlanks, sp } from "./lex.js";
import { Fail, addError, type State } from "./state.js";
import { MAX_SYLLABLE, parseChord, parseDuration, parsePitch, readSyllable } from "./tokens.js";

const MAX_ITEMS = 1_024;

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

export function parsePatternLine(st: State, s: string, line: number): void {
  let quarters = 0;
  let hasContent = false;
  const endBar = (index: number) => {
    st.bars.push({ line, column: index + 1, quarters, hasContent });
    quarters = 0;
    hasContent = false;
  };

  let i = skipBlanks(s, 0);
  while (i < s.length) {
    st.itemStart = i;
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
        if (d) {
          duration = d.duration;
          end = d.end;
        }
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
        if (d) {
          duration = d.duration;
          end = d.end;
        }
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
      hasContent = true;
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

/**
 * After an error ends a pattern line, the `{if}`, `{else}` and `{end}` tokens in the rest of it (from the
 * item that failed) still open and close the block, so one real error does not cause follow-on errors.
 * Nothing is reported here: the line already has its error.
 */
export function recoverConditionals(st: State, s: string, line: number): void {
  const token = /\{[ \t]*(if|else|end)(?![a-z0-9-])[^}]*\}?/g;
  token.lastIndex = st.itemStart;
  for (let m = token.exec(s); m; m = token.exec(s)) {
    const span = sp(line, m.index, m.index + m[0].length);
    if (m[1] === "if") {
      if (st.block) continue;
      const node: Conditional = {
        kind: "conditional",
        param: "",
        value: "",
        paramSpan: span,
        valueSpan: span,
        then: [],
        ifSpan: span,
        endSpan: span,
        span,
      };
      st.top.push(node);
      st.block = { node, inElse: false };
    } else if (m[1] === "else") {
      if (st.block && !st.block.inElse) {
        st.block.node.else = [];
        st.block.inElse = true;
      }
    } else {
      st.block = undefined;
    }
  }
}
