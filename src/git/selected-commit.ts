import { copyFile, mkdtemp, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SimpleGit } from "simple-git";
import type { CommitSelection } from "../core/ports/git-client.port";
import { readCommitObject } from "./commit-object";
import { detectGitOperation } from "./operation-api";
import { commitWithIndex, gitWithIndex } from "./temporary-index";

interface SelectionRepository {
  root: string;
  index: string;
  head: string | null;
  branchRef: string;
}

export class SelectedCommit {
  constructor(private readonly git: SimpleGit) {}

  async preview(paths: readonly string[]): Promise<CommitSelection> {
    await this.requireNoOperation();
    const repo = await this.repository();
    const directory = await this.temporaryDirectory(repo);
    try {
      const staging = await this.stageSelection(repo, join(directory, "selection"), paths);
      const tree = (await staging.raw(["write-tree"])).trim();
      const [diff, { insertions, deletions }] = await Promise.all([
        staging.diff(["--cached", "--no-ext-diff", "--no-textconv", "--no-color"]),
        staging.diffSummary(["--cached", "--no-ext-diff", "--no-textconv", "--no-color"]),
      ]);
      return {
        paths: [...paths],
        head: repo.head,
        branchRef: repo.branchRef,
        tree,
        diff,
        stat: { insertions, deletions },
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async commit(selection: CommitSelection, message: string): Promise<string> {
    const repo = await this.repository();
    this.requireSameHead(selection, repo);
    const lock = `${repo.index}.lock`;
    const handle = await open(lock, "wx", 0o600);
    try {
      await handle.close();
      return await this.commitUnderLock(repo, selection, message);
    } finally {
      await rm(lock, { force: true });
    }
  }

  private async commitUnderLock(
    repo: SelectionRepository,
    selection: CommitSelection,
    message: string,
  ): Promise<string> {
    const directory = await this.temporaryDirectory(repo);
    const nextIndex = join(directory, "next-index");
    let preserveIndex = false;
    try {
      const staging = await this.stageSelection(
        repo,
        join(directory, "selection"),
        selection.paths,
      );
      if ((await staging.raw(["write-tree"])).trim() !== selection.tree) {
        throw new Error("Selected files changed after the preview. Start Sync again.");
      }

      await this.prepareNextIndex(repo, nextIndex, selection);
      this.requireSameHead(selection, await this.repository());
      await this.requireNoOperation();
      const commit = await commitWithIndex(staging, message);
      const committed = await this.repository();
      if (!committed.head || committed.head === repo.head) {
        throw new Error("No new commit remains at HEAD. The original index was kept.");
      }
      if (commit !== committed.head) {
        throw new Error("HEAD does not match Git's commit result. The original index was kept.");
      }
      if (committed.branchRef !== repo.branchRef) {
        throw new Error("HEAD changed during commit. The original index was kept.");
      }
      await this.verifyCommittedTree(repo, commit, selection);
      preserveIndex = true;
      await rename(nextIndex, repo.index);
      preserveIndex = false;
      return commit;
    } catch (error) {
      if (preserveIndex) {
        throw new Error(
          `Commit created, but the index could not be restored. Recovery index: ${nextIndex}`,
          {
            cause: error,
          },
        );
      }
      throw error;
    } finally {
      if (!preserveIndex) await rm(directory, { recursive: true, force: true });
    }
  }

  private async verifyCommittedTree(
    original: SelectionRepository,
    commit: string,
    selection: CommitSelection,
  ): Promise<void> {
    const { tree, parents } = await readCommitObject(this.git, commit);
    const parentChanged = parents.join(" ") !== (original.head ?? "");
    if (!parentChanged && tree === selection.tree) return;
    const affected = parentChanged ? "the commit's parent" : "the previewed tree";
    try {
      const compareAndSwap = original.head
        ? ["update-ref", original.branchRef, original.head, commit]
        : ["update-ref", "-d", original.branchRef, commit];
      await this.git.raw(compareAndSwap);
    } catch (error) {
      throw new Error(
        `A hook changed ${affected} at ${commit}. The branch could not be restored. The original index was kept.`,
        {
          cause: error,
        },
      );
    }
    throw new Error(
      `A Git hook changed ${affected}. Restored the original branch and index. Created commit: ${commit}`,
    );
  }

  private async stageSelection(
    repo: SelectionRepository,
    path: string,
    paths: readonly string[],
  ): Promise<SimpleGit> {
    if (paths.length === 0) throw new Error("Select at least one file to commit.");
    const git = gitWithIndex(repo.root, path);
    await git.raw(["read-tree", repo.head ?? "--empty"]);
    await git.raw(["--literal-pathspecs", "add", "-A", "--", ...paths]);
    return git;
  }

  private async prepareNextIndex(
    repo: SelectionRepository,
    nextIndex: string,
    selection: CommitSelection,
  ): Promise<void> {
    const git = gitWithIndex(repo.root, nextIndex);
    try {
      await copyFile(repo.index, nextIndex);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await git.raw(["read-tree", repo.head ?? "--empty"]);
    }
    await git.raw(["--literal-pathspecs", "reset", "-q", selection.tree, "--", ...selection.paths]);
  }

  private async repository(): Promise<SelectionRepository> {
    const [root, index, head, branchRef] = await Promise.all([
      this.git.raw(["rev-parse", "--show-toplevel"]),
      this.git.raw(["rev-parse", "--path-format=absolute", "--git-path", "index"]),
      this.git.revparse(["--verify", "HEAD"]).catch(() => null),
      this.git.raw(["symbolic-ref", "--quiet", "HEAD"]),
    ]);
    return {
      root: root.replace(/\n$/, ""),
      index: index.replace(/\n$/, ""),
      head,
      branchRef: branchRef.trimEnd(),
    };
  }

  private temporaryDirectory(repo: SelectionRepository): Promise<string> {
    return mkdtemp(join(dirname(repo.index), "gitten-commit-"));
  }

  private async requireNoOperation(): Promise<void> {
    const operation = await detectGitOperation(this.git);
    if (operation) {
      throw new Error(`Finish the pending Git operation (${operation}) before using Sync.`);
    }
  }

  private requireSameHead(selection: CommitSelection, current: SelectionRepository): void {
    if (selection.head !== current.head || selection.branchRef !== current.branchRef) {
      throw new Error("The current branch changed after the preview. Start Sync again.");
    }
  }
}
