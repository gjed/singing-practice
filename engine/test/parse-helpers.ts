import { expect, it } from "vitest";
import { parse } from "../src/index.js";
import type { Exercise, ParseError, PatternItem, Pitch } from "../src/index.js";

/** A column given as a number, or as the first (or last) place a string occurs in the source. */
export type At = number | { find: string; last?: boolean };

export function column(source: string, at: At): number {
  if (typeof at === "number") return at;
  const index = at.last ? source.lastIndexOf(at.find) : source.indexOf(at.find);
  if (index < 0) throw new Error(`"${at.find}" is not in the source`);
  return index + 1;
}

export const summary = (errors: ParseError[]) => errors.map((e) => `${e.code} ${e.line}:${e.column}`);

export function errorsOf(source: string): string[] {
  return summary(parse(source).errors);
}

export function exerciseOf(source: string): Exercise {
  const result = parse(source);
  if (!result.ok) throw new Error(`expected a valid file, got ${summary(result.errors).join(", ")}`);
  return result.exercise;
}

export const withHeader = (body: string, extra = "") => `{title: T}\n${extra}${body}`;

export type Row = [source: string, code: string, at: At, line?: number];

export function checkRows(rows: Row[]) {
  it.each(rows)("%j", (source, code, at, line = 1) => {
    const errors = errorsOf(source);
    expect(errors).toEqual([`${code} ${line}:${column(source.split("\n")[line - 1] ?? "", at)}`]);
  });
}

function pitchText(p: Pitch): string {
  const mark = p.octave < 0 ? ",".repeat(-p.octave) : "'".repeat(p.octave);
  return `${p.alter < 0 ? "b" : p.alter > 0 ? "#" : ""}${p.degree}${mark}`;
}

/** Writes the items back as compact text, from the AST fields rather than the source text. */
export function itemsText(items: PatternItem[]): string[] {
  return items.flatMap((item): string[] => {
    const dur = (d: { numerator: number; denominator: number; span?: unknown }) =>
      d.span ? `:${d.numerator}${d.denominator === 1 ? "" : `/${d.denominator}`}` : "";
    switch (item.kind) {
      case "note":
        return [
          pitchText(item.pitch) +
            (item.glideTo ? `~${pitchText(item.glideTo)}` : "") +
            (item.syllable === undefined ? "" : `/${item.syllable}`) +
            dur(item.duration),
        ];
      case "rest":
        return [`r${dur(item.duration)}`];
      case "chord":
        return [`[${item.numeral}${item.quality}${item.duration ? dur(item.duration) : ""}]`];
      case "chord-off":
        return ["[-]"];
      case "bar":
        return ["|"];
      case "conditional":
        return [
          `IF ${item.param}=${item.value}`,
          ...itemsText(item.then),
          ...(item.else ? ["ELSE", ...itemsText(item.else)] : []),
          "END",
        ];
    }
  });
}
