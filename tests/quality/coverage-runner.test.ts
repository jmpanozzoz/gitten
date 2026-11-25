import { expect, test } from "bun:test";
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoverageMapData } from "istanbul-lib-coverage";
import { coverageResults } from "../../scripts/quality/coverage-results";
import { instrumentSources } from "../../scripts/quality/instrumentation";
import { projectRoot } from "../../scripts/quality/repository";

const childPreload = join(projectRoot, "scripts/quality/coverage-child.ts");
const sessionModule = join(projectRoot, "scripts/quality/coverage-session.ts");

test("the coverage preloader requires a session and records an empty child without inventing coverage", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "gitten-empty-coverage-")));
  try {
    const launch = (session: string | undefined) =>
      Bun.spawn([process.execPath, "--no-env-file", "--preload", childPreload, "-e", "void 0;"], {
        cwd: directory,
        env: { ...process.env, GITTEN_COVERAGE_SESSION: session },
        stderr: "pipe",
      });
    const missing = launch(undefined);
    const [status, diagnostic] = await Promise.all([missing.exited, missing.stderr.text()]);
    expect(status).toBe(1);
    expect(diagnostic).toContain(
      "GITTEN_COVERAGE_SESSION must identify an instrumentation session.",
    );

    await writeFile(join(directory, "modules.json"), "{}");
    const empty = launch(directory);
    expect(await empty.exited).toBe(0);
    const artifact = `child-${empty.pid}`;
    expect(await readFile(join(directory, `${artifact}.started`), "utf8")).toBe("");
    expect(JSON.parse(await readFile(join(directory, `${artifact}.json`), "utf8"))).toEqual({});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the real test preload flushes counters after the last test finishes", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "gitten-test-preload-")));
  try {
    const entry = join(projectRoot, "scripts/quality/coverage-preload.ts");
    const fixture = join(directory, "sample.test.ts");
    const body =
      'import { expect, test } from "bun:test"; test("assertion", () => expect(2 + 2).toBe(4));';
    const plan = instrumentSources([
      [entry, await readFile(entry, "utf8")],
      [fixture, body],
    ]);
    await writeFile(join(directory, "modules.json"), JSON.stringify(plan.modules));
    await writeFile(fixture, body);
    const nested = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "test",
        "--preload",
        childPreload,
        "--preload",
        entry,
        fixture,
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, GITTEN_COVERAGE_SESSION: directory },
        stderr: "pipe",
      },
    );
    const [code, stderr] = await Promise.all([nested.exited, nested.stderr.text()]);
    expect(code).toBe(0);
    expect(stderr).toContain("1 pass");
    const path = join(directory, "counters.json");
    const counters: CoverageMapData = JSON.parse(await readFile(path, "utf8"));
    expect(Object.keys(counters)).toContain(fixture);
    expect(coverageResults(plan.baseline, [counters]).complete).toBe(true);

    const parent = process.env.GITTEN_COVERAGE_SESSION;
    if (parent) {
      const artifact = `child-${nested.pid}`;
      // Only the actual project preload belongs to the parent source inventory.
      await writeFile(join(parent, `${artifact}.started`), "");
      await writeFile(
        join(parent, `${artifact}.json`),
        JSON.stringify({ [entry]: counters[entry] }),
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the subprocess preloader records its start and flushes the executed source on exit", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "gitten-child-preload-")));
  try {
    const fixture = join(directory, "fixture.tsx");
    const bootstrap = join(directory, "bootstrap.ts");
    const helper = join(directory, "answer.ts");
    const helperBody = "export const answer = 42;";
    const body = 'import { answer } from "./answer"; console.log(answer);';
    const plan = instrumentSources([
      [fixture, body],
      [helper, helperBody],
      [childPreload, await readFile(childPreload, "utf8")],
      [sessionModule, await readFile(sessionModule, "utf8")],
    ]);
    await writeFile(join(directory, "modules.json"), JSON.stringify(plan.modules));
    await writeFile(fixture, body);
    await writeFile(helper, helperBody);
    // Install the actual instrumented preload modules before they install fixture instrumentation.
    await writeFile(
      bootstrap,
      `const modules = await Bun.file(${JSON.stringify(join(directory, "modules.json"))}).json();
       Bun.plugin({ name: "preloader-pilot", setup(builder) {
         builder.onLoad({ filter: /coverage-(child|session)\\.ts$/ }, ({ path }) => ({
           contents: modules[path], loader: "ts",
         }));
       } });
       const { loadCoverageSession, writeCounters } = await import(${JSON.stringify(sessionModule)});
       try { loadCoverageSession(undefined); } catch (error) {
         if (!error.message.includes("must identify an instrumentation session")) throw error;
       }
       writeCounters(import.meta.dir, "empty.json", undefined);`,
    );
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--preload",
        bootstrap,
        "--preload",
        childPreload,
        fixture,
      ],
      {
        cwd: directory,
        env: { ...process.env, GITTEN_COVERAGE_SESSION: directory },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      child.stdout.text(),
      child.stderr.text(),
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("42");
    expect(JSON.parse(await readFile(join(directory, "empty.json"), "utf8"))).toEqual({});

    const artifact = `child-${child.pid}`;
    const marker = `${artifact}.started`;
    const report = `${artifact}.json`;
    expect(await readFile(join(directory, marker), "utf8")).toBe("");
    const counters: CoverageMapData = JSON.parse(await readFile(join(directory, report), "utf8"));
    const sourceResult = coverageResults(
      { [fixture]: plan.baseline[fixture]!, [helper]: plan.baseline[helper]! },
      [{ [fixture]: counters[fixture]!, [helper]: counters[helper]! }],
    );
    expect(sourceResult.complete).toBe(true);

    const parent = process.env.GITTEN_COVERAGE_SESSION;
    if (parent) {
      await copyFile(join(directory, marker), join(parent, marker));
      await writeFile(
        join(parent, report),
        JSON.stringify({
          [childPreload]: counters[childPreload],
          [sessionModule]: counters[sessionModule],
        }),
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
