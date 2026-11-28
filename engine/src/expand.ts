import type { Chord, Duration, Exercise, PatternItem, Pitch } from "./ast.js";
import { paramDefault, type Direction, type Settings } from "./settings.js";

/**
 * One thing that sounds or shows in a run. `time` and `duration` are in beats, counted from the first
 * count-in click (time 0), so tempo is the playback's business. `repetition` is the 0-based index of the
 * repetition the event belongs to, in the order the roots are sung.
 */
export type Event = ClickEvent | NoteEvent | GlideEvent | ChordEvent;

/** One count-in click. It belongs to no repetition. */
export interface ClickEvent {
  kind: "click";
  time: number;
  duration: number;
}

export interface NoteEvent {
  kind: "note";
  time: number;
  duration: number;
  midi: number;
  syllable?: string;
  repetition: number;
}

/** A glide from `midi[0]` to `midi[1]` over its duration. */
export interface GlideEvent {
  kind: "glide";
  time: number;
  duration: number;
  midi: [from: number, to: number];
  syllable?: string;
  repetition: number;
}

/** A block chord, root position, lowest tone first. Plays as the `{cue}` or from the pattern. */
export interface ChordEvent {
  kind: "chord";
  time: number;
  duration: number;
  midi: number[];
  repetition: number;
}

/** Semitones above the tonic of each degree 1 to 7, per scale (see "Scales" in docs/vex-format.md). */
const SCALES: Readonly<Record<string, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

const MIDI_MAX = 127;
const DEFAULT_METER = 4;

const beats = (d: Duration): number => d.numerator / d.denominator;

/** A pattern slot with its pitches as semitones above the root, so it can be placed on any root. */
interface Slot {
  kind: "note" | "glide" | "chord";
  at: number;
  duration: number;
  offsets: number[];
  syllable?: string;
  /** Beat where a chord stops sounding: its own cap, shortened by whatever cuts it off. */
  end?: number;
}

function paramValue(exercise: Exercise, settings: Settings, name: string): string | undefined {
  const param = exercise.params.find((p) => p.name === name);
  return settings.params[name] ?? (param && paramDefault(param));
}

function pitchOffset(pitch: Pitch, scale: readonly number[]): number {
  const index = pitch.degree - 1;
  return (scale[index % 7] ?? 0) + 12 * Math.floor(index / 7) + pitch.alter + 12 * pitch.octave;
}

/**
 * The voicing is a root-position block chord on the root of its numeral, with no octave shift. Upper-case
 * numerals are major, lower-case minor; `dim` is a diminished triad.
 */
function chordOffsets(chord: Chord, scale: readonly number[]): number[] {
  const minor = chord.numeral === chord.numeral.toLowerCase();
  const third = minor ? 3 : 4;
  const intervals = {
    "": [0, third, 7],
    "7": [0, third, 7, 10],
    maj7: [0, 4, 7, 11],
    dim: [0, 3, 6],
  }[chord.quality];
  const root = scale[chord.degree - 1] ?? 0;
  return intervals.map((i) => root + i);
}

/** Picks the branch of every `{if}` from the parameter values, so the pattern is one flat list. */
function flatten(items: PatternItem[], pick: (param: string) => string | undefined): PatternItem[] {
  return items.flatMap((item) => {
    if (item.kind !== "conditional") return [item];
    return pick(item.param) === item.value ? item.then : (item.else ?? []);
  });
}

function buildSlots(
  items: PatternItem[],
  scale: readonly number[],
  vowel: string | undefined,
): { slots: Slot[]; length: number } {
  const slots: Slot[] = [];
  let at = 0;
  let holding: Slot | undefined;
  const cut = (beat: number) => {
    if (holding?.end !== undefined) holding.end = Math.min(holding.end, beat);
    holding = undefined;
  };
  for (const item of items) {
    switch (item.kind) {
      case "note": {
        const duration = beats(item.duration);
        const syllable = item.syllable ?? vowel;
        const base = { at, duration, ...(syllable === undefined ? {} : { syllable }) };
        const from = pitchOffset(item.pitch, scale);
        slots.push(
          item.glideTo
            ? { kind: "glide", offsets: [from, pitchOffset(item.glideTo, scale)], ...base }
            : { kind: "note", offsets: [from], ...base },
        );
        at += duration;
        break;
      }
      case "rest":
        at += beats(item.duration);
        break;
      case "chord": {
        cut(at);
        holding = {
          kind: "chord",
          at,
          duration: 0,
          offsets: chordOffsets(item, scale),
          end: at + (item.duration ? beats(item.duration) : Number.POSITIVE_INFINITY),
        };
        slots.push(holding);
        break;
      }
      case "chord-off":
        cut(at);
        break;
      default:
        break;
    }
  }
  cut(at);
  for (const slot of slots) {
    if (slot.kind === "chord") slot.duration = Math.min(slot.end ?? at, at) - slot.at;
  }
  return { slots: slots.filter((s) => s.kind !== "chord" || s.duration > 0), length: at };
}

/** The roots of a run in the order they are sung. `grid` ascends. */
function ordered(grid: number[], direction: Direction): number[] {
  const down = [...grid].reverse();
  switch (direction) {
    case "up":
      return grid;
    case "down":
      return down;
    case "up-down":
      return [...grid, ...down.slice(1)];
    case "down-up":
      return [...down, ...grid.slice(1)];
  }
}

/**
 * Turns an exercise and a full set of settings into the event list of a run.
 *
 * - **Count-in.** `count-in` bars of one click per beat, a bar being `{meter}` beats, or 4 without it.
 * - **Roots.** The grid is `start`, `start + step`, … in semitones. A root is dropped when it is above
 *   `end`, when its highest sung note (a note, or either end of a glide; accompaniment chords do not count)
 *   would pass `end`, or when any of its pitches, accompaniment included, would leave MIDI 0 to 127. Notes
 *   below `start` are fine. The grid is anchored at `start` in every direction, so `down` is `up` reversed.
 * - **Direction.** `up-down` and `down-up` do not repeat the turning root: C D E D C, E D C D E.
 * - **Repetition.** The `{cue}` chord when `cue` is on, then the pattern, with nothing in between. The next
 *   repetition starts when the pattern ends, rests at its end included.
 * - **Pitches.** A degree resolves through the `scale` parameter (`major` when there is none), then the
 *   accidental and the octave marks apply. Syllables fall back to the `vowel`, from `{vowel}` or the
 *   `vowel` parameter.
 * - **Chords.** A chord in the pattern sounds until the next chord, `[-]`, its own duration or the end of
 *   the pattern, whichever is first. One cut off at its own start never sounds and gives no event.
 *
 * Parameter values missing from `settings.params` take their default.
 */
export function expand(exercise: Exercise, settings: Settings): Event[] {
  if (!(settings.step >= 1)) throw new RangeError(`step must be at least 1, got ${settings.step}`);

  const events: Event[] = [];
  const perBar = exercise.meter ?? DEFAULT_METER;
  const clicks = settings.countIn * perBar;
  for (let i = 0; i < clicks; i++) events.push({ kind: "click", time: i, duration: 1 });

  const scaleName = paramValue(exercise, settings, "scale") ?? "major";
  const scale = SCALES[scaleName] ?? SCALES["major"]!;
  const vowel = paramValue(exercise, settings, "vowel") ?? exercise.vowel;
  const { slots, length } = buildSlots(
    flatten(exercise.pattern, (name) => paramValue(exercise, settings, name)),
    scale,
    vowel,
  );

  const cue = settings.cue ? exercise.cue : undefined;
  const cueOffsets = cue ? chordOffsets(cue, scale) : [];
  const cueLength = cue?.duration ? beats(cue.duration) : cue ? 1 : 0;

  const sung = slots.filter((s) => s.kind !== "chord").flatMap((s) => s.offsets);
  const top = sung.length > 0 ? Math.max(...sung) : Number.NEGATIVE_INFINITY;
  const all = [...slots.flatMap((s) => s.offsets), ...cueOffsets];
  const lowest = all.length > 0 ? Math.min(...all) : 0;
  const highest = all.length > 0 ? Math.max(...all) : 0;

  const grid: number[] = [];
  for (let root = settings.start; root <= settings.end; root += settings.step) {
    if (root + top <= settings.end && root + lowest >= 0 && root + highest <= MIDI_MAX) grid.push(root);
  }

  let time = clicks;
  ordered(grid, settings.direction).forEach((root, repetition) => {
    if (cue) {
      events.push({
        kind: "chord",
        time,
        duration: cueLength,
        midi: cueOffsets.map((o) => root + o),
        repetition,
      });
    }
    const origin = time + cueLength;
    for (const slot of slots) {
      const base = { time: origin + slot.at, duration: slot.duration, repetition };
      const midi = slot.offsets.map((o) => root + o);
      const syllable = slot.syllable === undefined ? {} : { syllable: slot.syllable };
      if (slot.kind === "chord") events.push({ kind: "chord", ...base, midi });
      else if (slot.kind === "glide") events.push({ kind: "glide", ...base, midi: [midi[0]!, midi[1]!], ...syllable });
      else events.push({ kind: "note", ...base, midi: midi[0]!, ...syllable });
    }
    time = origin + length;
  });
  return events;
}
