import type { SimpleGit } from "simple-git";
import type { CommitSummary, LogPage } from "../core/ports/git-client.port";
import { amendMessageOnly } from "./amend-message";
import type { GitContext } from "./client-context";

async function readCommits(
  git: SimpleGit,
  options: string[],
  revision: string,
): Promise<CommitSummary[]> {
  const records = await git.raw([
    "log",
    "-z",
    "--no-show-signature",
    "--no-notes",
    "--format=%H%x00%s%x00%b",
    ...options,
    "--end-of-options",
    revision,
    "--",
  ]);
  const fields = records.split("\0");
  const commits: CommitSummary[] = [];
  for (let offset = 0; offset + 2 < fields.length; offset += 3) {
    commits.push({
      hash: fields[offset]!,
      message: fields[offset + 1]!,
      body: fields[offset + 2]!,
    });
  }
  return commits;
}

export const historyAPI = {
  getLog(ref: string, limit: number, offset = 0): Promise<CommitSummary[]> {
    return readCommits(this.git, [`--max-count=${limit}`, `--skip=${offset}`], ref);
  },
  async readLogPage({
    head,
    limit,
    offset,
  }: {
    head?: string;
    limit: number;
    offset: number;
  }): Promise<LogPage> {
    const anchor =
      head ?? (await this.git.revparse(["--verify", "HEAD^{commit}"]).catch(() => null));
    if (!anchor) return { head: null, commits: [], hasNext: false };
    const commits = await this.getLog(anchor, limit + 1, offset);
    return { head: anchor, commits: commits.slice(0, limit), hasNext: commits.length > limit };
  },
  async getLastCommit(): Promise<CommitSummary> {
    const [first] = await readCommits(this.git, ["-1"], "HEAD");
    return first!;
  },
  async amendCommit(message: string, messageOnly = false): Promise<void> {
    if (messageOnly) return amendMessageOnly(this.git, message);
    await this.git.raw(["commit", "--amend", "--cleanup=verbatim", "-m", message]);
  },
  async amendNoEdit(): Promise<void> {
    await this.git.raw(["commit", "--amend", "--no-edit", "--cleanup=verbatim"]);
  },
  async getLastTag(head = "HEAD"): Promise<string | null> {
    try {
      const result = await this.git.raw(["describe", "--tags", "--abbrev=0", head]);
      return result.trim();
    } catch {
      return null;
    }
  },
  getLogSince(ref: string, head = "HEAD"): Promise<CommitSummary[]> {
    return readCommits(this.git, [], `${ref}..${head}`);
  },
  async createAnnotatedTag(name: string, message: string, commit = "HEAD"): Promise<void> {
    await this.git.raw(["tag", "-a", "-m", message, "--", name, commit]);
  },
  async getCommitDiff(hash: string): Promise<string> {
    return this.git.show(["--no-ext-diff", "--no-textconv", "--no-color", hash, "--"]);
  },
} satisfies ThisType<GitContext>;
