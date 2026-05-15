import simpleGit from "simple-git";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { IGitClient, BranchSummary, CommitSummary, StatusSummary, Remote, PullResult, DiffStat } from "../core/ports/git-client.port";

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
    const status = await this.git.status();
    return {
      branch: status.current ?? "",
      modifiedCount: status.files.length,
      commitsAhead: status.ahead,
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

  async deleteLocalBranch(name: string): Promise<void> {
    await this.git.deleteLocalBranch(name);
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
    };
  }

  async addAll(): Promise<void> {
    await this.git.add(".");
  }

  async addFiles(paths: string[]): Promise<void> {
    await this.git.add(paths);
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

  async resetSoft(): Promise<void> {
    await this.git.reset(["--soft", "HEAD~1"]);
  }

  async resetMixed(): Promise<void> {
    await this.git.reset(["HEAD~1"]);
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
}
