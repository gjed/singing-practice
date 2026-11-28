# Golden fixtures

There are two golden sets, with the same layout and the same rules. `fixtures/` holds the parse fixtures
(`.vex` in, AST or errors out). `expand-fixtures/` holds the expand fixtures (`.vex` and settings in, event
list out); see [Expand fixtures](#expand-fixtures). Each runs in its own test file: `golden.test.ts` and
`expand-golden.test.ts`.

A parse fixture is a pair of files in `engine/test/fixtures/`:

```text
fixtures/
  major-arpeggio.vex      ← input: a .vex exercise
  major-arpeggio.json     ← expected: what the transform returns for it
  range/
    octave-jump.vex
    octave-jump.json
```

- The pair shares a name: `<name>.vex` and `<name>.json`, side by side. Folders are free; the fixture
  name is the path minus extension (`range/octave-jump`), and it is the test name in the Vitest output.
- The suite runs each `.vex` through the transform in `transform.ts` and compares the result with the
  `.json` as parsed data, so whitespace and key order in the file do not matter. A mismatch fails the
  test named after the fixture and prints a diff.
- A `.json` with no `.vex` beside it fails the suite. A `.vex` with no `.json` fails that fixture.
- With no fixtures the suite passes.

## The transforms

`transform.ts` exports the function each set runs through: `.vex` text in, a JSON-serialisable value out.
`transform` returns the `parse` result, so a parse fixture holds the AST or the errors with their line,
column and message. `expandTransform` is described below. The conformance tables of the spec are in
`parse-conformance.test.ts`, not in fixtures.

## Expand fixtures

An expand fixture is a `.vex`, an optional settings file and the expected output, side by side in
`engine/test/expand-fixtures/`:

```text
expand-fixtures/
  range/
    major-arpeggio.vex             ← input: the exercise
    major-arpeggio.settings.json   ← input, optional: settings to run it with
    major-arpeggio.json            ← expected: { "settings": …, "events": … }
```

- `expandTransform` parses the `.vex` and starts from `defaultSettings` of the exercise: the built-in
  values, then its `{defaults}`, `voice` included. A fixture with no settings file runs on exactly that.
- `<name>.settings.json` overrides fields of that result, standing in for the layers above `{defaults}`
  (saved range, URL, panel), which are not part of the engine yet. It holds some of the `Settings` fields:
  `start`, `end`, `tempo`, `step`, `direction`, `cue`, `countIn` (bars, 0 is off) and `params`, which is
  merged into the parameter values. `start` and `end` take a note name (`"C3"`) or a MIDI number.
  An unknown field fails the fixture.
- The expected `.json` holds the settings that were used and the events, so a reviewer sees both.
- A `.settings.json` is never taken for an expected output, and one with no `.vex` beside it is ignored.
- Set `countIn` to 0 and `cue` to false in a fixture that is not about them, to keep its output short.
- `time` and `duration` are in beats, `midi` is a MIDI note number (a list for a chord or a glide) and
  `repetition` is 0-based.

## Regenerating expected output

```sh
UPDATE_GOLDEN=1 make test
```

With `UPDATE_GOLDEN=1` the suite writes every `.json` from the transform instead of comparing, which is
also how to create the `.json` for a new `.vex`. Review the resulting diff before committing it.
