import type {
  Chord,
  Conditional,
  DefaultPair,
  DirectiveNode,
  ErrorCode,
  Param,
  ParseError,
  PatternItem,
  Span,
} from "./ast.js";

/** A syntax error found while reading one line. It ends that line; the parser recovers at the next. */
export class Fail extends Error {
  constructor(
    readonly code: ErrorCode,
    /** 1-based column. */
    readonly column: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Located {
  line: number;
  column: number;
}

export interface BarRecord extends Located {
  quarters: number;
  hasContent: boolean;
}

export interface IfRef {
  name: string;
  value: string;
  nameSpan: Span;
  valueSpan: Span;
}

export interface ParamDecl extends Located {
  param: Param;
}

export interface State {
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
  /** Index in the current pattern line of the item being read; where recovery restarts after an error. */
  itemStart: number;
  overflowed: boolean;
  noteCount: number;
  bars: BarRecord[];
  ifRefs: IfRef[];
}

export function addError(st: State, code: ErrorCode, line: number, column: number, message: string, once = false): void {
  if (once) {
    if (st.errorLines.has(line)) return;
    st.errorLines.add(line);
  }
  st.errors.push({ code, line, column, message });
}
