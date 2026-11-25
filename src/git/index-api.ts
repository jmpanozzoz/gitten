import type { CommitSelection, DiffRequest } from "../core/ports/git-client.port";
import type { GitContext } from "./client-context";
import { readIgnoreFile, writeIgnoreFile } from "./ignore-file";
import { SelectedCommit } from "./selected-commit";
import { strictGit } from "./strict-git";

const REVIEW_DIFF_FLAGS = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--full-index",
  "--ignore-submodules=none",
];

export const indexAPI = {
  async getStagedDiff(): Promise<string> {
    return this.readDiff({ scope: "staged" });
  },
  async getStagedPathDiff(paths: string[]): Promise<string> {
    const root = await this.getRepositoryRoot();
    return strictGit(root).raw([
      "--literal-pathspecs",
      "diff",
      ...REVIEW_DIFF_FLAGS,
      "--cached",
      "--",
      ...paths,
    ]);
  },
  async unstagePaths(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const root = await this.getRepositoryRoot();
    await strictGit(root).raw(["--literal-pathspecs", "reset", "--", ...paths]);
  },
  async readDiff(request: DiffRequest): Promise<string> {
    if (!("base" in request)) {
      const comparison = request.scope === "staged" ? ["--cached"] : [];
      return this.git.diff([...REVIEW_DIFF_FLAGS, ...comparison, "--"]);
    }
    const [base, target] = await Promise.all([
      this.git.revparse(["--verify", "--end-of-options", `${request.base}^{commit}`]),
      this.git.revparse(["--verify", "--end-of-options", `${request.target}^{commit}`]),
    ]);
    const comparison = request.scope === "merge-base" ? [`${base}...${target}`] : [base, target];
    return this.git.diff([...REVIEW_DIFF_FLAGS, ...comparison, "--"]);
  },
  previewSelectedCommit(paths: readonly string[]): Promise<CommitSelection> {
    return new SelectedCommit(this.git).preview(paths);
  },
  commitSelection(selection: CommitSelection, message: string): Promise<string> {
    return new SelectedCommit(this.git).commit(selection, message);
  },
  async readGitignore(): Promise<string[]> {
    return readIgnoreFile(await this.getRepositoryRoot());
  },
  async writeGitignore(lines: string[], expected?: readonly string[]): Promise<void> {
    await writeIgnoreFile(await this.getRepositoryRoot(), lines, expected);
  },
  async getTrackedFiles(): Promise<string[]> {
    const rootGit = strictGit(await this.getRepositoryRoot());
    const result = await rootGit.raw(["ls-files", "-z"]);
    return result.split("\0").filter(Boolean);
  },
  async getIgnoredTrackedFiles(): Promise<string[]> {
    const rootGit = strictGit(await this.getRepositoryRoot());
    const result = await rootGit.raw([
      "ls-files",
      "--cached",
      "--ignored",
      "--exclude-standard",
      "-z",
    ]);
    return result.split("\0").filter(Boolean);
  },
  async untrackFiles(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const rootGit = strictGit(await this.getRepositoryRoot());
    await rootGit.raw(["--literal-pathspecs", "rm", "--cached", "--", ...paths]);
  },
  async discardLocalChanges(): Promise<void> {
    await this.git.reset(["--hard"]);
    const root = (await this.git.revparse(["--show-toplevel"])).trimEnd();
    await strictGit(root).clean("fd");
  },
} satisfies ThisType<GitContext>;
