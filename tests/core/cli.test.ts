import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../../package.json";
import { runCli } from "../../src/composition/cli";
import { runBun } from "../support/run-bun";

const root = join(import.meta.dir, "../..");
const binary = join(root, "index.ts");

test("CLI prints help and version without requiring an interactive terminal", () => {
  const help = runBun([binary, "--help"], root, {});
  expect(help.success).toBe(true);
  expect(help.stdout.toString()).toContain("Usage: gitten");
  const versionRun = runBun([binary, "--version"], root, {});
  expect(versionRun.success).toBe(true);
  expect(versionRun.stdout.toString().trim()).toBe(`gitten v${version}`);
});

test("CLI reports invalid arguments and non-interactive input with exit code 2", () => {
  const bad = runBun([binary, "--invalid"], root, {});
  expect(bad.exitCode).toBe(2);
  expect(bad.stderr.toString()).toContain("Usage: gitten");
  const nonInteractive = runBun([binary], root, {});
  expect(nonInteractive.exitCode).toBe(2);
  expect(nonInteractive.stderr.toString()).toContain("interactive terminal is required");
});

test("CLI starts an interactive session and translates startup errors to exit code 1", async () => {
  const errors: string[] = [];
  const input = {
    args: [],
    version,
    interactive: true,
    gitPrerequisiteIssue: () => undefined,
    stdout: () => {},
    stderr: (message: string) => errors.push(message),
  };
  expect(await runCli({ ...input, start: async () => 0 })).toBe(0);
  expect(
    await runCli({
      ...input,
      start: async () => {
        throw new Error("sample failure");
      },
    }),
  ).toBe(1);
  expect(errors).toEqual(["Unexpected error: sample failure"]);
});

test("the CLI sanitizes a non-Error thrown by an adapter", async () => {
  const diagnostics: string[] = [];
  const code = await runCli({
    args: [],
    version,
    interactive: true,
    gitPrerequisiteIssue: () => undefined,
    stdout: () => {},
    stderr: (message) => diagnostics.push(message),
    start: () => Promise.reject("https://name:password@example.test/path?token=secret"),
  });
  expect(code).toBe(1);
  expect(diagnostics).toEqual(["Unexpected error: https://example.test/path?token=[redacted]"]);
});

test("the interactive CLI reports missing Git before starting the application", async () => {
  const start = () => Promise.reject(new Error("application should not start"));
  const errors: string[] = [];
  const issue =
    "Git executable not found. Install Git 2.43.7 or later and make sure it is on PATH.";
  expect(
    await runCli({
      args: [],
      version,
      interactive: true,
      gitPrerequisiteIssue: () => issue,
      start,
      stdout: () => {},
      stderr: (message) => errors.push(message),
    }),
  ).toBe(1);
  expect(errors).toEqual([issue]);
});

test("the Git prerequisite accepts supported vendor versions and rejects older, missing, and unreadable Git", () => {
  const directory = mkdtempSync(join(tmpdir(), "gitten-git-prerequisite-"));
  const executable = join(directory, "git");
  const adapter = join(root, "src/git/git-version.ts");
  const source = `import { gitPrerequisiteIssue } from ${JSON.stringify(adapter)}; console.log(gitPrerequisiteIssue() ?? "ready");`;
  const inspect = () => {
    const result = runBun(["--eval", source], directory, { PATH: directory });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    return result.stdout.toString().trim();
  };
  try {
    expect(inspect()).toContain("Git executable not found");
    const cases = [
      ["git version 2.43.7", "ready"],
      ["git version 2.43.7.windows.1", "ready"],
      ["git version 2.54.0 (Apple Git-157)", "ready"],
      ["git version 3.0.0", "ready"],
      ["git version 2.43.6", "Git 2.43.6 is too old"],
      ["git version 2.42.19", "Git 2.42.19 is too old"],
      ["git version 2.43.7.rc1", "Git 2.43.7.rc1 is too old"],
      ["malformed output", "Could not read the Git version"],
    ];
    for (const [reported, expected] of cases) {
      writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' '${reported}'\n`, { mode: 0o755 });
      expect(inspect()).toContain(expected!);
    }
    writeFileSync(executable, "#!/bin/sh\nexit 7\n");
    expect(inspect()).toContain("Could not read the Git version");
    writeFileSync(executable, "#!/gitten/no-such-interpreter\n");
    expect(inspect()).toContain("Could not read the Git version");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
