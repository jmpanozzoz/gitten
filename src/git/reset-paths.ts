import type { SimpleGit } from "simple-git";

export async function assertResetKeepsUntracked(git: SimpleGit, target: string): Promise<void> {
  // Include ignored paths, which a hard reset can also overwrite.
  const untracked = (await git.raw(["ls-files", "--others", "--killed", "-z"]))
    .split("\0")
    .filter(Boolean);
  await assertResetKeepsPaths(git, target, untracked);
}

export async function assertResetKeepsLocalExclusions(
  git: SimpleGit,
  target: string,
): Promise<void> {
  const [ignored, untracked] = await Promise.all([
    git.raw(["ls-files", "--others", "--killed", "--ignored", "--exclude-standard", "-z"]),
    git.raw(["ls-files", "--others", "--killed", "--exclude-standard", "-z"]),
  ]);
  // --killed includes nested repositories hidden by a tracked file in the index.
  const nested = untracked.split("\0").filter((path) => path.endsWith("/"));
  await assertResetKeepsPaths(git, target, [...ignored.split("\0").filter(Boolean), ...nested]);
}

async function assertResetKeepsPaths(
  git: SimpleGit,
  target: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const [tree, ignoreCase] = await Promise.all([
    git.raw(["ls-tree", "-r", "--name-only", "-z", target]),
    git.raw(["config", "--type=bool", "--get", "core.ignorecase"]).catch(() => ""),
  ]);
  const normalize = (path: string) => (ignoreCase.trim() === "true" ? path.toLowerCase() : path);
  const tracked = new Set(tree.split("\0").filter(Boolean).map(normalize));
  const directories = new Set([...tracked].flatMap(parentDirectories));
  const collision = paths.find((path) => {
    const candidate = normalize(path.replace(/\/$/, ""));
    return (
      tracked.has(candidate) ||
      directories.has(candidate) ||
      parentDirectories(candidate).some((directory) => tracked.has(directory))
    );
  });
  if (collision)
    throw new Error(`Move or back up the untracked path '${collision}' before resetting.`);
}

function parentDirectories(path: string): string[] {
  const parents: string[] = [];
  for (let slash = path.lastIndexOf("/"); slash > 0; slash = path.lastIndexOf("/", slash - 1)) {
    parents.push(path.slice(0, slash));
  }
  return parents;
}
