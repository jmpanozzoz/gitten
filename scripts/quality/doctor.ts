import { existsSync } from "node:fs";
import { join } from "node:path";
import { packageManager } from "../../package.json";
import { gitPrerequisiteIssue } from "../../src/git/git-version";
import { executableFile, projectRoot } from "./repository";

const bunVersion = packageManager.slice("bun@".length);

function command(args: string[], cwd: string): string | undefined {
  try {
    const result = Bun.spawnSync(args, { cwd });
    return result.success ? result.stdout.toString().trim() : undefined;
  } catch {
    return undefined;
  }
}

export function diagnose(root: string, runtimeVersion = Bun.version): string[] {
  const issues: string[] = [];
  if (runtimeVersion !== bunVersion)
    issues.push(`Install Bun ${bunVersion} (found ${runtimeVersion}).`);
  if (!existsSync(join(root, "bun.lock"))) issues.push("Restore the tracked bun.lock.");
  if (!existsSync(join(root, "node_modules", "typescript", "package.json"))) {
    issues.push("Install project dependencies with bun install --frozen-lockfile.");
  }
  const gitIssue = gitPrerequisiteIssue();
  if (gitIssue) issues.push(gitIssue);
  else if (command(["git", "rev-parse", "--show-toplevel"], root) === undefined) {
    issues.push("Run this command in a Gitten checkout.");
  } else if (command(["git", "config", "--get", "core.hooksPath"], root) !== ".githooks") {
    issues.push("Run bun run hooks:install or integrate .githooks/pre-push with existing hooks.");
  }
  if (!executableFile(join(root, ".githooks", "pre-push"))) {
    issues.push("Restore the executable .githooks/pre-push.");
  }
  if (command(["bash", "--version"], root) === undefined) issues.push("Install Bash.");
  if (command(["python3", "-c", "import pty, termios"], root) === undefined) {
    issues.push("Run the development gate on macOS, Linux, or WSL with Python 3 and PTY support.");
  }
  return issues;
}

if (import.meta.main) {
  const issues = diagnose(projectRoot);
  if (issues.length > 0) {
    for (const issue of issues) console.error(issue);
    process.exitCode = 1;
  } else {
    console.log("Quality gate prerequisites are available.");
  }
}
