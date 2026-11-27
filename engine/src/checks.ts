import type { DefaultPair, ErrorCode, Param, ParseError } from "./ast.js";
import { SETTINGS, noteNameMidi } from "./directives.js";
import { addError, type State } from "./state.js";

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

function paramAllows(param: Param, value: string): boolean {
  if (param.kind === "options") return param.values.includes(value);
  return /^\d+$/.test(value) && Number(value) >= param.min && Number(value) <= param.max;
}

const BUILT_IN = { start: 48, end: 60 };

export function fileLevelErrors(st: State): void {
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

export function sortErrors(errors: ParseError[]): ParseError[] {
  const rank = (code: ErrorCode) => CODE_ORDER.indexOf(code);
  return errors.sort((a, b) => a.line - b.line || a.column - b.column || rank(a.code) - rank(b.code));
}
