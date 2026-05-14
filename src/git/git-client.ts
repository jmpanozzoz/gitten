import simpleGit from "simple-git";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { IGitClient, BranchSummary, CommitSummary, StatusSummary, Remote, PullResult, RepoContext } from "../core/ports/git-client.port";

export class GitClient implements IGitClient {
  private readonly git = simpleGit(process.cwd());

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
    return existsSync(join(process.cwd(), ".git", "index.lock"));
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
      files: status.files.map((f) => ({ path: f.path })),
      isClean: () => status.isClean(),
    };
  }

  async addAll(): Promise<void> {
    await this.git.add(".");
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
}
