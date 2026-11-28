import { describe, expect, it } from "vitest";
import { defaultSettings, expand } from "../src/index.js";
import type { Event, Settings } from "../src/index.js";
import { exerciseOf, withHeader } from "./parse-helpers.js";

/** Settings with no count-in and no cue, so a test sees the pattern only unless it asks for more. */
const run = (source: string, overrides: Partial<Settings> = {}): Event[] => {
  const exercise = exerciseOf(source);
  return expand(exercise, { ...defaultSettings(exercise), cue: false, countIn: 0, ...overrides });
};

const body = (pattern: string, extra = "") => withHeader(`${pattern}\n`, extra);

/** The events of the first repetition. */
const firstRepetition = (source: string, overrides: Partial<Settings> = {}): Event[] =>
  run(source, { start: 60, end: 127, ...overrides }).filter((e) => e.kind !== "click" && e.repetition === 0);

const noteNumbers = (events: Event[]) => events.flatMap((e) => (e.kind === "note" ? [e.midi] : []));

const rootsOf = (events: Event[]) => {
  const roots = new Map<number, number>();
  for (const e of events) if (e.kind === "note" && !roots.has(e.repetition)) roots.set(e.repetition, e.midi);
  return [...roots.values()];
};

describe("expand, hand-checked", () => {
  // range/major-arpeggio at C3 to A3, step +1, up, no count-in. A root's highest note is its fifth, 7 semitones
  // up, and it must not pass A3 (57), so the roots are C3 (48), C#3 (49) and D3 (50).
  // A repetition is the 2-beat cue plus the 8-beat pattern (1 3 5 3 is 4 beats, 1:2 is 2, r:2 is 2): 10 beats.
  it("plays the major arpeggio at C3 to A3, step +1, up", () => {
    const exercise = exerciseOf(
      [
        "{title: Major arpeggio}",
        "{param: scale = major | minor}",
        "{vowel: ah}",
        "{cue: [I:2]}",
        "[I] 1 3 5 3 | 1:2 r:2",
      ].join("\n"),
    );
    const settings: Settings = { ...defaultSettings(exercise), start: 48, end: 57, step: 1, direction: "up", countIn: 0 };

    const repetition = (r: number, root: number): Event[] => {
      const t = r * 10;
      const triad = [root, root + 4, root + 7];
      const note = (at: number, midi: number, duration = 1): Event => ({
        kind: "note",
        time: t + at,
        duration,
        midi,
        syllable: "ah",
        repetition: r,
      });
      return [
        { kind: "chord", time: t, duration: 2, midi: triad, repetition: r },
        { kind: "chord", time: t + 2, duration: 8, midi: triad, repetition: r },
        note(2, root),
        note(3, root + 4),
        note(4, root + 7),
        note(5, root + 4),
        note(6, root, 2),
      ];
    };
    expect(expand(exercise, settings)).toEqual([...repetition(0, 48), ...repetition(1, 49), ...repetition(2, 50)]);
  });
});

describe("expand, roots", () => {
  const pattern = body("1 5");

  it("steps from start to end in every direction, without repeating the turning root", () => {
    const at = (direction: Settings["direction"]) => rootsOf(run(pattern, { start: 48, end: 62, step: 2, direction }));
    // 1 5 tops out 7 semitones above its root, so with end = 62 the roots stop at 54 (56 + 7 passes 62).
    expect(at("up")).toEqual([48, 50, 52, 54]);
    expect(at("down")).toEqual([54, 52, 50, 48]);
    expect(at("up-down")).toEqual([48, 50, 52, 54, 52, 50, 48]);
    expect(at("down-up")).toEqual([54, 52, 50, 48, 50, 52, 54]);
  });

  it("runs a single root once in every direction", () => {
    for (const direction of ["up", "down", "up-down", "down-up"] as const) {
      expect(rootsOf(run(pattern, { start: 48, end: 55, direction }))).toEqual([48]);
    }
  });

  it("anchors the grid at start, so down is up reversed", () => {
    expect(rootsOf(run(pattern, { start: 48, end: 62, step: 3, direction: "down" }))).toEqual([54, 51, 48]);
  });

  it("drops a root whose highest sung note would pass end", () => {
    expect(rootsOf(run(body("1 3 5"), { start: 48, end: 57, step: 1 }))).toEqual([48, 49, 50]);
  });

  it("counts both ends of a glide and no accompaniment chord for the highest sung note", () => {
    const glides = run(body("1~8"), { start: 48, end: 61 });
    expect(glides.map((e) => (e.kind === "glide" ? e.midi : null))).toEqual([
      [48, 60],
      [49, 61],
    ]);
    // [V7] reaches 17 semitones above the root, but nobody sings it.
    expect(rootsOf(run(body("[V7] 1"), { start: 48, end: 50 }))).toEqual([48, 49, 50]);
  });

  it("does not drop a root for notes below start, nor run a pattern of rests", () => {
    expect(noteNumbers(run(body("1 5,"), { start: 48, end: 50 }))).toEqual([48, 43, 49, 44, 50, 45]);
    expect(run(body("r:2"), { start: 48, end: 50 })).toEqual([]);
  });

  it("gives nothing when no root fits and when start is above end", () => {
    expect(run(body("1 8"), { start: 48, end: 55 })).toEqual([]);
    expect(run(body("1"), { start: 50, end: 48 })).toEqual([]);
  });

  it("drops roots that would put any pitch, accompaniment included, outside MIDI 0 to 127", () => {
    // 1 5, 8 has a note 5 semitones below the root: the lowest root is 5.
    expect(rootsOf(run(body("1 5, 8"), { start: 0, end: 127 })).slice(0, 2)).toEqual([5, 6]);
    // [V7] has a note 17 semitones above the root: the highest root is 110.
    expect(rootsOf(run(body("[V7] 1"), { start: 105, end: 127 }))).toEqual([105, 106, 107, 108, 109, 110]);
  });

  it("rejects a step below 1 instead of looping forever", () => {
    expect(() => run(pattern, { step: 0 })).toThrow(RangeError);
  });
});

describe("expand, time and count-in", () => {
  const clicks = (source: string, countIn: number) =>
    run(source, { start: 48, end: 48, countIn })
      .filter((e) => e.kind === "click")
      .map((e) => e.time);

  it("emits one click per beat, a bar being the meter or four beats", () => {
    expect(clicks(body("1"), 1)).toEqual([0, 1, 2, 3]);
    expect(clicks(body("1 r r | r r r", "{meter: 3}\n"), 2)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(clicks(body("1"), 0)).toEqual([]);
  });

  it("starts the first repetition after the count-in and the next when the pattern ends, rests included", () => {
    const events = run(body("1 r:3", "{cue: [I:2]}\n"), { start: 48, end: 49, countIn: 1, cue: true });
    expect(events.filter((e) => e.kind !== "click").map((e) => [e.kind, e.time, e.duration])).toEqual([
      ["chord", 4, 2],
      ["note", 6, 1],
      ["chord", 10, 2],
      ["note", 12, 1],
    ]);
  });

  it("plays the cue for one beat when it has no duration, and not without the setting or the directive", () => {
    const cue = "{cue: [V]}\n";
    expect(run(body("1", cue), { start: 48, end: 48, cue: true })[0]).toEqual({
      kind: "chord",
      time: 0,
      duration: 1,
      midi: [55, 59, 62],
      repetition: 0,
    });
    expect(run(body("1", cue), { start: 48, end: 48 }).map((e) => e.kind)).toEqual(["note"]);
    expect(run(body("1"), { start: 48, end: 48, cue: true }).map((e) => e.kind)).toEqual(["note"]);
  });
});

describe("expand, pitches", () => {
  it("resolves degrees, octaves and accidentals", () => {
    expect(noteNumbers(firstRepetition(body("1 2 3 4 5 6 7 8 9 10")))).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 74, 76]);
    expect(noteNumbers(firstRepetition(body("5, 5' 1'' 3,,,")))).toEqual([55, 79, 84, 28]);
    expect(noteNumbers(firstRepetition(body("b3 #4 b1")))).toEqual([63, 66, 59]);
  });

  it("applies the accidental after the scale, so b3 in minor is below the minor third", () => {
    const scale = "{param: scale = major | minor | harmonic-minor | dorian}\n";
    const at = (name: string) =>
      noteNumbers(firstRepetition(body("1 2 3 4 5 6 7 b3", scale), { params: { scale: name } }));
    expect(at("major")).toEqual([60, 62, 64, 65, 67, 69, 71, 63]);
    expect(at("minor")).toEqual([60, 62, 63, 65, 67, 68, 70, 62]);
    expect(at("harmonic-minor")).toEqual([60, 62, 63, 65, 67, 68, 71, 62]);
    expect(at("dorian")).toEqual([60, 62, 63, 65, 67, 69, 70, 62]);
  });

  it("uses the first listed scale when the settings do not name one", () => {
    const source = body("3", "{param: scale = minor | major}\n");
    expect(noteNumbers(firstRepetition(source, { params: {} }))).toEqual([63]);
  });
});

describe("expand, glides, syllables and rests", () => {
  it("gives a glide both pitches, its syllable and its duration", () => {
    expect(firstRepetition(body("1~5/ng:3"))).toEqual([
      { kind: "glide", time: 0, duration: 3, midi: [60, 67], syllable: "ng", repetition: 0 },
    ]);
  });

  it("sings the syllable of a note, else the vowel, else nothing", () => {
    const sung = (events: Event[]) => events.map((e) => (e.kind === "note" ? e.syllable : "-"));
    expect(sung(firstRepetition(body("1/ma 2 3", "{vowel: ah}\n")))).toEqual(["ma", "ah", "ah"]);
    expect(firstRepetition(body("1"))[0]).not.toHaveProperty("syllable");
  });

  it("takes the vowel from the vowel parameter", () => {
    const source = body("1", "{param: vowel = ee | oh}\n");
    expect(firstRepetition(source)[0]).toMatchObject({ syllable: "ee" });
    expect(firstRepetition(source, { params: { vowel: "oh" } })[0]).toMatchObject({ syllable: "oh" });
  });

  it("advances time by rests and by fractional durations", () => {
    expect(firstRepetition(body("1:1/2 r:1/4 2:3/2 r 3")).map((e) => e.time)).toEqual([0, 0.75, 3.25]);
  });
});

describe("expand, chords in the pattern", () => {
  const chords = (pattern: string) =>
    firstRepetition(body(pattern)).flatMap((e) => (e.kind === "chord" ? [[e.time, e.duration, e.midi.length]] : []));

  it("holds a chord until the next chord, [-], its own cap or the end of the pattern", () => {
    expect(chords("[I] 1 2 [V] 3 4 [-] 5")).toEqual([
      [0, 2, 3],
      [2, 2, 3],
    ]);
    expect(chords("[I:1] 1 2 3")).toEqual([[0, 1, 3]]);
    expect(chords("[I:9] 1 2 3")).toEqual([[0, 3, 3]]);
    expect(chords("1 2 [V7] 3 r")).toEqual([[2, 2, 4]]);
  });

  it("gives no event to a chord cut off where it starts, nor to one at the very end", () => {
    expect(chords("[I] [V] 1")).toEqual([[0, 1, 3]]);
    expect(chords("1 [V]")).toEqual([]);
  });

  it("voices root-position block chords on the root of the numeral in the current scale", () => {
    const voiced = (numeral: string, scale = "major") =>
      firstRepetition(body(`[${numeral}] 1`, "{param: scale = major | minor}\n"), { params: { scale } }).flatMap((e) =>
        e.kind === "chord" ? [e.midi] : [],
      )[0];
    expect(voiced("I")).toEqual([60, 64, 67]);
    expect(voiced("ii")).toEqual([62, 65, 69]);
    expect(voiced("V7")).toEqual([67, 71, 74, 77]);
    expect(voiced("ii7")).toEqual([62, 65, 69, 72]);
    expect(voiced("Imaj7")).toEqual([60, 64, 67, 71]);
    expect(voiced("viidim")).toEqual([71, 74, 77]);
    expect(voiced("III", "minor")).toEqual([63, 67, 70]);
  });
});

describe("expand, conditionals", () => {
  const extra = "{param: speed = 1..3}\n";
  const notesAt = (pattern: string, speed?: string) =>
    noteNumbers(firstRepetition(body(pattern, extra), { params: speed === undefined ? {} : { speed } }));
  const pick = "{if speed=3} 1 2 {else} 5 {end}";

  it("plays the branch the parameter picks, and the else branch for any other value", () => {
    expect(notesAt(pick, "3")).toEqual([60, 62]);
    expect(notesAt(pick, "1")).toEqual([67]);
    expect(notesAt(pick, "2")).toEqual([67]);
  });

  it("plays nothing for a block with no else that does not match", () => {
    expect(notesAt("1 {if speed=3} 2 {end} 3", "1")).toEqual([60, 64]);
  });

  it("uses the parameter's default when the settings leave it out", () => {
    expect(notesAt(pick)).toEqual([67]);
  });

  it("lets a chord run across a branch boundary as if the pattern were flat", () => {
    const events = firstRepetition(body("{if speed=3} [I] 1 {else} 5 {end} 2", extra), { params: { speed: "3" } });
    expect(events.filter((e) => e.kind === "chord").map((e) => e.duration)).toEqual([2]);
  });
});
