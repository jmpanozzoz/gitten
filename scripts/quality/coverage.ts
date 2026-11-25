import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { CoverageMapData } from "istanbul-lib-coverage";
import { coverageResults } from "./coverage-results";
import { instrumentSources } from "./instrumentation";
import { productionTypeScriptFiles, projectRoot } from "./repository";
import { type QualityWorkspace, runTests } from "./run-tests";

async function sourceInventory(root: string): Promise<Array<[string, string]>> {
  const files = productionTypeScriptFiles(root).map((name) => join(root, name));
  return Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")]));
}

export async function runCoverage(
  reportOnly: boolean,
  workspace: QualityWorkspace,
): Promise<number> {
  const { root } = workspace;
  const reports = join(root, "coverage");
  const evidence = join(reports, "quality.json");
  await Promise.all(
    [evidence, join(reports, "tests.xml")].map((file) => rm(file, { force: true })),
  );
  const session = await mkdtemp(join(tmpdir(), "gitten-coverage-"));
  try {
    const plan = instrumentSources(await sourceInventory(root));
    await writeFile(join(session, "modules.json"), JSON.stringify(plan.modules));
    await runTests(session, join(import.meta.dir, "coverage-preload.ts"), workspace);

    const measurements = await readCounters(session);
    const result = coverageResults(plan.baseline, measurements);
    await mkdir(reports, { recursive: true });
    const files = result.files.map((file) => ({ ...file, file: relative(root, file.file) }));
    await writeFile(evidence, JSON.stringify({ ...result, files }, null, 2));
    printCoverage({ ...result, files });
    return reportOnly || result.complete ? 0 : 1;
  } finally {
    await rm(session, { recursive: true, force: true });
  }
}

async function readCounters(session: string): Promise<CoverageMapData[]> {
  const names = await readdir(session);
  const childReports = names
    .filter((name) => /^child-\d+\.started$/.test(name))
    .map((name) => name.replace(/\.started$/, ".json"));
  for (const name of childReports) {
    if (!names.includes(name)) throw new Error(`Missing coverage report from ${name}`);
  }
  return Promise.all(
    ["counters.json", ...childReports].map(
      async (name) => JSON.parse(await readFile(join(session, name), "utf8")) as CoverageMapData,
    ),
  );
}

function printCoverage(result: ReturnType<typeof coverageResults>): void {
  for (const { metric, covered, total } of result.totals) {
    console.log(`${metric}: ${covered}/${total}`);
  }
  if (result.complete) return;
  for (const { file, metrics } of result.files) {
    const gaps = metrics.filter(({ total, covered, skipped }) => total !== covered || skipped > 0);
    if (gaps.length > 0) {
      const counts = gaps.map(({ metric, covered, total }) => `${metric} ${covered}/${total}`);
      console.error(`${file} · ${counts.join(", ")}`);
    }
  }
}

export async function runCoverageCommand(
  args: string[],
  workspace: QualityWorkspace,
): Promise<number> {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--report")) {
    console.error("Usage: bun run quality:coverage [--report]");
    return 1;
  }
  return runCoverage(args[0] === "--report", workspace);
}

if (import.meta.main) {
  process.exitCode = await runCoverageCommand(process.argv.slice(2), { root: projectRoot });
}
