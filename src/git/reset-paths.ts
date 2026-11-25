import type { SimpleGit } from "simple-git";

export async function assertResetKeepsUntracked(git: SimpleGit, target: string): Promise<void> {
  // Include ignored paths, which a hard reset can also overwrite.
  const untracked = (await git.raw(["ls-files", "--others", "-z"])).split("\0").filter(Boolean);
  if (untracked.length === 0) return;
  const [tree, ignoreCase] = await Promise.all([
    git.raw(["ls-tree", "-r", "--name-only", "-z", target]),
    git.raw(["config", "--type=bool", "--get", "core.ignorecase"]).catch(() => ""),
  ]);
  const normalize = (path: string) => (ignoreCase.trim() === "true" ? path.toLowerCase() : path);
  const tracked = new Set(tree.split("\0").filter(Boolean).map(normalize));
  const directories = new Set([...tracked].flatMap(parentDirectories));
  const collision = untracked.find((path) => {
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
