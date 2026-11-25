import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { localGit } from "./push-snapshot";
import { executableFile, projectRoot } from "./repository";

export function installHooks(root: string): void {
  const configured = Bun.spawnSync(["git", "config", "--get", "core.hooksPath"], { cwd: root });
  if (configured.exitCode !== 0 && configured.exitCode !== 1) {
    throw new Error("Could not read Git's hooks configuration.");
  }
  const path = configured.stdout.toString().replace(/\r?\n$/, "");
  if (configured.success && path !== ".githooks") {
    throw new Error(
      `Git already has core.hooksPath set to ${JSON.stringify(path)}. Preserve it and integrate .githooks/pre-push manually.`,
    );
  }
  requireWorktreeRoot(root);
  if (!executableFile(join(root, ".githooks", "pre-push"))) {
    throw new Error("Versioned pre-push hook is missing or is not executable.");
  }
  if (path === ".githooks") return;
  const hooksDirectory = localGit(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "hooks",
  ]);
  if (
    existsSync(hooksDirectory) &&
    readdirSync(hooksDirectory).some((name) => !name.endsWith(".sample"))
  ) {
    throw new Error(
      "Git hooks are already installed. Integrate .githooks/pre-push without replacing them.",
    );
  }
  localGit(root, ["config", "--local", "core.hooksPath", ".githooks"]);
}

function requireWorktreeRoot(root: string): void {
  const worktree = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: root });
  const checkout = worktree.stdout.toString().replace(/\r?\n$/, "");
  if (!worktree.success || realpathSync(checkout) !== realpathSync(root)) {
    throw new Error("Install the pre-push hook from the root of a Git worktree.");
  }
}

if (import.meta.main) {
  try {
    installHooks(projectRoot);
    console.log("Gitten pre-push configured.");
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
