import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runQualityProcess } from "./quality-process";

const TOOL_ENVIRONMENT = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
]);

export function localGit(root: string, args: string[], input?: string): string {
  const result = Bun.spawnSync(["git", "--no-replace-objects", ...args], {
    cwd: root,
    stdin: input === undefined ? "ignore" : Buffer.from(input),
  });
  if (!result.success) {
    throw new Error(result.stderr.toString().trim() || `Git exited with code ${result.exitCode}`);
  }
  return result.stdout.toString().trimEnd();
}

export async function verifySnapshot(
  root: string,
  commit: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const temporary = await mkdtemp(join(tmpdir(), "gitten-pre-push-"));
  const checkout = join(temporary, "checkout");
  const hooks = join(temporary, "empty-hooks");
  let linked = false;
  try {
    await mkdir(hooks);
    localGit(root, [
      "-c",
      `core.hooksPath=${hooks}`,
      "worktree",
      "add",
      "--quiet",
      "--detach",
      checkout,
      commit,
    ]);
    linked = true;
    const options = { cwd: checkout, env: toolEnvironment(), signal };
    await runQualityProcess(["install", "--frozen-lockfile"], options);
    await runQualityProcess(["run", "quality:check"], options);
  } finally {
    try {
      if (linked) localGit(root, ["worktree", "remove", "--force", checkout]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

function toolEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => TOOL_ENVIRONMENT.has(name.toUpperCase())),
  );
}
