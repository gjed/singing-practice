import type { Exercise, ParseResult } from "./ast.js";
import { fileLevelErrors, sortErrors } from "./checks.js";
import { parseDirective } from "./directives.js";
import { isControl, isNameChar, skipBlanks, utf8Length } from "./lex.js";
import { parsePatternLine, recoverConditionals } from "./pattern.js";
import { Fail, type State, addError } from "./state.js";

const MAX_BYTES = 65_536;

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

function processLine(st: State, s: string, line: number): void {
  const kind = classify(s);
  if (kind === "blank") return;
  if (kind === "pattern") {
    try {
      parsePatternLine(st, s, line);
    } catch (e) {
      if (e instanceof Fail) recoverConditionals(st, s, line);
      throw e;
    }
    return;
  }
  const brace = skipBlanks(s, 0);
  if (st.block) throw new Fail("directive-in-conditional", brace + 1, "a directive line cannot sit inside an {if} block");
  parseDirective(st, s, line, brace);
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
    itemStart: 0,
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
