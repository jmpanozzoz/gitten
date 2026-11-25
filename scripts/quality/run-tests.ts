import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ContractRegistry, contractGaps } from "./contracts";
import { projectRoot, repositoryFiles, testFile, testSource } from "./repository";
import { assertFullTestRun } from "./test-report";
import { assertUnfilteredSuite } from "./test-selection";

export interface QualityWorkspace {
  root: string;
  contracts?: ContractRegistry;
}

export async function runTests(
  directory: string,
  preload: string | undefined,
  { root, contracts }: QualityWorkspace,
): Promise<void> {
  const reports = join(root, "coverage");
  const evidence = join(reports, "tests.xml");
  await rm(evidence, { force: true });
  const files = repositoryFiles([], true, root);
  const expected = files.filter(testFile);
  const sources = files.filter((file) => testSource(file) && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file));
  for (const fixture of sources) {
    assertUnfilteredSuite(fixture, await readFile(join(root, fixture), "utf8"));
  }
  const path = join(directory, "tests.xml");
  const coverage = preload ? ["--preload", preload] : [];
  const runner = Bun.spawn(
    [process.execPath, "test", ...coverage, "--reporter=junit", `--reporter-outfile=${path}`],
    {
      cwd: root,
      env: { ...process.env, GITTEN_COVERAGE_SESSION: preload ? directory : undefined },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await runner.exited) !== 0) throw new Error("The test runner reported a failure.");
  const report = await readFile(path, "utf8");
  const missing = contractGaps(assertFullTestRun(report, expected), contracts);
  if (missing.length > 0) throw new Error(`Missing contract evidence:\n${missing.join("\n")}`);
  await mkdir(reports, { recursive: true });
  await writeFile(evidence, report);
}

export async function runTestCommand(args: string[], workspace: QualityWorkspace): Promise<void> {
  if (args.length > 0) throw new Error("Usage: bun run quality:test");
  const session = await mkdtemp(join(tmpdir(), "gitten-tests-"));
  try {
    await runTests(session, undefined, workspace);
  } finally {
    await rm(session, { recursive: true, force: true });
  }
}

if (import.meta.main) await runTestCommand(process.argv.slice(2), { root: projectRoot });
