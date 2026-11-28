import { describe, expect, it } from "vitest";
import { noteNameMidi } from "../src/directives.js";
import { BUILT_IN_SETTINGS, VOICE_NAMES, VOICES, defaultSettings } from "../src/index.js";
import { exerciseOf, withHeader } from "./parse-helpers.js";

const midi = (name: string) => noteNameMidi(name, 0, name.length);

describe("voice presets", () => {
  it("lists the six voices of the format, lowest first in pitch", () => {
    expect(VOICE_NAMES).toEqual(["soprano", "mezzo", "alto", "tenor", "baritone", "bass"]);
  });

  it.each([
    ["soprano", "C4", "A5"],
    ["mezzo", "A3", "F5"],
    ["alto", "F3", "D5"],
    ["tenor", "B2", "G4"],
    ["baritone", "G2", "E4"],
    ["bass", "E2", "C4"],
  ] as const)("%s runs from %s to %s", (voice, lowest, highest) => {
    expect(VOICES[voice]).toEqual({ lowest: midi(lowest), highest: midi(highest) });
  });

  it("orders both ends from the highest voice to the lowest, the way the source lists them", () => {
    const order = ["soprano", "mezzo", "alto", "tenor", "baritone", "bass"] as const;
    for (const [a, b] of order.slice(1).map((voice, i) => [order[i]!, voice] as const)) {
      expect(VOICES[a].lowest).toBeGreaterThan(VOICES[b].lowest);
      expect(VOICES[a].highest).toBeGreaterThan(VOICES[b].highest);
    }
  });
});

describe("defaultSettings", () => {
  const settingsOf = (defaults: string, extra = "") =>
    defaultSettings(exerciseOf(withHeader("1\n", `${defaults}\n${extra}`)));

  it("uses the built-in values of the spec when the file sets nothing", () => {
    expect(defaultSettings(exerciseOf(withHeader("1\n")))).toEqual({ ...BUILT_IN_SETTINGS, params: {} });
    expect(BUILT_IN_SETTINGS).toEqual({
      start: midi("C3"),
      end: midi("C4"),
      tempo: 100,
      step: 1,
      direction: "up",
      cue: true,
      countIn: 1,
    });
  });

  it("applies every setting of {defaults}", () => {
    expect(settingsOf("{defaults: start=A2 end=E4 tempo=120 step=+3 direction=down-up cue=off count-in=3bar}")).toEqual({
      start: midi("A2"),
      end: midi("E4"),
      tempo: 120,
      step: 3,
      direction: "down-up",
      cue: false,
      countIn: 3,
      params: {},
    });
  });

  it("reads count-in=off as zero bars", () => {
    expect(settingsOf("{defaults: count-in=off}").countIn).toBe(0);
  });

  it("fills start and end from the voice", () => {
    const settings = settingsOf("{defaults: voice=tenor}");
    expect([settings.start, settings.end]).toEqual([midi("B2"), midi("G4")]);
  });

  it("lets an explicit start or end in the same directive win over the voice, in either order", () => {
    expect(settingsOf("{defaults: voice=bass start=G2}")).toMatchObject({ start: midi("G2"), end: midi("C4") });
    expect(settingsOf("{defaults: end=A3 voice=bass}")).toMatchObject({ start: midi("E2"), end: midi("A3") });
    expect(settingsOf("{defaults: voice=alto end=A4 start=G3}")).toMatchObject({ start: midi("G3"), end: midi("A4") });
  });

  it("gives every parameter its first value, or the low end of its range", () => {
    const settings = settingsOf("", "{param: scale = minor | major}\n{param: speed = 2..4}\n");
    expect(settings.params).toEqual({ scale: "minor", speed: "2" });
  });

  it("lets {defaults} override a parameter", () => {
    const settings = settingsOf(
      "{defaults: scale=dorian speed=3}",
      "{param: scale = major | dorian}\n{param: speed = 1..3}\n",
    );
    expect(settings.params).toEqual({ scale: "dorian", speed: "3" });
  });
});
