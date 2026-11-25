import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readIgnoreFile, writeIgnoreFile } from "../../src/git/ignore-file";

test("reads absent and empty ignore files and writes new patterns atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "gitten-ignore-test-"));
  try {
    const file = join(root, ".gitignore");
    expect(await readIgnoreFile(root)).toEqual([]);
    await writeFile(file, "");
    expect(await readIgnoreFile(root)).toEqual([]);
    await writeFile(file, "first\r\nsecond\r\n", { mode: 0o600 });
    expect(await readIgnoreFile(root)).toEqual(["first", "second"]);
    const permissions = (await stat(file)).mode & 0o777;
    await writeIgnoreFile(root, ["cache/", "\\#literal"]);
    expect(await readFile(file, "utf8")).toBe("cache/\n\\#literal\n");
    expect((await stat(file)).mode & 0o777).toBe(permissions);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses a symlink or directory without touching unrelated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "gitten-ignore-test-"));
  try {
    const file = join(root, ".gitignore");
    const target = join(root, "preserve.txt");
    await writeFile(target, "preserve this");
    await symlink(target, file);
    await expect(readIgnoreFile(root)).rejects.toThrow("regular file");
    await expect(writeIgnoreFile(root, ["wrong"])).rejects.toThrow("regular file");
    expect(await readFile(target, "utf8")).toBe("preserve this");
    await rm(file);
    await mkdir(file);
    await expect(readIgnoreFile(root)).rejects.toThrow("regular file");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to replace ignore rules changed since review and removes its temporary file", async () => {
  const root = await mkdtemp(join(tmpdir(), "gitten-ignore-concurrent-"));
  try {
    const file = join(root, ".gitignore");
    await writeFile(file, "# concurrent change\n");
    await expect(writeIgnoreFile(root, ["expected", "append"], ["expected"])).rejects.toThrow(
      ".gitignore changed before saving",
    );
    expect(await readIgnoreFile(root)).toEqual(["# concurrent change"]);
    expect(
      await Array.fromAsync(
        new Bun.Glob(".gitten-ignore-*").scan({ cwd: root, onlyFiles: false, dot: true }),
      ),
    ).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
