import { expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SimpleGit, simpleGit } from "simple-git";
import { ResetManager } from "../../src/core/reset-manager";
import { discardLocal } from "../../src/git/discard-local";
import { createGitClient } from "../../src/git/git-client";
import { createUIMock } from "../mocks/ui.mock";

async function withCheckout(run: (git: SimpleGit, root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "gitten-discard-"));
  try {
    const git = simpleGit(root);
    await git.init();
    await git.addConfig("user.email", "fixture@example.invalid");
    await git.addConfig("user.name", "Fixture");
    await run(git, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function commitTarget(git: SimpleGit, root: string): Promise<string> {
  writeFileSync(join(root, "target"), "recorded content");
  await git.add("target");
  await git.commit("record target");
  return git.revparse(["HEAD"]);
}

const confirmDiscard = () =>
  createUIMock({ askSelect: async () => "discard", askConfirm: async () => true });

test("Discard refuses to overwrite ignored or nested repository paths that block a tracked file", async () => {
  await withCheckout(async (git, root) => {
    const head = await commitTarget(git, root);
    const exclude = join(root, ".git", "info", "exclude");
    writeFileSync(exclude, "target/\n");
    rmSync(join(root, "target"));
    mkdirSync(join(root, "target"));
    writeFileSync(join(root, "target", "keep"), "ignored fixture");
    const client = createGitClient(root);
    const ignored = confirmDiscard();
    await new ResetManager(client, ignored).run();
    expect(ignored.error).toHaveBeenCalledWith(expect.stringContaining("target/keep"));
    expect(ignored.success).not.toHaveBeenCalled();
    expect(readFileSync(join(root, "target", "keep"), "utf8")).toBe("ignored fixture");

    writeFileSync(exclude, "");
    await simpleGit(join(root, "target")).init();
    const nested = confirmDiscard();
    await new ResetManager(client, nested).run();
    expect(nested.error).toHaveBeenCalledWith(expect.stringContaining("untracked path 'target/'"));
    expect(nested.success).not.toHaveBeenCalled();
    expect(existsSync(join(root, "target", ".git", "config"))).toBe(true);
    expect(await git.revparse(["HEAD"])).toBe(head);
  });
});

test("Discard reports remaining paths after restoring tracked files and preserving nested repositories", async () => {
  await withCheckout(async (git, root) => {
    const head = await commitTarget(git, root);
    writeFileSync(join(root, "target"), "modified content");
    writeFileSync(join(root, "ordinary"), "remove this");
    const nested = join(root, "nested");
    mkdirSync(nested);
    await simpleGit(nested).init();
    writeFileSync(join(nested, "keep"), "nested fixture");
    const ui = confirmDiscard();
    await new ResetManager(createGitClient(root), ui).run();
    expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Some changes remain"));
    expect(ui.success).not.toHaveBeenCalled();
    expect(readFileSync(join(root, "target"), "utf8")).toBe("recorded content");
    expect(readFileSync(join(nested, "keep"), "utf8")).toBe("nested fixture");
    expect(existsSync(join(root, "ordinary"))).toBe(false);
    expect(await git.revparse(["HEAD"])).toBe(head);
  });
});

test("Discard clears an unborn checkout without creating a commit", async () => {
  await withCheckout(async (git, root) => {
    writeFileSync(join(root, "staged"), "pending fixture");
    await git.add("staged");
    await createGitClient(root).discardLocalChanges();
    expect((await git.status()).isClean()).toBe(true);
    expect(await git.raw(["for-each-ref"])).toBe("");
    expect(existsSync(join(root, "staged"))).toBe(false);
  });
});

test("Discard rejects an unverifiable HEAD or a changed branch and leaves reset uncalled", async () => {
  const initial = "# branch.oid (initial)\n# branch.head fixture\n";
  const other = "# branch.oid (initial)\n# branch.head another\n";
  for (const first of ["", "# branch.oid (initial)", "# branch.oid (initial)\nunexpected"]) {
    const git = { raw: mock(async () => first), reset: mock() };
    await expect(discardLocal(git as unknown as SimpleGit)).rejects.toThrow(
      "Could not verify HEAD",
    );
    expect(git.reset).not.toHaveBeenCalled();
  }
  const git = {
    raw: mock().mockResolvedValueOnce(initial).mockResolvedValueOnce(other),
    reset: mock(),
  };
  await expect(discardLocal(git as unknown as SimpleGit)).rejects.toThrow("Git state changed");
  expect(git.reset).not.toHaveBeenCalled();
});

test("Discard keeps a pending operation in place and reports a cleanup failure after reset", async () => {
  await withCheckout(async (_git, root) => {
    const initial = "# branch.oid (initial)\n# branch.head fixture\n";
    const gitDir = join(root, ".git");
    writeFileSync(join(gitDir, "MERGE_HEAD"), "fixture");
    const git = {
      raw: mock()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(initial)
        .mockResolvedValue(`${gitDir}\n`),
      reset: mock(async () => ""),
      clean: mock(() => Promise.reject("clean refused")),
    };
    await expect(discardLocal(git as unknown as SimpleGit)).rejects.toThrow("Git state changed");
    expect(git.reset).not.toHaveBeenCalled();
    rmSync(join(gitDir, "MERGE_HEAD"));
    git.raw.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial);
    await expect(discardLocal(git as unknown as SimpleGit)).rejects.toThrow(
      "Tracked changes were reset, but untracked cleanup failed.\nclean refused",
    );
    expect(git.reset).toHaveBeenCalledTimes(1);
  });
});
