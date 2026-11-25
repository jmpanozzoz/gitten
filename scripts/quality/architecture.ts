import { dirname, relative } from "node:path";
import ts from "typescript";
import { type ModuleReference, moduleReference } from "./module-references";
import { testSource } from "./repository";
import { diagnostic, type StaticDiagnostic } from "./static-diagnostic";

type Layer = "composition" | "domain" | "ports" | "application" | "adapter" | "tooling" | "other";

interface RuntimeEdge {
  target: string;
  node: ts.Node;
}

const effectGlobals = new Set([
  "Bun",
  "Deno",
  "process",
  "console",
  "fetch",
  "WebSocket",
  "XMLHttpRequest",
]);

export function findArchitectureViolations(
  program: ts.Program,
  sources: readonly ts.SourceFile[],
  root: string,
): StaticDiagnostic[] {
  const violations: StaticDiagnostic[] = [];
  const edges = new Map<string, RuntimeEdge[]>();
  const checker = program.getTypeChecker();
  const options = program.getCompilerOptions();
  const cache = ts.createModuleResolutionCache(
    root,
    ts.createCompilerHost(options).getCanonicalFileName,
    options,
  );
  const resolver = (name: string, source: string) =>
    ts.resolveModuleName(name, source, options, ts.sys, cache).resolvedModule;

  for (const source of sources) {
    const from = projectPath(root, source.fileName);
    const runtime: RuntimeEdge[] = [];
    const layer = layerOf(from);
    function visit(node: ts.Node): void {
      const reference = moduleReference(node);
      if (reference) {
        const target = reference.specifier && resolver(reference.specifier, source.fileName);
        const local =
          target && !target.isExternalLibraryImport
            ? projectPath(root, target.resolvedFileName)
            : undefined;
        const issue = checkReference(reference, from, local);
        if (issue) violations.push(issue);
        if (local && reference.runtime) runtime.push({ target: local, node });
      }
      if (isCore(layer) && isEffectGlobal(node, checker)) {
        violations.push(diagnostic(node, "effect-global", `${node.text} belongs in an adapter.`));
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    edges.set(from, runtime);
  }
  return [...violations, ...findRuntimeCycles(edges)];
}

function checkReference(
  reference: ModuleReference,
  from: string,
  target?: string,
): StaticDiagnostic | undefined {
  const layer = layerOf(from);
  if (!reference.specifier) {
    if (isCore(layer))
      return diagnostic(reference.node, "dynamic-import", "Use a statically resolvable module.");
    return;
  }
  if (!target) {
    if (isCore(layer)) {
      return diagnostic(
        reference.node,
        "layer-import",
        `Module ${reference.specifier} belongs behind a port.`,
      );
    }
    if (reference.specifier.startsWith(".")) {
      return diagnostic(
        reference.node,
        "unresolved-import",
        `Cannot resolve ${reference.specifier}.`,
      );
    }
    return;
  }
  if (!permits(from, target)) {
    return diagnostic(reference.node, "layer-import", `${layer} cannot depend on ${target}.`);
  }
}

function layerOf(file: string): Layer {
  if (file === "index.ts" || file === "src/app.ts" || file.startsWith("src/composition/"))
    return "composition";
  if (file.startsWith("src/core/ports/")) return "ports";
  if (file.startsWith("src/core/domain/")) return "domain";
  if (file.startsWith("src/core/")) return "application";
  if (file.startsWith("src/")) return "adapter";
  if (file.startsWith("scripts/")) return "tooling";
  return "other";
}

function permits(from: string, target: string): boolean {
  if (testSource(target)) return false;
  const destination = layerOf(target);
  switch (layerOf(from)) {
    case "composition":
      return destination !== "tooling";
    case "application":
      return isCore(destination);
    case "ports":
      return destination === "ports" || destination === "domain";
    case "domain":
      return destination === "domain";
    case "adapter":
      return adapterMayUse(from, target, destination);
    default:
      return true;
  }
}

function adapterMayUse(from: string, target: string, destination: Layer): boolean {
  if (destination === "ports" || destination === "domain") return true;
  return destination === "adapter" && adapterGroup(from) === adapterGroup(target);
}

function adapterGroup(path: string): string {
  return dirname(path).split("/")[1] ?? path;
}

function isCore(layer: Layer): boolean {
  return layer === "application" || layer === "ports" || layer === "domain";
}

function projectPath(root: string, file: string): string {
  return relative(root, file).replaceAll("\\", "/");
}

function isEffectGlobal(
  node: ts.Node,
  checker: ts.TypeChecker,
): node is ts.Identifier | ts.StringLiteralLike {
  if (ts.isIdentifier(node)) {
    return effectGlobals.has(node.text) && isGlobalName(node, checker);
  }
  if (!ts.isStringLiteralLike(node) || !effectGlobals.has(node.text)) return false;
  const parent = node.parent;
  if (!ts.isElementAccessExpression(parent) || parent.argumentExpression !== node) return false;
  const receiver = parent.expression;
  return (
    ts.isIdentifier(receiver) &&
    (receiver.text === "globalThis" || receiver.text === "global") &&
    isGlobalName(receiver, checker)
  );
}

function isGlobalName(name: ts.Identifier, checker: ts.TypeChecker): boolean {
  const declarations = checker.getSymbolAtLocation(name)?.declarations ?? [];
  return (
    declarations.length === 0 ||
    declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile)
  );
}

function findRuntimeCycles(edges: ReadonlyMap<string, readonly RuntimeEdge[]>): StaticDiagnostic[] {
  const active = new Set<string>();
  const settled = new Set<string>();
  const issues: StaticDiagnostic[] = [];

  function visit(file: string): void {
    if (settled.has(file)) return;
    active.add(file);
    for (const edge of edges.get(file) ?? []) {
      if (active.has(edge.target)) {
        const chain = [...active];
        const cycle = [...chain.slice(chain.indexOf(edge.target)), edge.target];
        issues.push(diagnostic(edge.node, "runtime-cycle", cycle.join(" → ")));
      } else {
        visit(edge.target);
      }
    }
    active.delete(file);
    settled.add(file);
  }

  for (const file of edges.keys()) visit(file);
  return issues;
}
