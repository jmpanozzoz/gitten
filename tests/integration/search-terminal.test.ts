import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../../package.json";
import { bunCommand, runBun } from "../support/run-bun";

const fixtures = join(import.meta.dir, "fixtures");
const driver = join(fixtures, "search-terminal.py");
const selector = join(fixtures, "search-terminal.ts");
const cli = join(import.meta.dir, "../../index.ts");
const yes = "\x1b[D\r";

function run(scenario: string, options?: { program: string; cwd: string; config: string }): string {
  const program = options?.program ?? selector;
  const args = options ? [program] : [program, scenario];
  const result = Bun.spawnSync(["python3", driver, scenario, ...bunCommand(args)], {
    cwd: options?.cwd,
    env: { ...process.env, TERM: "xterm", XDG_CONFIG_HOME: options?.config },
    timeout: 12_000,
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.success).toBe(true);
  const output = result.stdout.toString();
  expect(output).toContain("\x1b[?25l");
  expect(output).toContain("\x1b[?25h");
  return output;
}

test("searches pasted Unicode with spaces in a real terminal", () => {
  expect(run("single")).toContain('RESULT "coffee"');
});

test("redraws after a resize and preserves both Tab selections across filtering", () => {
  expect(run("multi")).toContain('RESULT ["first","coffee"]');
});

test("Escape cancels and restores the cursor and terminal attributes", () => {
  expect(run("cancel")).toContain("CANCELLED");
});

test("Ctrl+D cancels raw terminal input and restores the terminal attributes", () => {
  expect(run("eof")).toContain("CANCELLED");
});

test("the selector rejects piped input with an explicit terminal error", () => {
  const result = runBun([selector, "single"], fixtures, {});
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("An interactive terminal is required.");
});

test("the real CLI opens the menu in a Git checkout and exits through the searched action", () => {
  const directory = mkdtempSync(join(tmpdir(), "gitten-cli-terminal-"));
  try {
    const checkout = join(directory, "checkout");
    mkdirSync(checkout);
    expect(Bun.spawnSync(["git", "init", "-q", "-b", "cli-test", checkout]).success).toBe(true);
    const config = join(directory, "config");
    mkdirSync(join(config, "gitten"), { recursive: true });
    writeFileSync(
      join(config, "gitten", "update-check.json"),
      JSON.stringify({ checkedAt: Date.now(), latestVersion: version }),
    );
    const output = run("cli", {
      program: cli,
      cwd: checkout,
      config,
    });
    expect(output).toContain("checkout · cli-test");
    expect(output).toContain("See you later");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function checkInitialization(
  steps: { marker: string; keys?: string }[],
  exitCode: number,
  verify: (directory: string, output: string) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "gitten-cli-initialize-"));
  try {
    const checkout = join(directory, "checkout");
    const config = join(directory, "config");
    mkdirSync(checkout);
    mkdirSync(join(config, "gitten"), { recursive: true });
    writeFileSync(
      join(config, "gitten", "update-check.json"),
      JSON.stringify({ checkedAt: Date.now(), latestVersion: version }),
    );
    const scenario = JSON.stringify({ steps, exitCode });
    const result = Bun.spawnSync(["python3", driver, "scripted", scenario, ...bunCommand([cli])], {
      cwd: checkout,
      env: { ...process.env, XDG_CONFIG_HOME: config, TERM: "xterm" },
      timeout: 12_000,
    });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    verify(checkout, result.stdout.toString());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("Escape before initialization leaves the directory unchanged", () => {
  checkInitialization(
    [
      { marker: "Initialize one?", keys: "\x1b" },
      { marker: "Repository initialization cancelled." },
    ],
    0,
    (directory, output) => {
      expect(existsSync(join(directory, ".git"))).toBe(false);
      expect(output).not.toContain("Unexpected error");
    },
  );
});

test("Escape while entering the remote URL preserves the new local repository", () => {
  checkInitialization(
    [
      { marker: "Initialize one?", keys: yes },
      { marker: "Link a remote repository now?", keys: yes },
      { marker: "Remote name:", keys: "origin\r" },
      { marker: "Remote URL:", keys: "\x1b" },
      { marker: "Repository ready locally" },
    ],
    0,
    (directory) => {
      expect(existsSync(join(directory, ".git", "HEAD"))).toBe(true);
      const remotes = Bun.spawnSync(["git", "remote"], { cwd: directory });
      expect(remotes.exitCode).toBe(0);
      expect(remotes.stdout.toString()).toBe("");
    },
  );
});

test("startup links the requested remote to the newly initialized repository", () => {
  const remote = "https://example.test/started.git";
  checkInitialization(
    [
      { marker: "Initialize one?", keys: yes },
      { marker: "Link a remote repository now?", keys: yes },
      { marker: "Remote name:", keys: "origin\r" },
      { marker: "Remote URL:", keys: `${remote}\r` },
      { marker: "Repository and remote ready" },
    ],
    0,
    (directory) => {
      const linked = Bun.spawnSync(["git", "remote", "get-url", "origin"], { cwd: directory });
      expect(linked.exitCode).toBe(0);
      expect(linked.stdout.toString().trim()).toBe(remote);
    },
  );
});

test("failed remote setup reports a partial result and leaves the repository usable", () => {
  checkInitialization(
    [
      { marker: "Initialize one?", keys: yes },
      { marker: "Link a remote repository now?", keys: yes },
      { marker: "Remote name:", keys: "invalid name\r" },
      { marker: "Remote URL:", keys: "https://example.test/failed.git\r" },
      { marker: "Remote setup failed" },
    ],
    1,
    (directory, output) => {
      expect(output).toContain("Repository initialized");
      expect(output).not.toContain("Repository and remote ready");
      const status = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: directory });
      expect(status.exitCode).toBe(0);
      const remotes = Bun.spawnSync(["git", "remote"], { cwd: directory });
      expect(remotes.exitCode).toBe(0);
      expect(remotes.stdout.toString()).toBe("");
    },
  );
});

test("the real CLI exits before opening the menu when Git is below the minimum version", () => {
  const directory = mkdtempSync(join(tmpdir(), "gitten-cli-old-git-"));
  try {
    writeFileSync(join(directory, "git"), "#!/bin/sh\nprintf 'git version 2.43.6\\n'\n", {
      mode: 0o755,
    });
    const expected =
      "Git 2.43.6 is too old. Install Git 2.43.7 or later and make sure it is on PATH.";
    const scenario = JSON.stringify({ steps: [{ marker: expected }], exitCode: 1 });
    const result = Bun.spawnSync(
      [
        "python3",
        driver,
        "scripted",
        scenario,
        ...bunCommand([join(import.meta.dir, "../../index.ts")]),
      ],
      {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, TERM: "xterm" },
        timeout: 12_000,
      },
    );
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(expected);
    expect(result.stdout.toString()).not.toContain("Your Git assistant");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
