import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, lint } from "./lint.js";

const USAGE = `usage: vex lint [path...]

Lints exercises/**/*.vex and collections/*.yaml, or only the files given.
Prints one finding per line as file:line:column: error|warning: message.
Exits 1 when there is any error, 0 otherwise (warnings do not fail).
`;

export interface Io {
  root: string;
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Runs the CLI and returns its exit code. */
export function run(argv: string[], io: Io): number {
  const [command, ...paths] = argv;
  if (command !== "lint" || paths.some((p) => p.startsWith("-"))) {
    io.stderr(USAGE);
    return 2;
  }
  const findings = lint({ root: io.root, cwd: io.cwd, paths });
  for (const finding of findings) io.stdout(`${format(finding)}\n`);
  const errors = findings.filter((f) => f.severity === "error").length;
  io.stderr(`${errors} error${errors === 1 ? "" : "s"}, ${findings.length - errors} warning${findings.length - errors === 1 ? "" : "s"}\n`);
  return errors > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2), {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
