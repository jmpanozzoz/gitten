import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContractRegistry } from "../../scripts/quality/contracts";
import { runCoverage, runCoverageCommand } from "../../scripts/quality/coverage";
import { localGit } from "../../scripts/quality/push-snapshot";
import { projectRoot } from "../../scripts/quality/repository";
import { type QualityWorkspace, runTestCommand, runTests } from "../../scripts/quality/run-tests";

const suite = "tests/decision.test.ts";
const childPreload = join(projectRoot, "scripts/quality/coverage-child.ts");
const contracts: ContractRegistry = {
  decision: {
    success: [suite, "accepts a valid result"],
    failure: [suite, "rejects an invalid result"],
  },
};

async function withWorkspace(run: (workspace: QualityWorkspace) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "gitten-coverage-gate-")));
  try {
    localGit(root, ["init", "--quiet"]);
    await Promise.all([
      mkdir(join(root, "tests")),
      mkdir(join(root, "src")),
      writeFile(join(root, ".gitignore"), "coverage/\n"),
    ]);
    await writeFile(
      join(root, "src", "decision.tsx"),
      "export function decide(valid: boolean) { return valid ? 1 : 0; }",
    );
    await run({ root, contracts });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createSuite(root: string, dropChild = false) {
  const childBody = `
      const child = Bun.spawnSync([
        process.execPath, "--no-env-file", "--preload", ${JSON.stringify(childPreload)},
        "--eval", ${JSON.stringify(
          `import { decide } from "./src/decision.tsx"; console.log(decide(false)); ${dropChild ? 'process.removeAllListeners("exit");' : ""}`,
        )}
      ], { cwd: import.meta.dir + "/..", env: process.env });
      expect(child.exitCode).toBe(0);
      expect(child.stdout.toString().trim()).toBe("0");
    `;
  await writeFile(
    join(root, suite),
    `import { expect, test } from "bun:test";
     import { decide } from "../src/decision.tsx";
     test("accepts a valid result", () => expect(decide(true)).toBe(1));
     test("rejects an invalid result", () => { ${childBody} });`,
  );
}

test("strict coverage merges the real counters for a branch exercised only in a child", async () => {
  await withWorkspace(async (workspace) => {
    const { root } = workspace;
    await createSuite(root);
    expect(await runCoverageCommand([], workspace)).toBe(0);
    const result = JSON.parse(await readFile(join(root, "coverage/quality.json"), "utf8"));
    expect(result.complete).toBe(true);
    expect(result.files).toEqual([expect.objectContaining({ file: "src/decision.tsx" })]);
    expect(await readFile(join(root, "coverage/tests.xml"), "utf8")).toContain(
      "rejects an invalid result",
    );
  });
});

test("the standalone test command publishes evidence for all declared outcomes", async () => {
  await withWorkspace(async (workspace) => {
    const { root } = workspace;
    await writeFile(
      join(root, suite),
      `import { expect, test } from "bun:test"; import { decide } from "../src/decision.tsx";
      test("accepts a valid result", () => expect(decide(true)).toBe(1));
      test("rejects an invalid result", () => expect(decide(false)).toBe(0));`,
    );
    await runTestCommand([], workspace);
    const report = await readFile(join(root, "coverage/tests.xml"), "utf8");
    expect(report).toContain('failures="0"');
    expect(report).toContain("accepts a valid result");
    expect(report).toContain("rejects an invalid result");
  });
});

test("strict coverage rejects an unloaded source file and report mode publishes the same shortfall", async () => {
  await withWorkspace(async (workspace) => {
    const { root } = workspace;
    await createSuite(root);
    await writeFile(join(root, "src/unloaded.ts"), "export function unloaded() { return 2; }");
    expect(await runCoverage(false, workspace)).toBe(1);
    const path = join(root, "coverage/quality.json");
    const strict = await readFile(path, "utf8");
    expect(JSON.parse(strict).complete).toBe(false);
    expect(JSON.parse(strict).files).toContainEqual(
      expect.objectContaining({ file: "src/unloaded.ts" }),
    );
    expect(await runCoverage(true, workspace)).toBe(0);
    expect(await readFile(path, "utf8")).toBe(strict);
  });
});

test("the coverage inventory includes root TypeScript modules and tests outside the tests directory", async () => {
  await withWorkspace(async (workspace) => {
    const { root } = workspace;
    await createSuite(root);
    await writeFile(join(root, "verify.mts"), "export const verify = () => 42;");
    await writeFile(
      join(root, "verify.test.mts"),
      'import { expect, test } from "bun:test"; import { verify } from "./verify.mts"; test("covers the root module", () => expect(verify()).toBe(42));',
    );
    await writeFile(join(root, "ambient.d.cts"), "declare const marker: string;");
    expect(await runCoverage(false, workspace)).toBe(0);
    const path = join(root, "coverage/quality.json");
    const complete = JSON.parse(await readFile(path, "utf8"));
    expect(complete.files.map(({ file }: { file: string }) => file).sort()).toEqual([
      "src/decision.tsx",
      "verify.mts",
    ]);
    expect(await readFile(join(root, "coverage/tests.xml"), "utf8")).toContain("verify.test.mts");

    await writeFile(join(root, "unloaded.cts"), "export const unloaded = () => false;");
    expect(await runCoverage(false, workspace)).toBe(1);
    const incomplete = JSON.parse(await readFile(path, "utf8"));
    expect(incomplete.files).toContainEqual(expect.objectContaining({ file: "unloaded.cts" }));
  });
});

test("test discovery rejects a suppressed test outside the tests directory", async () => {
  await withWorkspace(async (workspace) => {
    const { root } = workspace;
    await createSuite(root);
    await writeFile(
      join(root, "quality_check_spec.cjs"),
      'const { test } = require("bun:test"); test.skip("suppressed", () => {});',
    );
    await expect(runCoverage(false, workspace)).rejects.toThrow(
      "quality_check_spec.cjs:1: skip can omit required tests",
    );
  });
});

test("the quality gate rejects conditional and expected-failure tests", async () => {
  await withWorkspace(async (workspace) => {
    const { root } = workspace;
    await createSuite(root);
    const testPath = join(root, "verdict.test.mts");
    for (const [mode, setup] of [
      ["if", "test.if(false)"],
      ["failing", "test.failing"],
    ] as const) {
      await writeFile(
        testPath,
        `import { expect, test } from "bun:test"; ${setup}("verdict", () => expect(0).toBe(1));`,
      );
      await expect(runCoverage(false, workspace)).rejects.toThrow(`verdict.test.mts:1: ${mode}`);
      expect(await Bun.file(join(root, "coverage/quality.json")).exists()).toBe(false);
    }
  });
});

test("a coverage setup failure clears both reports before running tests", async () => {
  await withWorkspace(async (workspace) => {
    const { root } = workspace;
    const reports = join(root, "coverage");
    await mkdir(reports);
    for (const file of ["quality.json", "tests.xml"]) {
      await writeFile(join(reports, file), "previous report");
    }
    await writeFile(join(root, "src/invalid.ts"), "/* istanbul ignore next */ export const x = 1;");
    await expect(runCoverage(false, workspace)).rejects.toThrow(
      "Coverage suppression is not allowed",
    );
    expect(await Bun.file(join(reports, "quality.json")).exists()).toBe(false);
    expect(await Bun.file(join(reports, "tests.xml")).exists()).toBe(false);
  });
});

test("a subprocess without counters invalidates coverage and removes the previous report", async () => {
  await withWorkspace(async (workspace) => {
    const { root } = workspace;
    await createSuite(root, true);
    const reports = join(root, "coverage");
    await mkdir(reports);
    const path = join(reports, "quality.json");
    await writeFile(path, JSON.stringify({ complete: true }));
    await expect(runCoverage(true, workspace)).rejects.toThrow(
      /Missing coverage report from child-\d+\.json/,
    );
    expect(await Bun.file(path).exists()).toBe(false);
  });
});

test("the test gate rejects failed assertions, omitted tests, and missing registered outcomes", async () => {
  await withWorkspace(async (workspace) => {
    const session = join(workspace.root, "coverage");
    const path = join(workspace.root, suite);
    await mkdir(session);
    await writeFile(join(session, "tests.xml"), "previous report");
    await writeFile(
      path,
      'import { expect, test } from "bun:test"; test("fails", () => expect(0).toBe(1));',
    );
    // Keep the runner's private current report separate from the public report.
    const privateSession = join(workspace.root, "run");
    await mkdir(privateSession);
    await expect(runTests(privateSession, undefined, workspace)).rejects.toThrow(
      "test runner reported a failure",
    );
    expect(await Bun.file(join(session, "tests.xml")).exists()).toBe(false);
    await writeFile(
      path,
      'import { test } from "bun:test"; test.skip("omits a required test", () => {});',
    );
    await expect(runTests(privateSession, undefined, workspace)).rejects.toThrow(
      "skip can omit required tests",
    );
    await writeFile(
      path,
      'import { expect, test } from "bun:test"; test("accepts a valid result", () => expect(1).toBe(1));',
    );
    await expect(runTests(privateSession, undefined, workspace)).rejects.toThrow(
      "decision/failure",
    );
    expect(await Bun.file(join(session, "tests.xml")).exists()).toBe(false);
  });
});
