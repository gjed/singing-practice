# Contributing

How to add or fix a vocal exercise, and how PRs are handled in this repo.

The engine, CLI and site are still being built, so `make lint` is the only
command to run before you open a PR. Other commands are documented by the
changes that introduce them.

## Checking your changes

`make lint` checks every exercise and collection. It needs Node 24 or later and
installs the npm dependencies the first time.

```sh
make lint FILES="exercises/range/01-major-arpeggio.vex collections/daily-warm-up.yaml"
make lint
```

The first form checks only the files you name. The full run currently fails on
two ids in `collections/daily-warm-up.yaml` that have no exercise yet
(`warm-up/lip-trill` and `breath/long-tone`); ignore those until the exercises
land. Each problem is one line, `file:line:column: error: message` or
`file:line:column: warning: message`. The command fails when there is any error. Warnings, such as a missing Italian
title, do not fail it, but fix them where you can. The facet values it accepts
are listed in `site/data/facets.yaml` and the languages in
`site/data/languages.yaml`.

## Where exercises live

Each exercise is one `.vex` file in a category folder:

```text
exercises/
  <category>/
    NN-exercise-slug.vex
```

- `<category>` is a kebab-case folder, such as `warm-up`, `range` or `agility`.
- The two-digit prefix (`01-`, `02-`, …) sets the order inside the category.
- The slug is kebab-case.
- The file path minus the extension is the exercise id, for example
  `range/major-arpeggio` for `exercises/range/01-major-arpeggio.vex`. The id is
  used in URLs, so renaming a file changes its link.

The `.vex` syntax (directives, scale-degree patterns, settings and parameters)
is specified in [docs/vex-format.md](docs/vex-format.md). Look at the existing
files under `exercises/` for working examples.

## Adding an exercise

1. Create `exercises/<category>/NN-exercise-slug.vex`.
1. Write the metadata directives (`title`, `focus`, `level`, `technique`, and
   so on) and the pattern, following [docs/vex-format.md](docs/vex-format.md).
1. Commit: `feat(exercises): add <exercise title>`.
1. Open a PR (see below).

## Fixing an exercise

1. Edit the `.vex` file.
1. Commit: `fix(exercises): <what was wrong>`.
1. Open a PR.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<scope>): <subject>`, with a scope from `engine`, `cli`, `site`,
  `exercises`, `ci`, `infra`, `api` or `docs`.
- Keep commits atomic: one logical change each.
- A PR closes zero or more issues. Put `Closes #N` in the PR body for each
  issue it closes, when there are any.
- Open PRs against `main`.

Releases will be cut by semantic-release on `main`: `feat` is a minor release,
`fix`, `perf` and reverts a patch, `BREAKING CHANGE` a major, everything else
none. These are the semantic-release defaults; once `.releaserc.json` lands it
is authoritative. Choose the commit type with that in mind.

## Security

Raw Strudel code is never accepted from share links or imported files, only
`.vex`. Do not propose changes that evaluate user-supplied Strudel.

## License

The code is licensed under [AGPL-3.0](LICENSE). By contributing code, you
agree that your contribution is licensed under it.

The gjed branding under `brand/` is proprietary and is not covered by the
AGPL, and contributing to this repo does not change that.
