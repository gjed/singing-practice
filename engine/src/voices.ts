/**
 * The preset ranges behind the `voice` setting. `voice=tenor` fills `start` with `lowest` and `end` with
 * `highest`.
 *
 * Source: the voice ranges of the New Harvard Dictionary of Music, as published for music cataloguing by
 * Yale University Library (https://web.library.yale.edu/cataloging/music/vocal-ranges). It is the one
 * standard reference that gives all six types, and the same table is cited by other libraries and choral
 * guides. The values are the range ends as listed there, in scientific pitch notation (C4 is MIDI 60).
 *
 * | Voice    | Lowest | Highest |
 * | -------- | ------ | ------- |
 * | soprano  | C4     | A5      |
 * | mezzo    | A3     | F5      |
 * | alto     | F3     | D5      |
 * | tenor    | B2     | G4      |
 * | baritone | G2     | E4      |
 * | bass     | E2     | C4      |
 *
 * The source lists the whole range of a voice type, not the notes a singer warms up on. That is deliberate:
 * `end` is the top of the range, and `expand` drops every root whose highest sung note would pass it.
 */

export interface VoiceRange {
  /** MIDI note of the lowest root. */
  lowest: number;
  /** MIDI note of the highest note a run may reach. */
  highest: number;
}

export const VOICES = {
  soprano: { lowest: 60, highest: 81 },
  mezzo: { lowest: 57, highest: 77 },
  alto: { lowest: 53, highest: 74 },
  tenor: { lowest: 47, highest: 67 },
  baritone: { lowest: 43, highest: 64 },
  bass: { lowest: 40, highest: 60 },
} as const satisfies Record<string, VoiceRange>;

export type Voice = keyof typeof VOICES;

export const VOICE_NAMES = Object.keys(VOICES) as Voice[];
