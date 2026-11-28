import type { Exercise, Param } from "./ast.js";
import { noteNameMidi } from "./directives.js";
import { VOICES, type Voice } from "./voices.js";

export type Direction = "up" | "down" | "up-down" | "down-up";

/** A full set of settings for one run. `expand` reads it; the layers that fill it are not part of the engine yet. */
export interface Settings {
  /** MIDI note of the lowest root. */
  start: number;
  /** MIDI note of the highest note the run may reach. */
  end: number;
  /** Beats per minute. `expand` times events in beats, so it does not read this. */
  tempo: number;
  /** Semitones between repetitions, 1 to 12. */
  step: number;
  direction: Direction;
  /** Play the `{cue}` before each repetition. */
  cue: boolean;
  /** Bars of clicks before the first cue; 0 is off. */
  countIn: number;
  /** One value per declared `{param}`, as the text the format uses: `"minor"`, `"3"` for a slider. */
  params: Record<string, string>;
}

/** The built-in value of every setting, from the Settings table of docs/vex-format.md. `voice` has none. */
export const BUILT_IN_SETTINGS: Readonly<Omit<Settings, "params">> = {
  start: 48, // C3
  end: 60, // C4
  tempo: 100,
  step: 1,
  direction: "up",
  cue: true,
  countIn: 1,
};

/** The default of a parameter: the first listed value, or the lower end of a range. */
export function paramDefault(param: Param): string {
  return param.kind === "options" ? (param.values[0] ?? "") : String(param.min);
}

/**
 * The settings of an exercise before any other layer: the built-in values, then its `{defaults}`.
 *
 * A `voice` pair fills `start` and `end` from the preset, and an explicit `start` or `end` in the same
 * directive wins over it. Every declared `{param}` gets its default unless `{defaults}` sets it.
 * `parse` has already checked every `{defaults}` value, so none is re-validated here.
 */
export function defaultSettings(exercise: Exercise): Settings {
  const settings: Settings = { ...BUILT_IN_SETTINGS, params: {} };
  for (const param of exercise.params) settings.params[param.name] = paramDefault(param);

  const pairs = new Map(exercise.defaults.map((pair) => [pair.key, pair.value]));
  const voice = pairs.get("voice");
  if (voice !== undefined) {
    const range = VOICES[voice as Voice];
    settings.start = range.lowest;
    settings.end = range.highest;
  }

  for (const [key, value] of pairs) {
    switch (key) {
      case "voice":
        break;
      case "start":
      case "end":
        settings[key] = noteNameMidi(value, 0, value.length);
        break;
      case "tempo":
      case "step":
        settings[key] = Number(value);
        break;
      case "direction":
        settings.direction = value as Direction;
        break;
      case "cue":
        settings.cue = value === "on";
        break;
      case "count-in":
        settings.countIn = value === "off" ? 0 : Number.parseInt(value, 10);
        break;
      default:
        settings.params[key] = value;
    }
  }
  return settings;
}
