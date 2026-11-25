import { mkdtemp, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SimpleGit } from "simple-git";
import { type RemoteResetTarget, sameResetTarget } from "../core/domain/reset-target";
import type {
  HistoryCommit,
  HistoryRange,
  RewriteHistory,
  UndoMode,
} from "../core/ports/git-client.port";
import type { GitContext } from "./client-context";
import { readCommitObject } from "./commit-object";
import { assertResetKeepsUntracked } from "./reset-paths";
import { gitFailureDetail, strictGit } from "./strict-git";
import { commitWithIndex, gitWithIndex } from "./temporary-index";

interface Workspace {
  staging: SimpleGit;
  index: string;
  temporaryIndex: string;
}

export const rewriteAPI = {
  async resetToRemote(target: RemoteResetTarget): Promise<string> {
    const root = await this.getRepositoryRoot();
    const git = strictGit(root);
    await assertResetKeepsUntracked(git, target.commit);
    if (!(await resetIsCurrent(this, target))) {
      throw new Error(
        "Git state changed after the preview. Open Reset again to review the new state.",
      );
    }
    const recovery = await saveRecovery(git, target.head);
    try {
      if (!(await resetIsCurrent(this, target))) {
        throw new Error("Git state changed while saving the recovery ref. Open Reset again.");
      }
      await assertResetKeepsUntracked(git, target.commit);
      await git.reset(["--hard", "--no-recurse-submodules", target.commit, "--"]);
    } catch (error) {
      const detail = gitFailureDetail(error);
      throw new Error(
        `Previous tip saved at ${recovery}. Check Git status before retrying.\n${detail}`,
        { cause: error },
      );
    }
    return recovery;
  },
  async readRewriteHistory(limit: number): Promise<RewriteHistory> {
    const branchRef = await symbolicBranch(this.git);
    const head = await headingCommit(this.git);
    return { branchRef, commits: head ? await firstParents(this.git, head, limit) : [] };
  },

  async undoRange(range: HistoryRange, mode: UndoMode): Promise<string> {
    return withLockedIndex(this, async ({ staging, index, temporaryIndex }) => {
      await verifyRange(this, range);
      if (mode === "mixed") await staging.raw(["read-tree", range.base ?? "--empty"]);
      const backup = await beginRewrite(this, range);
      if (mode === "mixed") {
        try {
          await rename(temporaryIndex, index);
        } catch (error) {
          return recoverAfterFailure(this.git, range, range.base, { backup, error });
        }
      }
      return backup;
    });
  },

  async squashRange(range: HistoryRange, message: string): Promise<string> {
    return withLockedIndex(this, async ({ staging }) => {
      await verifyRange(this, range);
      if (!(await this.getStatus()).isClean()) {
        throw new Error("The working tree changed. Commit or stash changes before squashing.");
      }
      await staging.raw(["read-tree", range.head]);
      const backup = await beginRewrite(this, range);
      return finishSquash(this.git, staging, { range, message, backup });
    });
  },
} satisfies ThisType<GitContext>;

async function resetIsCurrent(context: GitContext, target: RemoteResetTarget): Promise<boolean> {
  return (
    sameResetTarget(target, await context.getRemoteResetTarget()) &&
    (await context.getInProgressOperation()) === null
  );
}

async function symbolicBranch(git: SimpleGit): Promise<string> {
  const ref = await git.raw(["symbolic-ref", "--quiet", "HEAD"]).catch(() => "");
  if (!ref.startsWith("refs/heads/"))
    throw new Error("Check out a local branch before rewriting history.");
  return ref.trimEnd();
}

async function headingCommit(git: SimpleGit): Promise<string | null> {
  return git.revparse(["--verify", "HEAD^{commit}"]).catch(() => null);
}

async function firstParents(git: SimpleGit, head: string, limit: number): Promise<HistoryCommit[]> {
  const raw = await git.raw([
    "--no-replace-objects",
    "log",
    "-z",
    "--first-parent",
    `--max-count=${limit}`,
    "--format=%H%x00%P%x00%s",
    head,
    "--",
  ]);
  const fields = raw.split("\0");
  const commits: HistoryCommit[] = [];
  for (let offset = 0; offset + 2 < fields.length; offset += 3) {
    const firstParent = fields[offset + 1]!.split(" ")[0] || null;
    commits.push({ oid: fields[offset]!, firstParent, subject: fields[offset + 2]! });
  }
  return commits;
}

async function verifyRange(context: GitContext, range: HistoryRange): Promise<void> {
  const pending = await context.getInProgressOperation();
  if (pending) throw new Error(`Finish the pending ${pending} before rewriting history.`);
  const current = await context.readRewriteHistory(range.count);
  if (!matchesRange(current, range)) {
    throw new Error("The branch changed after the preview. Review the history again.");
  }
  await verifyRoot(context.git, range);
}

function matchesRange(history: RewriteHistory, range: HistoryRange): boolean {
  const selected = history.commits.at(-1);
  return (
    history.branchRef === range.branchRef &&
    history.commits[0]?.oid === range.head &&
    history.commits.length === range.count &&
    selected?.oid === range.oldest &&
    selected.firstParent === range.base
  );
}

async function verifyRoot(git: SimpleGit, range: HistoryRange): Promise<void> {
  if (range.base || (await git.revparse(["--is-shallow-repository"])) !== "true") return;
  const { parents } = await readCommitObject(git, range.oldest);
  if (parents.length > 0) {
    throw new Error("The selected history is shallow. Fetch its missing parents before rewriting.");
  }
}

async function withLockedIndex<T>(
  context: GitContext,
  operation: (workspace: Workspace) => Promise<T>,
): Promise<T> {
  const root = await context.getRepositoryRoot();
  const index = (
    await context.git.raw(["rev-parse", "--path-format=absolute", "--git-path", "index"])
  ).replace(/\n$/, "");
  const lock = `${index}.lock`;
  const handle = await open(lock, "wx", 0o600);
  try {
    await handle.close();
    const directory = await mkdtemp(join(dirname(index), "gitten-rewrite-"));
    try {
      const temporaryIndex = join(directory, "index");
      return await operation({
        staging: gitWithIndex(root, temporaryIndex),
        index,
        temporaryIndex,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } finally {
    await rm(lock, { force: true });
  }
}

async function saveRecovery(git: SimpleGit, head: string): Promise<string> {
  const ref = `refs/gitten/recovery/${head}`;
  await git.raw(["update-ref", "--no-deref", ref, head]);
  return ref;
}

async function beginRewrite(context: GitContext, range: HistoryRange): Promise<string> {
  const { git } = context;
  const backup = await saveRecovery(git, range.head);
  try {
    await verifyTip(git, range.branchRef, range.head);
    const pending = await context.getInProgressOperation();
    if (pending) throw new Error(`Git started a ${pending} while saving the recovery ref.`);
    await switchTip(git, range.branchRef, range.base, range.head);
  } catch (error) {
    const reason = gitFailureDetail(error);
    throw new Error(`Could not begin the rewrite. Recovery ref ${backup}.\n${reason}`, {
      cause: error,
    });
  }
  return backup;
}

async function switchTip(
  git: SimpleGit,
  ref: string,
  destination: string | null,
  expected: string | null,
): Promise<void> {
  const action = destination
    ? [ref, destination, expected ?? "0".repeat(destination.length)]
    : ["-d", ref, expected!];
  await git.raw(["update-ref", "-m", "gitten history rewrite", "--no-deref", ...action]);
}

async function finishSquash(
  git: SimpleGit,
  staging: SimpleGit,
  { range, message, backup }: { range: HistoryRange; message: string; backup: string },
): Promise<string> {
  let expected = range.base;
  try {
    await verifyTip(git, range.branchRef, range.base);
    const commit = await commitWithIndex(staging, message, ["--allow-empty"]);
    if (!commit) throw new Error("Git did not report a usable commit ID.");
    expected = commit;
    await verifyTip(git, range.branchRef, commit);
    const [before, after] = await Promise.all([
      readCommitObject(git, range.head),
      readCommitObject(git, commit),
    ]);
    if (before.tree !== after.tree)
      throw new Error("The squash result differs from the confirmed tree.");
    if (after.parents.join(" ") !== (range.base ?? ""))
      throw new Error("The squash commit has a different parent.");
    return backup;
  } catch (error) {
    return recoverAfterFailure(git, range, expected, { backup, error });
  }
}

async function recoverAfterFailure(
  git: SimpleGit,
  range: HistoryRange,
  expected: string | null,
  { backup, error }: { backup: string; error: unknown },
): Promise<never> {
  const reason = gitFailureDetail(error);
  try {
    await switchTip(git, range.branchRef, range.head, expected);
  } catch (rollback) {
    throw new Error(
      `The rewrite failed and the ref could not be restored. Recovery ref ${backup}.\n${reason}`,
      {
        cause: rollback,
      },
    );
  }
  throw new Error(
    `The rewrite failed. Restored the original branch. Recovery ref ${backup}.\n${reason}`,
    {
      cause: error,
    },
  );
}

async function verifyTip(git: SimpleGit, ref: string, expected: string | null): Promise<void> {
  if ((await symbolicBranch(git)) !== ref || (await headingCommit(git)) !== expected) {
    throw new Error("The checked-out branch changed during the rewrite.");
  }
}
