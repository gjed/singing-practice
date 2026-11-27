/**
 * The Exercise AST that `parse` produces from a `.vex` file (see docs/vex-format.md).
 *
 * Every node that stands for source text carries a `Span`. Lines and columns are 1-based, a column counts
 * UTF-16 code units from the start of the line, and the end is exclusive (`endColumn` is the column just
 * past the last character). The exercise id comes from the file path, not from the parser.
 */

export interface Span {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export type ErrorCode =
  // Syntax errors
  | "file-too-large"
  | "unexpected-character"
  | "unterminated"
  | "unknown-directive"
  | "misplaced-directive"
  | "invalid-translation"
  | "missing-value"
  | "invalid-value"
  | "expected-blank"
  | "invalid-degree"
  | "invalid-duration"
  | "invalid-syllable"
  | "invalid-chord"
  | "invalid-conditional"
  | "nested-if"
  | "unmatched-conditional"
  | "directive-in-conditional"
  | "unclosed-if"
  | "too-many-items"
  // File-level errors
  | "missing-title"
  | "missing-pattern"
  | "duplicate-directive"
  | "reserved-param-name"
  | "conflicting-directives"
  | "unknown-key"
  | "invalid-param-value"
  | "range-order"
  | "unknown-param"
  | "bar-length";

export interface ParseError {
  code: ErrorCode;
  line: number;
  column: number;
  message: string;
}

/** Length in beats, as written: `:3/2` is `{ numerator: 3, denominator: 2 }`. */
export interface Duration {
  numerator: number;
  denominator: 1 | 2 | 4;
  /** Source of the `:…` text. Absent when the duration is the default of 1 beat. */
  span?: Span;
}

export interface Pitch {
  /** Semitones added to the resolved degree: -1 for `b`, 1 for `#`. */
  alter: -1 | 0 | 1;
  /** 1 to 10, as written (8 is `1` one octave up). */
  degree: number;
  /** Octave marks: `,` counts -1 each, `'` counts +1 each, so -3 to 3. */
  octave: number;
  span: Span;
}

export interface Note {
  kind: "note";
  pitch: Pitch;
  /** The second pitch of a glide `1~5`. */
  glideTo?: Pitch;
  syllable?: string;
  duration: Duration;
  span: Span;
}

export interface Rest {
  kind: "rest";
  duration: Duration;
  span: Span;
}

export type ChordQuality = "" | "7" | "maj7" | "dim";

export interface Chord {
  kind: "chord";
  /** The Roman numeral as written, case kept: `V`, `ii`. */
  numeral: string;
  /** The scale degree of the root, 1 to 7. */
  degree: number;
  quality: ChordQuality;
  /** Caps the hold in the body; how long the cue sounds in `{cue}`. Absent when not written. */
  duration?: Duration;
  span: Span;
}

/** `[-]` */
export interface ChordOff {
  kind: "chord-off";
  span: Span;
}

export interface Bar {
  kind: "bar";
  span: Span;
}

/** `{if name=value} … {else} … {end}`, both branches kept. */
export interface Conditional {
  kind: "conditional";
  param: string;
  value: string;
  paramSpan: Span;
  valueSpan: Span;
  then: PatternItem[];
  /** Absent when the block has no `{else}`. */
  else?: PatternItem[];
  /** The `{if …}` token. */
  ifSpan: Span;
  elseSpan?: Span;
  endSpan: Span;
  /** From the `{` of `{if` to the `}` of `{end}`. */
  span: Span;
}

export type PatternItem = Note | Rest | Chord | ChordOff | Bar | Conditional;

export interface ListParam {
  kind: "options";
  name: string;
  /** Two or more distinct values; the first is the default. */
  values: string[];
  nameSpan: Span;
  span: Span;
}

export interface RangeParam {
  kind: "range";
  name: string;
  /** Integers from `min` to `max`, with `max > min`; `min` is the default. */
  min: number;
  max: number;
  nameSpan: Span;
  span: Span;
}

export type Param = ListParam | RangeParam;

/** One `key=value` pair of `{defaults}`. The value is the validated text; `voice` is not expanded here. */
export interface DefaultPair {
  key: string;
  value: string;
  keySpan: Span;
  valueSpan: Span;
  span: Span;
}

export interface DirectiveNode {
  name: string;
  /** Language code of a translation (`it` in `{title.it: …}`). */
  lang?: string;
  /** The whole directive, `{` to `}`. */
  span: Span;
}

export interface Exercise {
  title: string;
  description?: string;
  author?: string;
  translations: {
    title: Record<string, string>;
    description: Record<string, string>;
  };
  /** Shape only; the vocabulary is checked by `vex lint`. */
  facets: {
    focus: string[];
    technique: string[];
    level?: string;
    voice?: string;
  };
  defaults: DefaultPair[];
  params: Param[];
  vowel?: string;
  cue?: Chord;
  /** Beats per bar, 1 to 16. */
  meter?: number;
  pattern: PatternItem[];
  /** Every directive in source order. */
  directives: DirectiveNode[];
}

/**
 * A file with any error has no AST, so the result is one or the other. `errors` holds every error found,
 * sorted by line, then column, then the order of the spec's tables.
 */
export type ParseResult =
  | { ok: true; exercise: Exercise; errors: [] }
  | { ok: false; errors: ParseError[] };
