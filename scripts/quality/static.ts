import { join, relative } from "node:path";
import ts from "typescript";
import { findArchitectureViolations } from "./architecture";
import { findCodeLimitViolations } from "./code-limits";
import { checkDocumentation } from "./documentation";
import { productionTypeScriptFiles, projectRoot, repositoryFiles } from "./repository";

function createProgram(files: string[], root: string): ts.Program {
  const configuration = ts.getParsedCommandLineOfConfigFile(
    join(root, "tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (issue) => {
        throw new Error(ts.flattenDiagnosticMessageText(issue.messageText, "\n"));
      },
    },
  );
  if (!configuration || configuration.errors.length > 0) {
    throw new Error("Unable to load TypeScript configuration for static checks.");
  }
  const host = ts.createCompilerHost(configuration.options, true);
  return ts.createProgram(files, configuration.options, host);
}

export function runStatic(root = projectRoot): number {
  const paths = productionTypeScriptFiles(root).map((file) => join(root, file));
  if (paths.length === 0) throw new Error("Empty source inventory for static checks.");
  const program = createProgram(paths, root);
  const sources = paths.map((path) => {
    const source = program.getSourceFile(path);
    if (!source) throw new Error(`TypeScript could not load ${path}`);
    return source;
  });
  const issues = [
    ...sources.flatMap(findCodeLimitViolations),
    ...findArchitectureViolations(program, sources, root),
    ...checkDocumentation(root, repositoryFiles([], false, root)),
  ];
  for (const issue of issues) {
    console.error(`${relative(root, issue.file)}:${issue.line} [${issue.rule}] ${issue.message}`);
  }
  console.log(`Static checks: ${issues.length} violation(s).`);
  return issues.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.exitCode = runStatic();
  } else {
    console.error("Usage: bun run quality:static");
    process.exitCode = 1;
  }
}
