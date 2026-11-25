import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  BranchSummary,
  RepoContext,
  RepositoryStatus,
  StatusSummary,
  WorktreeEntry,
} from "../core/ports/git-client.port";

import type { GitContext } from "./client-context";

export const repositoryAPI = {
  async checkIsRepo(): Promise<boolean> {
    return this.git.checkIsRepo();
  },
  async getRepositoryRoot(): Promise<string> {
    const root = await this.git.raw(["rev-parse", "--show-toplevel"]);
    return root.replace(/\n$/, "");
  },
  async initRepo(): Promise<void> {
    await this.git.init();
  },
  async hasIndexLock(): Promise<boolean> {
    const path = await this.git.raw([
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index.lock",
    ]);
    return existsSync(path.replace(/\n$/, ""));
  },
  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current ?? "";
  },
  async getRepoContext(): Promise<RepoContext> {
    const [status, diff] = await Promise.all([
      this.git.status(),
      this.git.diffSummary(["HEAD"]).catch(() => ({ insertions: 0, deletions: 0 })),
    ]);
    return {
      branch: status.current ?? "",
      modifiedCount: status.files.length,
      commitsAhead: status.ahead,
      commitsBehind: status.behind,
      insertions: diff.insertions,
      deletions: diff.deletions,
    };
  },
  async getStatus(): Promise<StatusSummary> {
    const status = await this.git.status(["--untracked-files=all"]);
    return {
      files: status.files.map((f) => ({
        path: f.path,
        status: f.working_dir !== " " ? f.working_dir : f.index,
        previousPath: f.from,
      })),
      isClean: () => status.isClean(),
      hasStagedChanges: () => status.staged.length > 0,
      commitsAhead: status.ahead,
      commitsBehind: status.behind,
    };
  },
  async describeStatus(): Promise<RepositoryStatus> {
    const status = await this.git.status(["--untracked-files=all"]);
    return {
      branch: status.detached ? "Detached HEAD" : (status.current ?? "Branch unavailable"),
      upstream: status.tracking,
      ahead: status.ahead,
      behind: status.behind,
      staged: status.files
        .filter(
          ({ index, path }) => index !== " " && index !== "?" && !status.conflicted.includes(path),
        )
        .map(({ path, from }) => ({ path, previousPath: from })),
      unstaged: status.files
        .filter(({ working_dir }) => working_dir !== " " && working_dir !== "?")
        .map(({ path }) => path),
      untracked: status.not_added,
    };
  },
  async getPackageVersion(): Promise<string | null> {
    try {
      const file = Bun.file(join(await this.getRepositoryRoot(), "package.json"));
      if (!(await file.exists())) return null;
      const pkg = (await file.json()) as { version?: unknown } | null;
      return typeof pkg?.version === "string" ? pkg.version : null;
    } catch {
      return null;
    }
  },
  async getBranches(): Promise<BranchSummary> {
    const result = await this.git.branchLocal();
    if (!result.detached) return { all: result.all, current: result.current };
    return { all: result.all.filter((branch) => branch !== result.current), current: "" };
  },
  async getBranchLastActivity(branch: string): Promise<string> {
    const result = await this.git.raw(["log", "-1", "--format=%cr", `refs/heads/${branch}`, "--"]);
    return result.trim();
  },
  async isValidBranchName(name: string): Promise<boolean> {
    try {
      return (await this.git.raw(["check-ref-format", "--branch", name])).trimEnd() === name;
    } catch {
      return false;
    }
  },
  async branchExists(name: string): Promise<boolean> {
    const { all } = await this.getBranches();
    return all.includes(name);
  },
  async checkoutNewBranch(name: string): Promise<void> {
    await this.git.checkoutLocalBranch(name);
  },
  async checkoutBranch(name: string): Promise<void> {
    await this.git.checkout(name);
  },
  async deleteLocalBranch(name: string): Promise<void> {
    await this.git.deleteLocalBranch(name);
  },
  async deleteLocalBranchForce(name: string): Promise<void> {
    await this.git.deleteLocalBranch(name, true);
  },
  async getWorktrees(): Promise<WorktreeEntry[]> {
    const raw = await this.git.raw(["worktree", "list", "--porcelain", "-z"]);
    const blocks = raw.split("\0\0").filter(Boolean);
    return blocks.map((block, index) => parseWorktree(block, index === 0));
  },
  async addWorktree(path: string, branch: string, newBranch: boolean): Promise<void> {
    if (!path || !branch || branch.startsWith("-"))
      throw new Error("A path and branch are required.");
    const destination = resolve(this.cwd, path);
    if (
      existsSync(destination) &&
      (!lstatSync(destination).isDirectory() || readdirSync(destination).length > 0)
    ) {
      throw new Error("The worktree destination must be a new or empty directory.");
    }
    await this.git.raw(["check-ref-format", `refs/heads/${branch}`]);
    if (newBranch) {
      await this.git.raw(["worktree", "add", "-b", branch, "--", destination]);
      return;
    }
    const occupied = (await this.getWorktrees()).some((entry) => entry.branch === branch);
    if (occupied) throw new Error(`Branch ${branch} is already checked out in a worktree.`);
    if (!(await this.branchExists(branch)))
      throw new Error(`Local branch ${branch} no longer exists.`);
    await this.git.raw(["worktree", "add", "--", destination, branch]);
  },
  async removeWorktree(path: string): Promise<void> {
    const resolved = resolve(this.cwd, path);
    const destination = existsSync(resolved) ? realpathSync(resolved) : resolved;
    const entry = (await this.getWorktrees()).find(({ path }) => path === destination);
    if (!entry || entry.isMain || entry.isLocked) {
      throw new Error("Choose an unlocked linked worktree from the list.");
    }
    await this.git.raw(["worktree", "remove", "--", destination]);
  },
} satisfies ThisType<GitContext>;

function parseWorktree(block: string, isMain: boolean): WorktreeEntry {
  const lines = block.split("\0");
  const path = lines[0]!.slice("worktree ".length);
  const ref = lines.find((line) => line.startsWith("branch refs/heads/"));
  const branch = ref?.slice("branch refs/heads/".length) ?? "(detached)";
  const isLocked = lines.some((line) => line === "locked" || line.startsWith("locked "));
  return { path, branch, isMain, isLocked };
}
