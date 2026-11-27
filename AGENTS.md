# AGENTS.md

Instructions for AI coding agents working in this repo.

## What this repo is

A vocal exercise library and practice site. Each `.vex` file is one exercise,
written in scale degrees so it runs in any key. A TypeScript engine turns
`.vex` text into events (`parse`, then `expand`), and the site plays them.
The full design is in `plan/vocal-exercises-site-plan.md`.

The repo is built up in milestones. Today `main` holds the plan, the design
artboards, the brand assets and a few sample exercises and collections; the
rest of the layout below is the target and lands issue by issue. Check what
exists on `main` before assuming a path or a command is there.

## Target layout

From the plan ("Repository layout and data model"). Directories other than
`exercises/`, `collections/`, `design/`, `brand/` and `plan/` do not exist yet.

```text
exercises/
  <category>/
    category.yaml            name, description, accent colour
    NN-exercise-slug.vex     two-digit prefix sets order, kebab-case slug
engine/                      TypeScript package, no DOM dependencies
  src/parse.ts               .vex -> Exercise AST, with line/column errors
  src/expand.ts              AST + settings -> event list
  src/strudel.ts             event list -> Strudel pattern
  src/contour.ts             AST -> card contour line
  test/                      fixtures: .vex in, events JSON out
collections/                 library collections, one YAML file each
api/                         Lambda handlers (TypeScript, reuse engine/)
infra/                       OpenTofu: Cognito, API Gateway, Lambda, DynamoDB, SES, Budgets
cli/vex.ts                   lint, build-data, new
site/                        Hugo site: layouts, i18n, data, assets
skills/
  vex-exercise-authoring/SKILL.md
  atomic-conventional-commits/SKILL.md
.github/workflows/           pr-check.yml, release.yml
.github/ISSUE_TEMPLATE/      01-exercise-fix.yml, 02-new-exercise.yml
Makefile  package.json  .releaserc.json  .renovaterc.json  AGENTS.md  CONTRIBUTING.md
```

The file path minus extension is the exercise id (`range/major-arpeggio`),
used in URLs. The prefix only orders exercises inside a category.

## License

The code is licensed under AGPL-3.0 (`LICENSE`). The gjed branding under
`brand/` is proprietary and not covered by the AGPL.

## Security

Raw Strudel is JavaScript and gets evaluated. It is **never** accepted from
share links or imported files: those carry only `.vex`, which the parser turns
into data. Do not add a code path that evaluates user-supplied Strudel. If raw
Strudel blocks are ever allowed, it is only in library files reviewed by PR.

## Commit and PR conventions

- **Atomic commits**: one logical change per commit. Independent changes (new
  exercise, engine fix, docs tweak) are separate commits. Stage files
  explicitly by path, never `git add -A` or `git add .`.
- **Conventional Commits**: `<type>(<scope>): <subject>`. The scope is optional
  for repo-wide changes. Scopes are the ones used in issue titles:
  `engine`, `cli`, `site`, `exercises`, `ci`, `infra`, `api`, `docs`.
- A PR closes zero or more issues. Put `Closes #N` in the PR body for each
  issue it closes, when there are any. Assign the PR to `gjed`.
- Open PRs against `main`.

Releases will be cut by **semantic-release** on push to `main`: `feat` is a
minor release, `fix`, `perf` and reverts a patch, `BREAKING CHANGE` a major,
everything else no release. These are the semantic-release defaults; once
`.releaserc.json` lands it is authoritative. Commit types will drive published
versions, so pick them accurately.

Examples:

- `feat(exercises): add siren`
- `fix(engine): drop roots that pass the top of the range`
- `docs: explain the .vex pattern syntax`

## Adding or fixing an exercise

See `CONTRIBUTING.md`. The `.vex` syntax is specified in `docs/vex-format.md`.
