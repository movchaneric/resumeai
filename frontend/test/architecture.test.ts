// Enforces the frontend rules from CLAUDE.md by scanning source text. No parser: regexes over import statements and code.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const frontendDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(frontendDir, "src");
const testDir = join(frontendDir, "test");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : [];
  });
}

const FROM_SPECIFIER = /\b(?:import|export)\b[^;"'`]*?\bfrom\s*["']([^"']+)["']/g;
const BARE_IMPORT = /\bimport\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

export function importSpecifiers(source: string): string[] {
  const code = stripComments(source);
  return [FROM_SPECIFIER, BARE_IMPORT, DYNAMIC_IMPORT].flatMap((pattern) => [...code.matchAll(pattern)].map((m) => m[1]!));
}

const fromFrontend = (file: string): string => relative(frontendDir, file).split(sep).join("/");
const isIn = (file: string, dir: string): boolean => file.startsWith(join(srcDir, dir) + sep);
const isRelative = (specifier: string): boolean => specifier.startsWith("./") || specifier.startsWith("../");

const srcFiles = sourceFiles(srcDir);
const codeFiles = srcFiles.filter((f) => /\.tsx?$/.test(f));
const testFiles = sourceFiles(testDir).filter((f) => /\.tsx?$/.test(f));

function expectNone(lines: string[], rule: string): void {
  expect(lines, `${rule}. Offenders:\n${lines.join("\n")}`).toEqual([]);
}

describe("frontend architecture rules", () => {
  it("scans a non-empty set of files", () => {
    expect(codeFiles.length).toBeGreaterThan(5);
  });

  it("only api/ uses fetch or EventSource", () => {
    const offenders = codeFiles
      .filter((f) => !isIn(f, "api"))
      .filter((f) => /\b(?:fetch\s*\(|EventSource\b|XMLHttpRequest\b)/.test(stripComments(readFileSync(f, "utf8"))))
      .map(fromFrontend);
    expectNone(offenders, "Network access (fetch, EventSource) belongs in src/api/ only");
  });

  it("ui/ imports no features, routes or api", () => {
    const offenders = codeFiles
      .filter((f) => isIn(f, "ui"))
      .flatMap((f) => importSpecifiers(readFileSync(f, "utf8")).filter((s) => /^@\/(features|routes|api)(\/|$)/.test(s)).map((s) => `${fromFrontend(f)}: ${s}`));
    expectNone(offenders, "src/ui/ must not import features/, routes/ or api/");
  });

  it("no raw hex colors in src/ outside styles/", () => {
    const hex = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
    const offenders = srcFiles
      .filter((f) => !isIn(f, "styles"))
      .filter((f) => hex.test(stripComments(readFileSync(f, "utf8"))))
      .map(fromFrontend);
    expectNone(offenders, "Use the color tokens from styles/tokens.css, never raw hex");
  });

  it("src and test import frontend code with the @/ alias, never relative paths", () => {
    const offenders = [...codeFiles, ...testFiles].flatMap((f) =>
      importSpecifiers(readFileSync(f, "utf8"))
        .filter((s) => isRelative(s) && !(f.startsWith(testDir + sep) && !s.includes("src")))
        .map((s) => `${fromFrontend(f)}: ${s}`),
    );
    expectNone(offenders, "Import src code with @/, not a relative path (test helpers next to the tests may use relative paths)");
  });

  it("every ui/ primitive has a test", () => {
    const names = readdirSync(join(srcDir, "ui")).filter((n) => /^[A-Z].*\.tsx$/.test(n)).map((n) => n.replace(".tsx", ""));
    const tests = new Set(readdirSync(join(testDir, "ui")).map((n) => n.replace(".test.tsx", "")));
    expectNone(names.filter((n) => !tests.has(n)), "Each ui/ primitive needs test/ui/<Name>.test.tsx");
  });
});
