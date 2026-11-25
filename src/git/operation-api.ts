import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SimpleGit } from "simple-git";
import { type PullTarget, PullTargetChanged } from "../core/domain/pull-target";
import type {
  BisectResult,
  ConflictOperation,
  GitOperation,
  PullResult,
} from "../core/ports/git-client.port";
import type { GitContext } from "./client-context";
import { strictGit } from "./strict-git";

const OPERATION_MARKERS: ReadonlyArray<readonly [string, GitOperation]> = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["BISECT_START", "bisect"],
];

const CONFLICT_MARKERS: Record<ConflictOperation, readonly string[]> = {
  merge: ["MERGE_HEAD"],
  "cherry-pick": ["CHERRY_PICK_HEAD"],
  revert: ["REVERT_HEAD"],
  rebase: [
    "REBASE_HEAD",
    "rebase-merge/orig-head",
    "rebase-merge/onto",
    "rebase-merge/msgnum",
    "rebase-apply/orig-head",
    "rebase-apply/onto",
    "rebase-apply/next",
  ],
};

async function readMarker(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function worktreeGitDirectory(git: SimpleGit): Promise<string> {
  return (await git.raw(["rev-parse", "--absolute-git-dir"])).replace(/\n$/, "");
}

export async function detectGitOperation(git: SimpleGit): Promise<GitOperation | null> {
  const directory = await worktreeGitDirectory(git);
  return OPERATION_MARKERS.find(([marker]) => existsSync(join(directory, marker)))?.[1] ?? null;
}

function parseBisectOutput(output: string): BisectResult {
  const hash = output.match(/^([0-9a-f]{40}(?:[0-9a-f]{24})?) is the first bad commit/m)?.[1];
  if (hash) {
    return { done: true, badCommit: { hash, message: "" } };
  }
  return { done: false };
}

async function continueWithOriginalMessage(
  cwd: string,
  operation: Exclude<GitOperation, "bisect">,
): Promise<void> {
  const continuation = strictGit({
    baseDir: cwd,
    config: ["core.editor=true"],
    allowConfig: ["core.editor"],
  });
  await continuation.raw([operation, "--continue"]);
}

async function pullWithChanges(
  context: GitContext,
  options: string[],
  target?: PullTarget,
): Promise<PullResult> {
  const { git } = context;
  const readHead = () =>
    git
      .revparse(["--verify", "HEAD"])
      .then((oid) => oid.trim())
      .catch(() => null);
  const before = await readHead();
  await git.pull(await pullArguments(context, options, target));
  const after = await readHead();
  if (!after) {
    throw new Error(
      "Pull completed, but HEAD could not be resolved. Check Git status before retrying.",
    );
  }
  if (before === after) return { filesChanged: 0, headChanged: false };
  const args = before
    ? ["diff", "--no-ext-diff", "--name-only", "-z", before, after, "--"]
    : ["ls-tree", "-r", "--name-only", "-z", after];
  const paths = await git.raw(args).catch((cause) => {
    throw new Error("Pull updated HEAD, but Git could not count the changed files.", { cause });
  });
  return {
    filesChanged: paths.split("\0").filter(Boolean).length,
    headChanged: true,
  };
}

async function pullArguments(
  context: GitContext,
  options: string[],
  target?: PullTarget,
): Promise<string[]> {
  if (!target) return options;
  const current = await context.getPullTarget().catch(() => null);
  if (
    JSON.stringify(current) !== JSON.stringify(target) ||
    (await context.getInProgressOperation())
  ) {
    throw new PullTargetChanged();
  }
  return [...options, "--", target.remote, ...target.refs];
}

export const operationAPI = {
  async cherryPick(hash: string): Promise<void> {
    await this.git.raw(["cherry-pick", hash]);
  },
  async cherryPickContinue(): Promise<void> {
    await continueWithOriginalMessage(this.cwd, "cherry-pick");
  },
  async cherryPickAbort(): Promise<void> {
    await this.git.raw(["cherry-pick", "--abort"]);
  },
  async revertCommit(hash: string): Promise<void> {
    await this.git.raw(["revert", "--no-edit", hash]);
  },
  async revertContinue(): Promise<void> {
    await continueWithOriginalMessage(this.cwd, "revert");
  },
  async revertAbort(): Promise<void> {
    await this.git.raw(["revert", "--abort"]);
  },
  pull(target?: PullTarget): Promise<PullResult> {
    return pullWithChanges(this, ["--no-rebase", "--no-edit"], target);
  },
  async mergeAbort(): Promise<void> {
    await this.git.merge(["--abort"]);
  },
  async mergeContinue(): Promise<void> {
    await continueWithOriginalMessage(this.cwd, "merge");
  },
  async rebaseAbort(): Promise<void> {
    await this.git.rebase(["--abort"]);
  },
  async rebaseContinue(): Promise<void> {
    await continueWithOriginalMessage(this.cwd, "rebase");
  },
  getInProgressOperation(): Promise<GitOperation | null> {
    return detectGitOperation(this.git);
  },
  async getConflictIdentity(operation: ConflictOperation): Promise<string | null> {
    const directory = await worktreeGitDirectory(this.git);
    const states = await Promise.all(
      CONFLICT_MARKERS[operation].map((marker) => readMarker(join(directory, marker))),
    );
    if (states.every((state) => state === null)) return null;
    const head = await this.git.revparse(["--verify", "HEAD"]);
    return JSON.stringify([operation, head, ...states]);
  },
  pullRebase(target?: PullTarget): Promise<PullResult> {
    return pullWithChanges(this, ["--rebase"], target);
  },
  async getConflictedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return status.conflicted;
  },
  async hasStagedConflictMarkers(): Promise<boolean> {
    const check = Bun.spawn(
      ["git", "diff", "--cached", "--check", "--no-ext-diff", "--no-textconv"],
      {
        cwd: this.cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, LC_ALL: "C" },
      },
    );
    const [code, output, errors] = await Promise.all([
      check.exited,
      check.stdout.text(),
      check.stderr.text(),
    ]);
    if (code !== 0 && (code !== 2 || errors))
      throw new Error(errors.trim() || "Could not check the index.");
    return /: leftover conflict marker$/m.test(output);
  },
  async getConflictDiff(): Promise<string> {
    // During a merge/cherry-pick/revert conflict the working tree holds the
    // conflict markers; a bare diff surfaces them.
    return this.git.diff();
  },
  async bisectStart(): Promise<void> {
    await this.git.raw(["bisect", "start"]);
  },
  async bisectBad(ref?: string): Promise<BisectResult> {
    const args = ref ? ["bisect", "bad", ref] : ["bisect", "bad"];
    const output = await this.git.raw(args);
    return parseBisectOutput(output);
  },
  async bisectGood(ref?: string): Promise<BisectResult> {
    const args = ref ? ["bisect", "good", ref] : ["bisect", "good"];
    const output = await this.git.raw(args);
    return parseBisectOutput(output);
  },
  async bisectSkip(): Promise<BisectResult> {
    return parseBisectOutput(await this.git.raw(["bisect", "skip"]));
  },
  async bisectReset(): Promise<void> {
    await this.git.raw(["bisect", "reset"]);
  },
} satisfies ThisType<GitContext>;
