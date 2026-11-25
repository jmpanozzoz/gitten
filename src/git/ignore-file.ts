import { lstat, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function fileMode(file: string): Promise<number | undefined> {
  try {
    const entry = await lstat(file);
    if (!entry.isFile()) throw new Error(".gitignore needs to be a regular file.");
    return entry.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function readIgnoreFile(root: string): Promise<string[]> {
  const file = join(root, ".gitignore");
  if ((await fileMode(file)) === undefined) return [];
  const contents = await readFile(file, "utf8");
  return contents ? contents.replace(/\r?\n$/, "").split(/\r?\n/) : [];
}

export async function writeIgnoreFile(
  root: string,
  lines: readonly string[],
  expected?: readonly string[],
): Promise<void> {
  const file = join(root, ".gitignore");
  const mode = (await fileMode(file)) ?? 0o644;
  const directory = await mkdtemp(join(root, ".gitten-ignore-"));
  const candidate = join(directory, "gitignore");
  try {
    await writeFile(candidate, `${lines.join("\n")}\n`, { flag: "wx", mode });
    if (expected && JSON.stringify(await readIgnoreFile(root)) !== JSON.stringify(expected)) {
      throw new Error(
        ".gitignore changed before saving. Open the action again to review its current contents.",
      );
    }
    await rename(candidate, file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
