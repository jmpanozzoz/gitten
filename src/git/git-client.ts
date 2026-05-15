import simpleGit from "simple-git";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { IGitClient, BranchSummary, CommitSummary, StatusSummary, Remote, PullResult, DiffStat, StashEntry, WorktreeEntry, BisectResult } from "../core/ports/git-client.port";

export class GitClient implements IGitClient {
  private readonly git: ReturnType<typeof simpleGit>;
  private readonly cwd: string;

  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
    this.git = simpleGit(cwd);
  }

  async checkIsRepo(): Promise<boolean> {
    return this.git.checkIsRepo();
  }

  async initRepo(): Promise<void> {
    await this.git.init();
  }

  async getRemotes(): Promise<Remote[]> {
    const remotes = await this.git.getRemotes(true);
    return remotes.map((r) => ({ name: r.name, url: r.refs.fetch ?? r.refs.push ?? "" }));
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.git.addRemote(name, url);
  }

  async removeRemote(name: string): Promise<void> {
    await this.git.removeRemote(name);
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    await this.git.remote(["set-url", name, url]);
  }

  async hasIndexLock(): Promise<boolean> {
    return existsSync(join(this.cwd, ".git", "index.lock"));
  }

  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current ?? "";
  }

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
  }

  async getBranches(): Promise<BranchSummary> {
    const result = await this.git.branchLocal();
    return { all: result.all, current: result.current };
  }

  async getBranchLastActivity(branch: string): Promise<string> {
    const result = await this.git.raw(["log", "-1", "--format=%cr", branch]);
    return result.trim() || "no commits";
  }

  async branchExists(name: string): Promise<boolean> {
    const { all } = await this.getBranches();
    return all.includes(name);
  }

  async checkoutNewBranch(name: string): Promise<void> {
    await this.git.checkoutLocalBranch(name);
  }

  async checkoutBranch(name: string): Promise<void> {
    await this.git.checkout(name);
  }

  async stash(): Promise<void> {
    await this.git.stash(["push"]);
  }

  async deleteLocalBranch(name: string): Promise<void> {
    await this.git.deleteLocalBranch(name);
  }

  async deleteLocalBranchForce(name: string): Promise<void> {
    await this.git.deleteLocalBranch(name, true);
  }

  async deleteRemoteBranch(name: string): Promise<void> {
    await this.git.push(["origin", "--delete", name]);
  }

  async getLog(branch: string, limit: number): Promise<CommitSummary[]> {
    const log = await this.git.log([branch, `--max-count=${limit}`]);
    return log.all.map((entry) => ({
      hash: entry.hash.slice(0, 7),
      message: entry.message,
    }));
  }

  async cherryPick(hash: string): Promise<void> {
    await this.git.raw(["cherry-pick", hash]);
  }

  async cherryPickContinue(): Promise<void> {
    await this.git.raw(["cherry-pick", "--continue", "--no-edit"]);
  }

  async cherryPickAbort(): Promise<void> {
    await this.git.raw(["cherry-pick", "--abort"]);
  }

  async pull(): Promise<PullResult> {
    const result = await this.git.pull();
    return { filesChanged: result.summary.changes };
  }

  async mergeAbort(): Promise<void> {
    await this.git.merge(["--abort"]);
  }

  async mergeContinue(): Promise<void> {
    await this.git.merge(["--continue", "--no-edit"]);
  }

  async getStatus(): Promise<StatusSummary> {
    const status = await this.git.status();
    return {
      files: status.files.map((f) => ({
        path: f.path,
        status: f.working_dir !== " " ? f.working_dir : f.index,
      })),
      isClean: () => status.isClean(),
      commitsAhead: status.ahead,
    };
  }

  async addAll(): Promise<void> {
    await this.git.add(".");
  }

  async addFiles(paths: string[]): Promise<void> {
    await this.git.add(["-A", "--", ...paths]);
  }

  async getDiffStat(): Promise<DiffStat> {
    const diff = await this.git.diffSummary(["--cached"]);
    return { insertions: diff.insertions, deletions: diff.deletions };
  }

  async getStagedDiff(): Promise<string> {
    return this.git.diff(["--cached"]);
  }

  async commit(message: string): Promise<void> {
    await this.git.commit(message);
  }

  async push(setUpstream = false): Promise<void> {
    const branch = await this.getCurrentBranch();
    if (setUpstream) {
      await this.git.push(["--set-upstream", "origin", branch]);
    } else {
      await this.git.push();
    }
  }

  async readGitignore(): Promise<string[]> {
    const file = Bun.file(join(this.cwd, ".gitignore"));
    if (!(await file.exists())) return [];
    const text = await file.text();
    return text.split("\n");
  }

  async writeGitignore(lines: string[]): Promise<void> {
    await Bun.write(join(this.cwd, ".gitignore"), lines.join("\n") + "\n");
  }

  async getTrackedFiles(): Promise<string[]> {
    const result = await this.git.raw(["ls-files"]);
    return result.trim().split("\n").filter(Boolean);
  }

  async untrackFiles(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.git.raw(["rm", "--cached", ...paths]);
  }

  async getLastCommit(): Promise<CommitSummary> {
    const log = await this.git.log(["-1"]);
    const entry = log.latest;
    if (!entry) throw new Error("does not have any commits yet");
    return { hash: entry.hash.slice(0, 7), message: entry.message };
  }

  async amendCommit(message: string): Promise<void> {
    await this.git.raw(["commit", "--amend", "-m", message]);
  }

  async amendNoEdit(): Promise<void> {
    await this.git.raw(["commit", "--amend", "--no-edit"]);
  }

  async getPackageVersion(): Promise<string | null> {
    try {
      const file = Bun.file(join(this.cwd, "package.json"));
      if (!(await file.exists())) return null;
      const pkg = await file.json() as { version?: string };
      return pkg.version ?? null;
    } catch {
      return null;
    }
  }

  async getLastTag(): Promise<string | null> {
    try {
      const result = await this.git.raw(["describe", "--tags", "--abbrev=0"]);
      return result.trim() || null;
    } catch {
      return null;
    }
  }

  async getLogSince(ref: string): Promise<CommitSummary[]> {
    const log = await this.git.log([`${ref}..HEAD`]);
    return log.all.map((entry) => ({
      hash: entry.hash.slice(0, 7),
      message: entry.message,
    }));
  }

  async createAnnotatedTag(name: string, message: string): Promise<void> {
    await this.git.raw(["tag", "-a", name, "-m", message]);
  }

  async pushTag(name: string): Promise<void> {
    await this.git.raw(["push", "origin", name]);
  }

  async bisectStart(): Promise<void> {
    await this.git.raw(["bisect", "start"]);
  }

  async bisectBad(ref?: string): Promise<BisectResult> {
    const args = ref ? ["bisect", "bad", ref] : ["bisect", "bad"];
    const output = await this.git.raw(args);
    return this.parseBisectOutput(output);
  }

  async bisectGood(ref?: string): Promise<BisectResult> {
    const args = ref ? ["bisect", "good", ref] : ["bisect", "good"];
    const output = await this.git.raw(args);
    return this.parseBisectOutput(output);
  }

  async bisectReset(): Promise<void> {
    await this.git.raw(["bisect", "reset"]);
  }

  private parseBisectOutput(output: string): BisectResult {
    const match = output.match(/^([0-9a-f]{40}) is the first bad commit/m);
    if (match) {
      return { done: true, badCommit: { hash: match[1].slice(0, 7), message: "" } };
    }
    return { done: false };
  }


  async getWorktrees(): Promise<WorktreeEntry[]> {
    const raw = await this.git.raw(["worktree", "list", "--porcelain"]);
    const entries: WorktreeEntry[] = [];
    const blocks = raw.trim().split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.trim().split("\n");
      const pathLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));
      const isMain = lines.some((l) => l === "bare") || entries.length === 0;
      const isLocked = lines.some((l) => l.startsWith("locked"));
      if (!pathLine) continue;
      const path = pathLine.replace("worktree ", "").trim();
      const branch = branchLine
        ? branchLine.replace("branch refs/heads/", "").trim()
        : "(detached)";
      entries.push({ path, branch, isMain: entries.length === 0, isLocked });
    }
    return entries;
  }

  async addWorktree(path: string, branch: string, newBranch: boolean): Promise<void> {
    const args = newBranch
      ? ["worktree", "add", "-b", branch, path]
      : ["worktree", "add", path, branch];
    await this.git.raw(args);
  }

  async removeWorktree(path: string): Promise<void> {
    await this.git.raw(["worktree", "remove", path]);
  }

  async resetSoft(n: number): Promise<void> {
    await this.git.reset(["--soft", `HEAD~${n}`]);
  }

  async resetMixed(n: number): Promise<void> {
    await this.git.reset([`HEAD~${n}`]);
  }

  async filterRepoAvailable(): Promise<boolean> {
    try {
      await Bun.$`git filter-repo --version`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  async purgeFromHistory(paths: string[]): Promise<void> {
    const pathArgs = paths.flatMap((p) => ["--path", p]);
    await Bun.$`git filter-repo ${pathArgs} --invert-paths --force`.cwd(this.cwd);
  }

  async getStashes(): Promise<StashEntry[]> {
    const raw = await this.git.raw(["stash", "list", "--format=%gd|%s|%cr"]);
    if (!raw.trim()) return [];
    return raw
      .trim()
      .split("\n")
      .map((line) => {
        const [ref, ...rest] = line.split("|");
        const date = rest.pop() ?? "";
        const message = rest.join("|");
        const index = parseInt(ref.replace("stash@{", "").replace("}", ""), 10);
        return { index, message, date };
      });
  }

  async stashWithMessage(message: string): Promise<void> {
    const args = message.trim() ? ["push", "-m", message] : ["push"];
    await this.git.stash(args);
  }

  async stashApply(index: number): Promise<void> {
    await this.git.stash(["apply", `stash@{${index}}`]);
  }

  async stashPop(index: number): Promise<void> {
    await this.git.stash(["pop", `stash@{${index}}`]);
  }

  async stashDrop(index: number): Promise<void> {
    await this.git.stash(["drop", `stash@{${index}}`]);
  }

  async discardLocalChanges(): Promise<void> {
    await this.git.raw(["restore", "."]);
    await this.git.clean("fd");
  }

  async fetchRemote(): Promise<void> {
    await this.git.fetch();
  }

  async resetHardToRemote(branch: string): Promise<void> {
    await this.git.reset(["--hard", `origin/${branch}`]);
  }
}
