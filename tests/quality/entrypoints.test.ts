import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnose } from "../../scripts/quality/doctor";
import { installHooks } from "../../scripts/quality/install-hooks";
import { localGit } from "../../scripts/quality/push-snapshot";
import {
  executableTypeScript,
  projectRoot,
  repositoryFiles,
} from "../../scripts/quality/repository";
import { bunCommand, runBun } from "../support/run-bun";

function command(name: string, args: string[], cwd = projectRoot, path = process.env.PATH) {
  return runBun([join(projectRoot, "scripts/quality", name), ...args], cwd, { PATH: path });
}

test("quality scripts reject invalid command-line arguments", () => {
  for (const file of ["check.ts", "static.ts", "coverage.ts", "run-tests.ts"]) {
    const result = command(file, ["--invalid"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Usage: bun run quality:");
  }
});

test("the shared gate runs both stages and propagates either failure before allowing a push", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gitten-gate-entrypoint-"));
  try {
    const fixture = join(cwd, "fixture.ts");
    writeFileSync(fixture, "console.log('coverage fixture', ...process.argv.slice(2));");
    const configure = (first: string, second: string) => {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({
          scripts: { "quality:static": first, "quality:coverage": second },
        }),
      );
    };
    const reports = join(cwd, "coverage");
    mkdirSync(reports);
    for (const file of ["quality.json", "tests.xml"]) {
      writeFileSync(join(reports, file), "previous report");
    }
    configure('bun -e "process.exit(7)"', "bun fixture.ts");
    const early = command("check.ts", [], cwd);
    expect(early.exitCode).toBe(7);
    expect(early.stdout.toString()).not.toContain("coverage fixture");
    expect(existsSync(join(reports, "quality.json"))).toBe(false);
    expect(existsSync(join(reports, "tests.xml"))).toBe(false);

    configure('bun -e "console.log(123)"', 'bun -e "process.exit(9)"');
    const late = command("check.ts", [], cwd);
    expect(late.exitCode).toBe(9);
    expect(late.stdout.toString()).toContain("123");

    configure('bun -e "console.log(123)"', "bun fixture.ts");
    const report = command("check.ts", ["--report"], cwd);
    expect(report.exitCode).toBe(0);
    expect(report.stdout.toString()).toContain("coverage fixture --report");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("importing the quality entry point leaves existing reports untouched", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gitten-gate-import-"));
  try {
    const reports = join(cwd, "coverage");
    mkdirSync(reports);
    const existing = join(reports, "quality.json");
    writeFileSync(existing, "previous report");
    const entry = join(projectRoot, "scripts/quality/check.ts");
    const run = runBun(["--eval", `await import(${JSON.stringify(entry)})`], cwd, {});
    expect(run.exitCode).toBe(0);
    expect(run.stderr.toString()).toBe("");
    expect(existsSync(existing)).toBe(true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the static entry point validates the real TypeScript inventory", () => {
  const result = command("static.ts", []);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Static checks: 0 violation(s).");
  expect(repositoryFiles(["index.ts", "scripts"])).toContain("index.ts");
  expect(executableTypeScript("index.ts")).toBe(true);
  expect(executableTypeScript("metadata.d.ts")).toBe(false);
  expect(executableTypeScript("install.sh")).toBe(false);
});

test("Git subprocess failures without stderr still fail with actionable diagnostics", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gitten-silent-git-"));
  try {
    writeFileSync(join(cwd, "git"), "#!/bin/sh\nexit 7\n", { mode: 0o755 });
    const source = `
      import { localGit } from ${JSON.stringify(join(projectRoot, "scripts/quality/push-snapshot.ts"))};
      import { repositoryFiles } from ${JSON.stringify(join(projectRoot, "scripts/quality/repository.ts"))};
      for (const run of [() => localGit(process.cwd(), ["status"]), () => repositoryFiles([], true, process.cwd())]) {
        try { run(); } catch (error) { console.error(error.message); }
      }
    `;
    const run = Bun.spawnSync(bunCommand(["--eval", source]), {
      cwd,
      env: { ...process.env, PATH: cwd },
    });
    expect(run.exitCode).toBe(0);
    expect(run.stderr.toString().trim().split("\n")).toEqual([
      "Git exited with code 7",
      "Could not read Git's file inventory.",
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the doctor reports missing executables and checks the versioned hook without changing Git config", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gitten-doctor-entrypoint-"));
  try {
    expect(diagnose(cwd)).toContain("Restore the tracked bun.lock.");
    expect(diagnose(cwd)).toContain("Restore the executable .githooks/pre-push.");
    localGit(cwd, ["init", "--quiet"]);
    expect(diagnose(cwd)).toContain(
      "Run bun run hooks:install or integrate .githooks/pre-push with existing hooks.",
    );
    localGit(cwd, ["config", "core.hooksPath", ".githooks"]);
    mkdirSync(join(cwd, "node_modules", "typescript"), { recursive: true });
    mkdirSync(join(cwd, ".githooks"));
    writeFileSync(join(cwd, "bun.lock"), "");
    writeFileSync(join(cwd, "node_modules", "typescript", "package.json"), "{}");
    const hook = join(cwd, ".githooks", "pre-push");
    writeFileSync(hook, "");
    chmodSync(hook, 0o755);
    expect(diagnose(cwd)).toEqual([]);
    expect(diagnose(cwd, "0.0.0-fixture")).toEqual([
      expect.stringContaining("(found 0.0.0-fixture)"),
    ]);

    const emptyPath = join(cwd, "empty-path");
    mkdirSync(emptyPath);
    const missing = command("doctor.ts", [], cwd, emptyPath);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr.toString()).toContain("Install Git");
    expect(missing.stderr.toString()).toContain("Install Bash");
    expect(missing.stderr.toString()).toContain("Python 3 and PTY support");
    writeFileSync(join(emptyPath, "git"), "#!/bin/sh\nprintf 'git version 2.43.6\\n'\n", {
      mode: 0o755,
    });
    const outdated = command("doctor.ts", [], cwd, emptyPath);
    expect(outdated.exitCode).toBe(1);
    expect(outdated.stderr.toString()).toContain(
      "Git 2.43.6 is too old. Install Git 2.43.7 or later",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

function withHookRepository(run: (root: string, versionedHook: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "gitten-hook-entrypoint-"));
  try {
    localGit(root, ["init", "--quiet"]);
    mkdirSync(join(root, ".githooks"));
    run(root, join(root, ".githooks", "pre-push"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("hook installation preserves a configured path and any active legacy hooks", () => {
  withHookRepository((root, versioned) => {
    writeFileSync(versioned, "#!/bin/sh\n", { mode: 0o755 });
    const existing = join(root, " old hooks ");
    localGit(root, ["config", "core.hooksPath", existing]);
    expect(() => installHooks(root)).toThrow(JSON.stringify(existing));
    const config = () =>
      Bun.spawnSync(["git", "config", "--local", "--get", "core.hooksPath"], { cwd: root });
    expect(config().stdout.toString()).toBe(`${existing}\n`);
    localGit(root, ["config", "core.hooksPath", ""]);
    expect(() => installHooks(root)).toThrow('core.hooksPath set to ""');
    expect(config().exitCode).toBe(0);
    expect(config().stdout.toString()).toBe("\n");
    localGit(root, ["config", "--unset", "core.hooksPath"]);
    const legacy = join(root, ".git", "hooks");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "commit-msg"), "#!/bin/sh\n", { mode: 0o755 });
    expect(() => installHooks(root)).toThrow("Git hooks are already installed.");
    expect(config().exitCode).toBe(1);
  });
});

test("the hook installer rejects missing files, subdirectories, and invalid configuration before writing", () => {
  withHookRepository((root, versioned) => {
    expect(() => installHooks(root)).toThrow("missing or is not executable");
    mkdirSync(versioned);
    expect(() => installHooks(root)).toThrow("missing or is not executable");
    rmSync(versioned, { recursive: true, force: true });
    writeFileSync(versioned, "#!/bin/sh\n", { mode: 0o644 });
    expect(() => installHooks(root)).toThrow("missing or is not executable");

    const child = join(root, "child");
    mkdirSync(child);
    expect(() => installHooks(child)).toThrow("from the root of a Git worktree");
    const bare = join(root, "bare.git");
    localGit(root, ["init", "--bare", "--quiet", bare]);
    expect(() => installHooks(bare)).toThrow("from the root of a Git worktree");
    writeFileSync(join(root, ".git", "config"), "[broken\n");
    expect(() => installHooks(root)).toThrow("Could not read Git's hooks configuration.");
  });
});

test("the hook and doctor entry points work against an isolated Git directory", () => {
  withHookRepository((root) => {
    const env = {
      ...process.env,
      GIT_DIR: join(root, ".git"),
      GIT_WORK_TREE: projectRoot,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const invoke = (entry: string) =>
      runBun([join(projectRoot, "scripts/quality", entry)], root, env);
    rmSync(join(root, ".git", "hooks"), { recursive: true, force: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      const installed = invoke("install-hooks.ts");
      expect(installed.exitCode).toBe(0);
      expect(installed.stdout.toString()).toContain("Gitten pre-push configured.");
    }
    expect(localGit(root, ["config", "--local", "--get-all", "core.hooksPath"])).toBe(".githooks");
    const healthy = invoke("doctor.ts");
    expect(healthy.exitCode).toBe(0);
    expect(healthy.stdout.toString()).toContain("Quality gate prerequisites are available.");
    localGit(root, ["config", "--local", "core.hooksPath", "existing-hooks"]);
    const preserved = invoke("install-hooks.ts");
    expect(preserved.exitCode).toBe(1);
    expect(preserved.stderr.toString()).toContain('core.hooksPath set to "existing-hooks"');
    expect(localGit(root, ["config", "--local", "--get", "core.hooksPath"])).toBe("existing-hooks");
  });
});
