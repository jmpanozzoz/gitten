import { mkdtemp, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SimpleGit } from "simple-git";
import { readCommitObject } from "./commit-object";
import { detectGitOperation } from "./operation-api";
import { commitWithIndex, gitWithIndex } from "./temporary-index";

interface AmendHead {
  oid: string;
  ref: string;
}

export async function amendMessageOnly(git: SimpleGit, message: string): Promise<void> {
  const [root, index] = await Promise.all([
    git.raw(["rev-parse", "--show-toplevel"]),
    git.raw(["rev-parse", "--path-format=absolute", "--git-path", "index"]),
  ]);
  const indexPath = index.replace(/\n$/, "");
  const lock = `${indexPath}.lock`;
  const handle = await open(lock, "wx", 0o600);
  try {
    await handle.close();
    const directory = await mkdtemp(join(dirname(indexPath), "gitten-amend-"));
    try {
      await verifyAmend(
        git,
        gitWithIndex(root.replace(/\n$/, ""), join(directory, "index")),
        message,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } finally {
    await rm(lock, { force: true });
  }
}

async function head(git: SimpleGit): Promise<AmendHead> {
  const oid = await git.revparse(["--verify", "HEAD^{commit}"]);
  const ref = await git.raw(["symbolic-ref", "--quiet", "HEAD"]).catch(() => "HEAD");
  return { oid, ref: ref.trimEnd() };
}

async function verifyAmend(git: SimpleGit, temporary: SimpleGit, message: string): Promise<void> {
  const original = await head(git);
  const before = await readCommitObject(git, original.oid);
  await temporary.raw(["read-tree", before.tree]);
  const reviewed = await head(git);
  if (reviewed.oid !== original.oid || reviewed.ref !== original.ref) {
    throw new Error("HEAD changed before the amend. Review the commit again.");
  }
  const pending = await detectGitOperation(git);
  if (pending) throw new Error(`Finish the pending ${pending} before amending.`);
  const commit = await commitWithIndex(temporary, message, ["--amend", "--only"]);
  const current = await head(git);
  if (commit !== current.oid || current.ref !== original.ref) {
    throw new Error(
      "HEAD changed during the amend. The original index was kept. Review the branch before retrying.",
    );
  }
  const after = await readCommitObject(git, commit);
  const expectedMessage = message.endsWith("\n") ? message : `${message}\n`;
  if (
    after.tree === before.tree &&
    after.parents.join(" ") === before.parents.join(" ") &&
    after.message === expectedMessage
  )
    return;
  await restorePreviousTip(git, original, commit);
}

async function restorePreviousTip(
  git: SimpleGit,
  original: AmendHead,
  commit: string,
): Promise<never> {
  try {
    await git.raw(["update-ref", "--no-deref", original.ref, original.oid, commit]);
  } catch (cause) {
    throw new Error(
      `Unexpected amend result at ${commit}. The original index was kept, but the ref could not be restored. Previous commit: ${original.oid}.`,
      { cause },
    );
  }
  throw new Error(
    `The amend changed the reviewed tree, parents, or message. Restored the previous commit and kept the original index. Created commit: ${commit}.`,
  );
}
