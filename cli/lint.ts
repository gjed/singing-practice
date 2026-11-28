import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "@singing-practice/engine";
import type { DirectiveNode, Exercise } from "@singing-practice/engine";
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml";
import type { Document, Node } from "yaml";

export interface Finding {
  /** Path relative to the repository root, with forward slashes. */
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
}

export interface LintOptions {
  /** The repository root: where `exercises/`, `collections/` and `site/data/` live. */
  root: string;
  /** Files to lint, relative to `cwd`. Without them, every exercise and collection under `root`. */
  paths?: string[];
  /** What relative `paths` are resolved against. Defaults to the process working directory. */
  cwd?: string;
}

export const FACETS = ["focus", "technique", "level", "voice"] as const;
type Facet = (typeof FACETS)[number];

interface Vocabulary {
  languages: string[];
  facets: Record<Facet, Set<string>>;
}

type Add = (line: number, column: number, severity: Finding["severity"], message: string) => void;

const EXERCISE_FILE = /^\d{2}-([a-z0-9]+(?:-[a-z0-9]+)*)\.vex$/;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TRANSLATABLE = ["title", "description"] as const;

const toPosix = (p: string) => p.split(path.sep).join("/");
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** `range/01-major-arpeggio.vex` -> `range/major-arpeggio`; undefined when the path has another shape. */
export function exerciseId(relativeToExercises: string): string | undefined {
  const parts = relativeToExercises.split("/");
  if (parts.length !== 2) return undefined;
  const [category, file] = parts as [string, string];
  const slug = EXERCISE_FILE.exec(file)?.[1];
  if (!KEBAB.test(category) || slug === undefined) return undefined;
  return `${category}/${slug}`;
}

function yamlPosition(lc: LineCounter, node: Node | null | undefined): { line: number; column: number } {
  const offset = node?.range?.[0];
  if (offset === undefined) return { line: 1, column: 1 };
  const { line, col } = lc.linePos(offset);
  return { line, column: col };
}

function parseYaml(text: string, add: Add): { doc: Document.Parsed; lc: LineCounter } | undefined {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, prettyErrors: false });
  for (const error of doc.errors) {
    const { line, col } = lc.linePos(error.pos[0]);
    add(line, col, "error", error.message.split("\n")[0] ?? "invalid YAML");
  }
  return doc.errors.length > 0 ? undefined : { doc, lc };
}

function readOptional(root: string, relative: string): string | undefined {
  const file = path.join(root, relative);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/** Reads the shipped languages. Problems are reported against the file and leave the list incomplete. */
function loadLanguages(root: string, add: Add): string[] {
  const languages: string[] = [];
  const text = readOptional(root, "site/data/languages.yaml");
  if (text === undefined) {
    add(1, 1, "error", "file is missing: it lists the languages the site ships");
    return languages;
  }
  const parsed = parseYaml(text, add);
  if (!parsed) return languages;
  const { doc, lc } = parsed;
  if (!isSeq(doc.contents)) {
    add(1, 1, "error", "expected a list of language codes");
    return languages;
  }
  for (const item of doc.contents.items as Node[]) {
    const { line, column } = yamlPosition(lc, item);
    const code = isScalar(item) ? item.value : undefined;
    if (typeof code !== "string" || !/^[a-z]{2,3}$/.test(code)) {
      add(line, column, "error", "expected a language code of two or three lowercase letters");
    } else if (languages.includes(code)) {
      add(line, column, "error", `language "${code}" is listed twice`);
    } else {
      languages.push(code);
    }
  }
  if (!languages.includes("en")) add(1, 1, "error", 'the list must include "en", the plain directive text');
  return languages;
}

function loadFacets(root: string, languages: string[], add: Add): Record<Facet, Set<string>> {
  const facets: Record<Facet, Set<string>> = { focus: new Set(), technique: new Set(), level: new Set(), voice: new Set() };
  const text = readOptional(root, "site/data/facets.yaml");
  if (text === undefined) {
    add(1, 1, "error", "file is missing: it holds the facet vocabulary");
    return facets;
  }
  const parsed = parseYaml(text, add);
  if (!parsed) return facets;
  const { doc, lc } = parsed;
  if (!isMap(doc.contents)) {
    add(1, 1, "error", "expected a map with one entry per facet");
    return facets;
  }
  const top = doc.contents;
  for (const facet of FACETS) {
    const node = top.get(facet, true) as Node | undefined;
    if (!isMap(node)) {
      const { line, column } = yamlPosition(lc, node ?? top);
      add(line, column, "error", `missing facet "${facet}": expected a map of values to labels`);
      continue;
    }
    for (const pair of node.items) {
      const { line, column } = yamlPosition(lc, pair.key as Node);
      const value = isScalar(pair.key) ? pair.key.value : undefined;
      if (typeof value !== "string") {
        add(line, column, "error", `a ${facet} value must be text`);
        continue;
      }
      facets[facet].add(value);
      const labels = pair.value as Node | null;
      if (!isMap(labels)) {
        add(line, column, "error", `"${value}" needs a label for each language (${languages.join(", ")})`);
        continue;
      }
      for (const language of languages) {
        if (!isNonEmptyString(labels.get(language))) add(line, column, "error", `"${value}" has no ${language} label`);
      }
      for (const label of labels.items) {
        const code = isScalar(label.key) ? label.key.value : undefined;
        if (typeof code !== "string" || !languages.includes(code)) {
          const at = yamlPosition(lc, label.key as Node);
          add(at.line, at.column, "error", `"${String(code)}" is not a shipped language`);
        }
      }
    }
  }
  return facets;
}

function loadVocabulary(root: string, findings: Finding[]): Vocabulary | undefined {
  const before = findings.length;
  const addTo =
    (file: string): Add =>
    (line, column, severity, message) =>
      findings.push({ file, line, column, severity, message });
  const languages = loadLanguages(root, addTo("site/data/languages.yaml"));
  const facets = loadFacets(root, languages, addTo("site/data/facets.yaml"));
  return findings.length > before ? undefined : { languages, facets };
}

function listFiles(dir: string, match: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map(toPosix)
    .filter((name) => match(path.posix.basename(name)))
    .sort();
}

function checkFacetValue(facet: Facet, value: string, vocabulary: Vocabulary): string | undefined {
  if (vocabulary.facets[facet].has(value)) return undefined;
  return `unknown ${facet} value "${value}" (known: ${[...vocabulary.facets[facet]].join(", ")})`;
}

/** Columns (1-based) of each value in a facet directive's text, found left to right after the `:`. */
function facetColumns(lineText: string, directive: DirectiveNode, values: string[]): number[] {
  let cursor = lineText.indexOf(":", directive.span.column - 1) + 1;
  return values.map((value) => {
    const found = lineText.indexOf(value, cursor);
    if (found < 0) return directive.span.column;
    cursor = found + value.length;
    return found + 1;
  });
}

interface Library {
  category: string;
}

function lintExerciseSemantics(exercise: Exercise, text: string, vocabulary: Vocabulary, library: Library | undefined, add: Add): void {
  const lines = text.split(/\r?\n/);
  const lineOf = (directive: DirectiveNode) => lines[directive.span.line - 1] ?? "";
  const find = (name: string) => exercise.directives.find((d) => d.name === name && d.lang === undefined);

  for (const facet of FACETS) {
    const directive = find(facet);
    const raw = exercise.facets[facet];
    const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    if (!directive || values.length === 0) continue;
    const columns = facetColumns(lineOf(directive), directive, values);
    values.forEach((value, index) => {
      const problem = checkFacetValue(facet, value, vocabulary);
      if (problem) add(directive.span.line, columns[index] ?? directive.span.column, "error", problem);
    });
  }

  for (const directive of exercise.directives) {
    if (directive.lang === undefined || vocabulary.languages.includes(directive.lang)) continue;
    const dot = lineOf(directive).indexOf(".", directive.span.column - 1);
    add(
      directive.span.line,
      dot < 0 ? directive.span.column : dot + 1,
      "error",
      `language "${directive.lang}" is not shipped by the site (${vocabulary.languages.join(", ")})`,
    );
  }

  for (const name of TRANSLATABLE) {
    const directive = find(name);
    if (!directive || (name === "description" && exercise.description === undefined)) continue;
    for (const language of vocabulary.languages) {
      if (language === "en" || exercise.translations[name][language] !== undefined) continue;
      add(directive.span.line, directive.span.column, "warning", `missing ${name}.${language} translation, the site falls back to English`);
    }
  }

  if (!library) return;
  const focus = find("focus");
  const first = exercise.facets.focus[0];
  if (!focus || first === undefined) {
    add(1, 1, "error", "missing {focus}: every library exercise needs at least one focus value");
  } else if (first !== library.category) {
    const [column] = facetColumns(lineOf(focus), focus, [first]);
    add(
      focus.span.line,
      column ?? focus.span.column,
      "error",
      `the first focus value "${first}" decides the folder, but the file is in "${library.category}/"`,
    );
  }
}

function lintExerciseFile(file: string, text: string, vocabulary: Vocabulary, ids: Map<string, string[]>, add: Add): void {
  const result = parse(text);
  for (const error of result.errors) add(error.line, error.column, "error", error.message);

  let library: Library | undefined;
  if (file.startsWith("exercises/")) {
    const id = exerciseId(file.slice("exercises/".length));
    if (id === undefined) {
      add(1, 1, "error", "a library exercise lives at exercises/<category>/NN-slug.vex, with a kebab-case category and slug");
    } else {
      library = { category: id.split("/")[0] as string };
      const others = (ids.get(id) ?? []).filter((owner) => owner !== file);
      if (others.length > 0) add(1, 1, "error", `exercise id "${id}" is also used by ${others.join(", ")}`);
    }
  }
  if (result.ok) lintExerciseSemantics(result.exercise, text, vocabulary, library, add);
}

function lintCollectionFile(text: string, vocabulary: Vocabulary, ids: Set<string>, add: Add): void {
  const parsed = parseYaml(text, add);
  if (!parsed) return;
  const { doc, lc } = parsed;
  const report = (node: Node | null | undefined, severity: Finding["severity"], message: string) => {
    const { line, column } = yamlPosition(lc, node);
    add(line, column, severity, message);
  };
  const isText = (node: Node | null | undefined): node is Node => isScalar(node) && isNonEmptyString(node.value);

  if (!isMap(doc.contents)) {
    add(1, 1, "error", "a collection is a map with a title and a list of items");
    return;
  }
  const keys = new Map<string, { key: Node; value: Node | null }>();
  for (const pair of doc.contents.items) {
    const key = isScalar(pair.key) ? pair.key.value : undefined;
    const keyNode = pair.key as Node;
    if (typeof key !== "string") {
      report(keyNode, "error", "keys must be text");
      continue;
    }
    keys.set(key, { key: keyNode, value: pair.value as Node | null });
    const translation = /^([a-z]+)\.(.*)$/.exec(key);
    if (!translation) continue;
    const [, base, language] = translation as unknown as [string, string, string];
    if (!(TRANSLATABLE as readonly string[]).includes(base)) {
      report(keyNode, "error", `only title and description can be translated, not "${base}"`);
    } else if (language === "en") {
      report(keyNode, "error", `"${key}" is not allowed: the plain ${base} is the English text`);
    } else if (!vocabulary.languages.includes(language)) {
      report(keyNode, "error", `language "${language}" is not shipped by the site (${vocabulary.languages.join(", ")})`);
    } else if (!isText(pair.value as Node | null)) {
      report((pair.value as Node | null) ?? keyNode, "error", `${key} must be non-empty text`);
    }
  }

  const title = keys.get("title");
  const description = keys.get("description");
  if (!title) add(1, 1, "error", "missing title");
  for (const [name, entry] of [["title", title], ["description", description]] as const) {
    if (!entry) continue;
    if (!isText(entry.value)) report(entry.value ?? entry.key, "error", `${name} must be non-empty text`);
    for (const language of vocabulary.languages) {
      if (language !== "en" && !keys.has(`${name}.${language}`)) {
        report(entry.key, "warning", `missing ${name}.${language} translation, the site falls back to English`);
      }
    }
  }

  for (const facet of FACETS) {
    const entry = keys.get(facet);
    if (!entry) continue;
    const nodes = isSeq(entry.value) ? (entry.value.items as Node[]) : [entry.value];
    for (const node of nodes) {
      if (!isScalar(node) || typeof node.value !== "string") {
        report(node ?? entry.key, "error", `${facet} must be text or a list of text`);
        continue;
      }
      const values = isSeq(entry.value) ? [node.value] : node.value.split(",").map((v) => v.trim());
      for (const value of values) {
        const problem = checkFacetValue(facet, value, vocabulary);
        if (problem) report(node, "error", problem);
      }
    }
  }

  const items = keys.get("items");
  if (!items) {
    add(1, 1, "error", "missing items");
    return;
  }
  if (!isSeq(items.value) || items.value.items.length === 0) {
    report(items.value ?? items.key, "error", "items must be a non-empty list");
    return;
  }
  for (const item of items.value.items as Node[]) {
    let idNode: Node | null | undefined;
    if (isScalar(item)) {
      idNode = item;
    } else if (isMap(item)) {
      const hasPause = item.has("pause");
      const hasId = item.has("id");
      if (hasPause === hasId) {
        report(item, "error", hasId ? "an item is either an id or a pause, not both" : "an item needs an id or a pause");
        continue;
      }
      if (hasPause) continue;
      idNode = item.get("id", true) as Node | undefined;
    } else {
      report(item, "error", "an item is an exercise id, an {id: …} map or a {pause: …} map");
      continue;
    }
    const id = isScalar(idNode) ? idNode.value : undefined;
    if (typeof id !== "string") report(idNode ?? item, "error", "an exercise id must be text");
    else if (!ids.has(id)) report(idNode, "error", `unknown exercise id "${id}": no file under exercises/ has it`);
  }
}

interface Target {
  file: string;
  kind: "exercise" | "collection";
}

function discover(root: string): Target[] {
  const exercises = listFiles(path.join(root, "exercises"), (n) => n.endsWith(".vex"));
  const collections = listFiles(path.join(root, "collections"), (n) => /\.ya?ml$/.test(n));
  return [
    ...exercises.map((f): Target => ({ file: `exercises/${f}`, kind: "exercise" })),
    ...collections.map((f): Target => ({ file: `collections/${f}`, kind: "collection" })),
  ];
}

/** Resolves the files to lint. A path that is neither a `.vex` file nor a collection file is skipped. */
function select(options: LintOptions, findings: Finding[]): Target[] {
  const { root, paths } = options;
  if (paths === undefined || paths.length === 0) return discover(root);
  const cwd = options.cwd ?? process.cwd();
  const targets: Target[] = [];
  for (const given of paths) {
    const absolute = path.resolve(cwd, given);
    const file = toPosix(path.relative(root, absolute));
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      findings.push({ file: toPosix(given), line: 1, column: 1, severity: "error", message: "not a file" });
    } else if (file.endsWith(".vex")) {
      targets.push({ file, kind: "exercise" });
    } else if (/^collections\/[^/]+\.ya?ml$/.test(file)) {
      targets.push({ file, kind: "collection" });
    }
  }
  return targets;
}

export function lint(options: LintOptions): Finding[] {
  const { root } = options;
  const findings: Finding[] = [];
  const targets = select(options, findings);

  const vocabulary = loadVocabulary(root, findings);
  if (!vocabulary) return findings;

  const ids = new Map<string, string[]>();
  for (const f of listFiles(path.join(root, "exercises"), (n) => n.endsWith(".vex"))) {
    const id = exerciseId(f);
    if (id !== undefined) ids.set(id, [...(ids.get(id) ?? []), `exercises/${f}`]);
  }
  const idSet = new Set(ids.keys());

  for (const { file, kind } of targets) {
    const own: Finding[] = [];
    const add: Add = (line, column, severity, message) => own.push({ file, line, column, severity, message });
    const text = readFileSync(path.join(root, file), "utf8");
    if (kind === "exercise") lintExerciseFile(file, text, vocabulary, ids, add);
    else lintCollectionFile(text, vocabulary, idSet, add);
    findings.push(...own.sort((a, b) => a.line - b.line || a.column - b.column));
  }
  return findings;
}

export const format = (f: Finding) => `${f.file}:${f.line}:${f.column}: ${f.severity}: ${f.message}`;
