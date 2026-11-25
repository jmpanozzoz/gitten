import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";
import { findArchitectureViolations } from "../../scripts/quality/architecture";
import { findCodeLimitViolations } from "../../scripts/quality/code-limits";
import { localGit } from "../../scripts/quality/push-snapshot";
import { runStatic } from "../../scripts/quality/static";

function limits(source: string): string[] {
  const file = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
  return findCodeLimitViolations(file).map(({ rule }) => rule);
}

test("enforces exact class and function size limits, ignoring comments and blank lines", () => {
  const statements = "  use();\n\n  // comment\n";
  expect(limits(`function run() {\n${statements.repeat(48)}}`)).toEqual([]);
  expect(limits(`function run() {\n${statements.repeat(49)}}`)).toEqual(["function-lines"]);
  const fields = (count: number) =>
    Array.from({ length: count }, (_, i) => `p${i} = 0;\n`).join("");
  expect(limits(`class Record {\n${fields(198)}}`)).toEqual([]);
  expect(limits(`class Record {\n${fields(199)}}`)).toEqual(["class-lines"]);
});

test("counts decisions, nesting and parameters separately for nested callbacks", () => {
  expect(
    limits(`const f = (a, b, c, d) => {
    if (a) { while (b) { if (c) use(d); } }
    return () => { if (b) use(c); };
  };`),
  ).toEqual([]);
  expect(
    limits(`function f(a,b,c,d,e) {
    if (a) { while (b) { if (c) { for (const i of e) use(i); } } }
    return a && b && c && d && e && b && c;
  }`),
  ).toEqual(["parameters", "complexity", "depth"]);
});

function architecture(files: Record<string, string>): string[] {
  const root = mkdtempSync(join(tmpdir(), "gitten-architecture-test-"));
  try {
    const paths = Object.entries(files).map(([name, contents]) => {
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
      return path;
    });
    const program = ts.createProgram(paths, {
      noLib: true,
      types: [],
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      baseUrl: root,
      paths: { "@ui/*": ["src/ui/*"] },
    });
    const sources = program.getSourceFiles();
    return findArchitectureViolations(program, sources, root).map(({ rule }) => rule);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the static gate distinguishes missing, malformed, and unreadable source inventories", () => {
  const root = mkdtempSync(join(tmpdir(), "gitten-static-inventory-"));
  try {
    expect(() => runStatic(root)).toThrow("not a git repository");
    localGit(root, ["init", "--quiet"]);
    expect(() => runStatic(root)).toThrow("Empty source inventory");
    const source = join(root, "index.ts");
    writeFileSync(source, "export const fixture = 1;");
    expect(() => runStatic(root)).toThrow("Cannot read file");
    const configuration = join(root, "tsconfig.json");
    writeFileSync(configuration, '{ "compilerOptions": { "unrecognisedOption": true } }');
    expect(() => runStatic(root)).toThrow("Unable to load TypeScript configuration");
    writeFileSync(configuration, '{"files":["index.ts"],"compilerOptions":{"types":[]}}');
    localGit(root, ["add", "index.ts"]);
    rmSync(source);
    mkdirSync(source);
    expect(() => runStatic(root)).toThrow("TypeScript could not load");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the real static gate returns a failing status for a cross-layer dependency", () => {
  const root = mkdtempSync(join(tmpdir(), "gitten-static-result-"));
  try {
    localGit(root, ["init", "--quiet"]);
    const docs = [
      "AGENTS.md",
      "ARCHITECTURE.md",
      "CHANGELOG.md",
      "CLAUDE.md",
      "README.md",
      "LICENSE",
    ];
    for (const file of docs) writeFileSync(join(root, file), "[Guide](CLAUDE.md)\n");
    writeFileSync(join(root, "tsconfig.json"), '{"compilerOptions":{"types":[]}}');
    mkdirSync(join(root, "src/core"), { recursive: true });
    mkdirSync(join(root, "src/ui"));
    writeFileSync(join(root, "src/ui/display.ts"), "export const display = 1;");
    writeFileSync(join(root, "src/core/work.ts"), 'export { display } from "../ui/display";');
    expect(runStatic(root)).toBe(1);
    writeFileSync(join(root, "src/core/work.ts"), "export const work = 1;");
    expect(runStatic(root)).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects adapter aliases and reexports from application, even for types", () => {
  expect(
    architecture({
      "src/core/flow.ts": `import type { Widget } from "@ui/index";
      export { widget } from "@ui/index";`,
      "src/ui/index.ts": "export type Widget = string; export const widget: Widget = 'example';",
    }),
  ).toEqual(["layer-import", "layer-import"]);
});

test("reports effect globals and unresolved dynamic modules in application", () => {
  expect(
    architecture({
      "src/core/flow.ts":
        "export async function f(path: string) { await import(path); await fetch(path); }",
    }),
  ).toEqual(["dynamic-import", "effect-global"]);
});

test("checks native effect lookups on global objects and permits scoped equivalents", () => {
  expect(
    architecture({
      "src/core/flow.ts": `
        export function inspect() { return globalThis["process"]; }
        export function log() { return global["console"]; }
        export function local(globalThis: { fetch: string }, fetch: string) {
          return { fetch, property: globalThis["fetch"], text: "console" };
        }
      `,
    }),
  ).toEqual(["effect-global", "effect-global"]);
});

test("detects runtime cycles, while permitting type imports through ports", () => {
  expect(
    architecture({
      "src/core/a.ts": `import { b } from "./b"; export const a = () => b;`,
      "src/core/b.ts": `export { a } from "./a"; export const b = 1;`,
    }),
  ).toEqual(["runtime-cycle"]);
  expect(
    architecture({
      "src/core/a.ts": `import { type B } from "./b"; import type { Contract } from "./ports/contract";
      export interface A extends Contract { b: B };`,
      "src/core/b.ts": `import type { A } from "./a"; export type B = A | string;`,
      "src/core/ports/contract.ts": "export interface Contract {}",
    }),
  ).toEqual([]);
});

test("production cannot depend on test modules alongside implementations or under tests", () => {
  expect(
    architecture({
      "index.ts":
        'import type { Scenario } from "./src/git/adapter.spec"; export type Entry = Scenario;',
      "scripts/quality/inventory.ts": 'export { samples } from "../../tests/samples";',
      "src/git/adapter.ts": 'export { fixture } from "./adapter.spec";',
      "src/git/adapter.spec.ts": "export type Scenario = string; export const fixture = 1;",
      "tests/samples.ts": "export const samples = ['sample'];",
    }),
  ).toEqual(["layer-import", "layer-import", "layer-import"]);
});

test("adapter groups and domain dependency directions enforce their own boundaries", () => {
  expect(
    architecture({
      "index.ts": 'export { inventory } from "./scripts/quality/inventory";',
      "scripts/quality/inventory.ts": 'export { utility as inventory } from "../../utility";',
      "utility.ts": "export const utility = 1;",
      "src/core/flow.ts": "export const flow = 1;",
      "src/core/domain/rule.ts": 'export { port as rule } from "../ports/contract";',
      "src/core/ports/contract.ts": 'export { flow as port } from "../flow";',
      "src/git/adapter.ts": `export { shared } from "./shared";
        export { renderer } from "../ui/render";
        export { missing } from "./missing";
        export const load = (moduleName: string) => import(moduleName);`,
      "src/git/shared.ts": "export const shared = 1;",
      "src/ui/render.ts": "export const renderer = 1;",
    }),
  ).toEqual(["layer-import", "layer-import", "layer-import", "layer-import", "unresolved-import"]);
});

test("treats else-if as one nesting level and counts each optional-chain decision once", () => {
  const chain = "if (a) use(a); else if (b) use(b); else if (c) use(c); else if (d) use(d);";
  expect(limits(`function f(a,b,c,d) { ${chain} return a?.one.two?.three!.four; }`)).toEqual([]);
  expect(
    limits(`function f(a,b,c,d) { ${chain} return a?.one?.two?.three?.four?.five?.six; }`),
  ).toEqual(["complexity"]);
});

test("follows type query imports and legacy import assignments across layers", () => {
  expect(
    architecture({
      "src/core/flow.ts":
        'type Widget = typeof import("../ui/widget").widget; import adapter = require("../ui/widget");',
      "src/ui/widget.ts": "export const widget = 1;",
    }),
  ).toEqual(["layer-import", "layer-import"]);
});

test("rejects direct external effects and imports between independent root adapters", () => {
  expect(
    architecture({
      "src/core/flow.ts": 'import { readFile } from "node:fs"; export const flow = readFile;',
      "src/adapter.ts": 'export { detail } from "./detail";',
      "src/detail.ts": "export const detail = 1;",
    }),
  ).toEqual(["layer-import", "layer-import"]);
});
