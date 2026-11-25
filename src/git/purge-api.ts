import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRepositoryFilePath } from "../core/domain/purge-path";
import type { PurgeScope } from "../core/ports/git-client.port";
import type { GitContext } from "./client-context";
import { strictGit } from "./strict-git";

export const purgeAPI = {
  async filterRepoAvailable(): Promise<boolean> {
    const run = Bun.spawn(["git", "filter-repo", "--version"], {
      cwd: this.cwd,
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await run.exited) === 0;
  },

  async describePurge(paths: string[]): Promise<PurgeScope> {
    if (paths.length === 0 || !paths.every(isRepositoryFilePath)) {
      throw new Error("Choose exact repository-relative file paths to remove.");
    }
    const root = await this.getRepositoryRoot();
    const git = strictGit(root);
    const candidates = await git.raw(["for-each-ref", "--format=%(objectname) %(refname)"]);
    const refs = candidates.trimEnd().split("\n").filter(Boolean);
    const files = await historicalFiles(git, paths);
    return { refs, absent: paths.filter((path) => !files.has(path)) };
  },

  async purgeFromHistory(paths: string[], expectedRefs: string[]): Promise<string> {
    const scope = await this.describePurge(paths);
    if (scope.absent.length > 0 || !sameRefs(scope.refs, expectedRefs)) {
      throw new Error("Source history changed. Reopen Purge to review the current scope.");
    }
    return buildRewrittenCopy(await this.getRepositoryRoot(), paths, expectedRefs);
  },
} satisfies ThisType<GitContext>;

function sameRefs(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((ref, index) => ref === expected[index]);
}

async function historicalFiles(
  git: ReturnType<typeof strictGit>,
  paths: string[],
): Promise<Set<string>> {
  const log = await git.raw([
    "--literal-pathspecs",
    "log",
    "--all",
    "--full-history",
    "--root",
    "-m",
    "--no-renames",
    "--no-show-signature",
    "--no-notes",
    "--format=",
    "--name-only",
    "-z",
    "--",
    ...paths,
  ]);
  return new Set(log.split("\0"));
}

function exactPathFilter(path: string): string {
  // filter-repo treats --path as both a file and a directory prefix.
  const escaped = path.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");
  return `--path-regex=\\A${escaped}\\Z`;
}

async function buildRewrittenCopy(
  root: string,
  paths: string[],
  expectedRefs: string[],
): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "gitten-purge-"));
  const copy = join(workspace, "rewritten.git");
  try {
    await strictGit(root).clone(root, copy, ["--mirror", "--no-local"]);
    const clone = strictGit(copy);
    const cloned = await clone.raw(["for-each-ref", "--format=%(objectname) %(refname)"]);
    if (!sameRefs(cloned.trimEnd().split("\n").filter(Boolean), expectedRefs)) {
      throw new Error("The verified mirror differs from the previewed refs.");
    }
    await clone.raw(["filter-repo", "--invert-paths", ...paths.map(exactPathFilter)]);
    const remaining = await historicalFiles(clone, paths);
    if (paths.some((path) => remaining.has(path)))
      throw new Error("Filtered paths remain reachable in the mirror.");
    return copy;
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}
