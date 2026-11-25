import type { SimpleGit } from "simple-git";

export async function readCommitObject(
  git: SimpleGit,
  oid: string,
): Promise<{ tree: string; parents: string[]; message: string }> {
  const raw = await git.raw(["--no-replace-objects", "cat-file", "commit", oid]);
  const separator = raw.indexOf("\n\n");
  const headers = raw.slice(0, separator).split("\n");
  const tree = headers[0]!.slice("tree ".length);
  const parents = headers
    .filter((line) => line.startsWith("parent "))
    .map((line) => line.slice("parent ".length));
  return { tree, parents, message: raw.slice(separator + 2) };
}
