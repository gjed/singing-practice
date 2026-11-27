# Golden fixtures

A golden fixture is a pair of files in `engine/test/fixtures/`:

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

## Plugging in the engine

`transform.ts` exports the one function every fixture runs through: `.vex` text in, a JSON-serialisable
value out. It currently returns the `parse` result, so a fixture holds the AST or the errors with their
line, column and message. When `expand` lands, point it at `parse` followed by `expand` for event-list
fixtures. The conformance tables of the spec are in `parse-conformance.test.ts`, not in fixtures.

## Regenerating expected output

```sh
UPDATE_GOLDEN=1 make test
```

With `UPDATE_GOLDEN=1` the suite writes every `.json` from the transform instead of comparing, which is
also how to create the `.json` for a new `.vex`. Review the resulting diff before committing it.
