import type { SimpleGit } from "simple-git";
import { detectGitOperation } from "./operation-api";
import { assertResetKeepsLocalExclusions } from "./reset-paths";
import { gitFailureDetail } from "./strict-git";

export async function discardLocal(git: SimpleGit): Promise<void> {
  const original = await discardHead(git);
  if (original.commit !== "(initial)") {
    await assertResetKeepsLocalExclusions(git, original.commit);
  }
  const current = await discardHead(git);
  if (original.identity !== current.identity || (await detectGitOperation(git))) {
    throw new Error("Git state changed before discarding changes. Review the working tree again.");
  }
  await git.reset(["--hard", "--no-recurse-submodules"]);
  try {
    await git.clean("fd");
  } catch (error) {
    throw new Error(
      `Tracked changes were reset, but untracked cleanup failed.\n${gitFailureDetail(error)}`,
      { cause: error },
    );
  }
}

async function discardHead(git: SimpleGit): Promise<{ commit: string; identity: string }> {
  const status = await git.raw(["status", "--porcelain=v2", "--branch", "--untracked-files=no"]);
  const [oid, branch] = status.split("\n", 2);
  const commit = /^# branch\.oid ([a-f\d]{40}(?:[a-f\d]{24})?|\(initial\))$/.exec(oid!)?.[1];
  if (!commit || !branch?.startsWith("# branch.head ")) {
    throw new Error("Could not verify HEAD before discarding local changes.");
  }
  return { commit, identity: `${oid}\n${branch}` };
}
