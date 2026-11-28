import { existsSync, readFileSync } from "node:fs";
import { noteNameMidi } from "../src/directives.js";
import { defaultSettings, expand, parse } from "../src/index.js";
import type { Exercise, Settings } from "../src/index.js";
import { SETTINGS_SUFFIX } from "./golden.js";
import type { Transform } from "./golden.js";

/** The function the parse fixtures in `fixtures/` run through: `.vex` text in, the AST or the errors out. */
export const transform: Transform = (source) => parse(source);

/**
 * What a `<name>.settings.json` may hold: the fields of `Settings` to override on top of the settings that
 * `defaultSettings` gives the exercise. `start` and `end` may be note names (`"C3"`) instead of MIDI numbers,
 * and `params` is merged into the parameter values.
 */
type SettingsOverride = Partial<Omit<Settings, "start" | "end">> & {
  start?: string | number;
  end?: string | number;
};

const midiOf = (value: string | number): number =>
  typeof value === "number" ? value : noteNameMidi(value, 0, value.length);

function settingsFor(exercise: Exercise, settingsPath: string): Settings {
  const settings = defaultSettings(exercise);
  if (!existsSync(settingsPath)) return settings;

  const { start, end, params, ...rest } = JSON.parse(readFileSync(settingsPath, "utf8")) as SettingsOverride;
  for (const key of Object.keys(rest)) {
    if (!(key in settings)) throw new Error(`${settingsPath}: "${key}" is not a setting`);
  }
  return {
    ...settings,
    ...rest,
    ...(start === undefined ? {} : { start: midiOf(start) }),
    ...(end === undefined ? {} : { end: midiOf(end) }),
    params: { ...settings.params, ...params },
  };
}

/**
 * The function the expand fixtures in `expand-fixtures/` run through: `.vex` text in, the settings that were
 * used and the event list out. The settings are `defaultSettings` of the file, overridden by the
 * `<name>.settings.json` beside it when there is one.
 */
export const expandTransform: Transform = (source, ctx) => {
  const result = parse(source);
  if (!result.ok) throw new Error(`fixture does not parse: ${JSON.stringify(result.errors)}`);
  const settings = settingsFor(result.exercise, ctx.vexPath.replace(/\.vex$/, SETTINGS_SUFFIX));
  return { settings, events: expand(result.exercise, settings) };
};
