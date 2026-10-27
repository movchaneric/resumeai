// Enforces the layer rules from CLAUDE.md by scanning import specifiers. No parser: a regex over import/export statements and dynamic import().
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(backendDir, "src");
const testDir = join(backendDir, "test");
const generatedDir = join(srcDir, "generated");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (path === generatedDir) return [];
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

// `import x from "m"`, `import type {..} from "m"`, `export * from "m"`, `export {..} from "m"`, `import "m"`, `import("m")`.
const FROM_SPECIFIER = /\b(?:import|export)\b[^;"'`]*?\bfrom\s*["']([^"']+)["']/g;
const BARE_IMPORT = /\bimport\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

export function importSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const found: string[] = [];
  for (const pattern of [FROM_SPECIFIER, BARE_IMPORT, DYNAMIC_IMPORT]) {
    for (const match of code.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

interface Import {
  file: string; // absolute
  specifier: string;
}

function importsIn(dir: string): Import[] {
  return tsFiles(dir).flatMap((file) => importSpecifiers(readFileSync(file, "utf8")).map((specifier) => ({ file, specifier })));
}

const srcImports = importsIn(srcDir);
const testImports = importsIn(testDir);

const fromBackend = (file: string): string => relative(backendDir, file).split(sep).join("/");
const isIn = (file: string, dir: string): boolean => file.startsWith(dir + sep);
const isRelative = (specifier: string): boolean => specifier.startsWith("./") || specifier.startsWith("../");
const isLangGraph = (specifier: string): boolean => specifier === "@langchain/langgraph" || specifier.startsWith("@langchain/langgraph/") || specifier.startsWith("@langchain/langgraph-");
const isOtherLangChain = (specifier: string): boolean => !isLangGraph(specifier) && (specifier === "langchain" || specifier.startsWith("langchain/") || specifier.startsWith("@langchain/"));

function expectNoViolations(violations: Import[], rule: string): void {
  const lines = violations.map((v) => `${fromBackend(v.file)}: ${v.specifier}`);
  expect(lines, `${rule}. Offending imports:\n${lines.join("\n")}`).toEqual([]);
}

describe("architecture rules", () => {
  it("scans a non-empty set of files", () => {
    expect(srcImports.length).toBeGreaterThan(50);
    expect(testImports.length).toBeGreaterThan(50);
  });

  it("only src/graph imports @langchain/langgraph*", () => {
    const violations = srcImports.filter((i) => isLangGraph(i.specifier) && !isIn(i.file, join(srcDir, "graph")));
    expectNoViolations(violations, "Only src/graph/** may import @langchain/langgraph*");
  });

  it("only src/llm and src/utils/tracing.ts import other @langchain/* packages or langchain", () => {
    const violations = srcImports.filter(
      (i) => isOtherLangChain(i.specifier) && !isIn(i.file, join(srcDir, "llm")) && i.file !== join(srcDir, "utils", "tracing.ts"),
    );
    expectNoViolations(violations, "Only src/llm/** and src/utils/tracing.ts may import @langchain/* (other than langgraph) or langchain");
  });

  it("uses the @/ alias, not relative paths, to reach src code", () => {
    // src: no relative import at all. test: relative imports between test files (helpers, fixtures) are fine, but not into src, which must use @/.
    const violations = [
      ...srcImports.filter((i) => isRelative(i.specifier)),
      ...testImports.filter((i) => isRelative(i.specifier) && isIn(resolve(dirname(i.file), i.specifier), srcDir)),
    ];
    expectNoViolations(violations, "Import src code with the @/ alias, never with relative paths");
  });

  it("src/prompts imports only @resume-ai/shared and @/prompts/*", () => {
    const violations = srcImports.filter(
      (i) =>
        isIn(i.file, join(srcDir, "prompts")) &&
        !(i.specifier === "@resume-ai/shared" || i.specifier.startsWith("@resume-ai/shared/") || i.specifier.startsWith("@/prompts/")),
    );
    expectNoViolations(violations, "src/prompts/** may import only @resume-ai/shared and @/prompts/*");
  });

  it("src/export imports only @resume-ai/shared, @/export/*, pdfkit, docx and node built-ins", () => {
    const allowed = (specifier: string): boolean =>
      specifier === "@resume-ai/shared" ||
      specifier.startsWith("@resume-ai/shared/") ||
      specifier.startsWith("@/export/") ||
      specifier === "pdfkit" ||
      specifier === "docx" ||
      specifier.startsWith("node:");
    const violations = srcImports.filter((i) => isIn(i.file, join(srcDir, "export")) && !allowed(i.specifier));
    expectNoViolations(violations, "src/export/** may import only @resume-ai/shared, @/export/*, pdfkit, docx and node: built-ins (no model, DB, Express or other layers)");
  });
});
