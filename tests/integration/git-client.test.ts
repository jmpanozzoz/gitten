import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SimpleGit, simpleGit } from "simple-git";
import { AmendFlow } from "../../src/core/amend-flow";
import { BranchSwitcher } from "../../src/core/branch-switcher";
import { CherryPicker } from "../../src/core/cherry-picker";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { GitignoreManager } from "../../src/core/gitignore-manager";
import type { HistoryRange } from "../../src/core/ports/git-client.port";
import { PullFlow } from "../../src/core/pull-flow";
import { PushBranch } from "../../src/core/push-branch";
import { RepositoryStatusFlow } from "../../src/core/repository-status";
import { ResetManager } from "../../src/core/reset-manager";
import { RevertCommit } from "../../src/core/revert-commit";
import { StashManager } from "../../src/core/stash-manager";
import { SyncFlow } from "../../src/core/sync-flow";
import { TagWizard } from "../../src/core/tag-wizard";
import { createGitClient } from "../../src/git/git-client";
import { gitFailureDetail, strictGit } from "../../src/git/strict-git";
import { createUIMock } from "../mocks/ui.mock";
import { runBun } from "../support/run-bun";

let dir: string;
let client: ReturnType<typeof createGitClient>;

async function seedRepo(root = dir) {
  const git = simpleGit(root);
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test");
  writeFileSync(join(root, "README.md"), "hello");
  await git.add(".");
  await git.commit("chore: initial commit");
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gitten-integration-"));
  client = createGitClient(dir);
  await seedRepo();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ─── repo detection ───────────────────────────────────────────────────────────

test("checkIsRepo returns true for a git repo", async () => {
  expect(await client.checkIsRepo()).toBe(true);
});

test("Git failure diagnostics preserve the message of either a native error or a forwarded value", () => {
  expect(gitFailureDetail(new Error("native error"))).toBe("native error");
  expect(gitFailureDetail("forwarded stderr")).toBe("forwarded stderr");
});

test("the Git adapter rejects a silent nonzero exit status", async () => {
  const git = strictGit(dir);
  expect(await git.raw(["diff", "--quiet", "--"])).toBe("");
  writeFileSync(join(dir, "README.md"), "changed locally");
  await expect(Promise.resolve(git.raw(["diff", "--quiet", "--"]))).rejects.toThrow(
    "Git exited with status 1.",
  );
});

test("checkIsRepo returns false for a plain directory", async () => {
  const plain = mkdtempSync(join(tmpdir(), "gitten-plain-"));
  try {
    expect(await createGitClient(plain).checkIsRepo()).toBe(false);
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});

// ─── branches ─────────────────────────────────────────────────────────────────

test("getCurrentBranch returns the active branch name", async () => {
  const branch = await client.getCurrentBranch();
  expect(typeof branch).toBe("string");
  expect(branch.length).toBeGreaterThan(0);
});

test("getBranches lists the current branch", async () => {
  const { all, current } = await client.getBranches();
  expect(all).toContain(current);
});

test("checkoutNewBranch creates and switches to the new branch", async () => {
  await client.checkoutNewBranch("feat/test-branch");
  const { current } = await client.getBranches();
  expect(current).toBe("feat/test-branch");
});

test("branchExists returns true after branch is created", async () => {
  await client.checkoutNewBranch("feat/exists");
  expect(await client.branchExists("feat/exists")).toBe(true);
});

test("branchExists returns false for an unknown branch", async () => {
  expect(await client.branchExists("feat/ghost")).toBe(false);
});

test("deleteLocalBranch removes the branch", async () => {
  const { current } = await client.getBranches();
  await client.checkoutNewBranch("feat/to-delete");
  await client.checkoutBranch(current);
  await client.deleteLocalBranch("feat/to-delete");
  expect(await client.branchExists("feat/to-delete")).toBe(false);
});

// ─── status ───────────────────────────────────────────────────────────────────

test("getStatus reflects modified files", async () => {
  writeFileSync(join(dir, "README.md"), "modified content");
  const status = await client.getStatus();
  expect(status.isClean()).toBe(false);
  expect(status.files.length).toBeGreaterThan(0);
});

test("getStatus is clean after committing working changes", async () => {
  writeFileSync(join(dir, "new-file.txt"), "content");
  await simpleGit(dir).add("-A");
  await simpleGit(dir).commit("test: add new-file");
  const status = await client.getStatus();
  expect(status.isClean()).toBe(true);
});

test("untracked files do not count as staged changes", async () => {
  writeFileSync(join(dir, "untracked.txt"), "new");
  expect((await client.describeStatus()).staged).toEqual([]);
  await simpleGit(dir).add(["--", "untracked.txt"]);
  expect((await client.describeStatus()).staged.map(({ path }) => path)).toEqual(["untracked.txt"]);
});

test("getStatus.commitsAhead is 0 on a fresh local branch with no remote", async () => {
  const status = await client.getStatus();
  expect(status.commitsAhead).toBe(0);
});

test("repository metadata uses the worktree root and rejects malformed package versions", async () => {
  const nested = join(dir, "nested");
  mkdirSync(nested);
  const scoped = createGitClient(nested);
  const pkg = join(dir, "package.json");
  expect(await scoped.getPackageVersion()).toBeNull();
  writeFileSync(pkg, '{"version":"2.3.4"}');
  expect(await scoped.getPackageVersion()).toBe("2.3.4");
  for (const document of ['{"version":42}', "null", "{broken"]) {
    writeFileSync(pkg, document);
    expect(await scoped.getPackageVersion()).toBeNull();
  }
});

test("repository initialization describes unborn and detached worktrees without exposing HEAD as a branch", async () => {
  const root = join(dir, "fresh");
  mkdirSync(root);
  const repo = createGitClient(root);
  await repo.initRepo();
  expect(await repo.checkIsRepo()).toBe(true);
  expect(await repo.getRepoContext()).toMatchObject({ insertions: 0, deletions: 0 });
  const git = simpleGit(dir);
  const branch = await client.getCurrentBranch();
  await git.raw(["switch", "--detach", "HEAD"]);
  expect(await client.describeStatus()).toMatchObject({ branch: "Detached HEAD", upstream: null });
  expect(await client.getBranches()).toEqual({ all: [branch], current: "" });
});

test("branch activity resolves a literal ref when a tracked file has the same name", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "topic"), "tracked name");
  await git.add("topic");
  await git.commit("track name");
  const base = await client.getCurrentBranch();
  await client.checkoutNewBranch("topic");
  await git.raw(["commit", "--allow-empty", "-m", "unmerged commit"]);
  await client.checkoutBranch(base);
  expect(await client.getBranchLastActivity("topic")).not.toBe("");
  await client.deleteLocalBranchForce("topic");
  expect(await client.branchExists("topic")).toBe(false);
});

// ─── staging ──────────────────────────────────────────────────────────────────

test("the staged preview includes only staged files", async () => {
  writeFileSync(join(dir, "a.txt"), "a");
  writeFileSync(join(dir, "b.txt"), "b");
  await simpleGit(dir).add(["--", "a.txt"]);
  const diff = await client.getStagedDiff();
  expect(diff).toContain("+++ b/a.txt");
  expect(diff).not.toContain("b.txt");
});

test("Sync previews and commits only selected paths, preserving unrelated staging", async () => {
  const git = simpleGit(dir);
  await git.checkoutLocalBranch("feat/sync");
  writeFileSync(join(dir, "README.md"), "staged and excluded");
  await git.add("README.md");
  mkdirSync(join(dir, "nested"));
  writeFileSync(join(dir, "nested", "draft[1].txt"), "selected");
  writeFileSync(join(dir, "nested", "draft1.txt"), "unselected");
  const ui = createUIMock({
    askMultiSelect: async () => ["nested/draft[1].txt"],
    askText: async () => "add selected document",
  });

  await new SyncFlow(client, ui).run();

  expect((await git.raw(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).trim()).toBe(
    "nested/draft[1].txt",
  );
  expect((await git.status()).staged).toEqual(["README.md"]);
  expect(await git.raw(["show", ":README.md"])).toBe("staged and excluded");
  expect(ui.showDiff).toHaveBeenCalledWith(expect.stringContaining("+selected"));
});

test("Sync cancellation keeps HEAD and the index untouched", async () => {
  const git = simpleGit(dir);
  await git.checkoutLocalBranch("feat/cancel");
  const head = await git.revparse(["HEAD"]);
  const index = readFileSync(join(dir, ".git", "index"));
  writeFileSync(join(dir, "selected.txt"), "new data");
  const ui = createUIMock({
    askMultiSelect: async () => ["selected.txt"],
    askText: async () => {
      throw new GoBackSignal();
    },
  });
  await expect(new SyncFlow(client, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(await git.revparse(["HEAD"])).toBe(head);
  expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
});

test("Sync preserves both sides of an already-staged rename", async () => {
  const git = simpleGit(dir);
  await git.checkoutLocalBranch("feat/rename");
  await git.mv("README.md", "renamed.md");
  const ui = createUIMock({
    askMultiSelect: async () => ["renamed.md"],
    askText: async () => "rename document",
  });
  await new SyncFlow(client, ui).run();

  expect(await git.raw(["ls-tree", "--name-only", "HEAD"])).toBe("renamed.md\n");
  expect((await git.status()).isClean()).toBe(true);
});

test("prepares the first selected commit in a repository with no index", async () => {
  const root = mkdtempSync(join(tmpdir(), "gitten-unborn-"));
  try {
    const git = simpleGit(root);
    await git.init();
    await git.addConfig("user.name", "Test");
    await git.addConfig("user.email", "test@example.invalid");
    writeFileSync(join(root, "selected.txt"), "selected");
    writeFileSync(join(root, "unselected.txt"), "unselected");
    const unborn = createGitClient(root);

    const preview = await unborn.previewSelectedCommit(["selected.txt"]);
    expect(preview.head).toBeNull();
    await unborn.commitSelection(preview, "initial selected file");
    expect(await git.raw(["ls-tree", "--name-only", "HEAD"])).toBe("selected.txt\n");
    expect((await git.status()).not_added).toEqual(["unselected.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stale Sync preview and a rejected pre-commit hook leave HEAD and index unchanged", async () => {
  const git = simpleGit(dir);
  const head = await git.revparse(["HEAD"]);
  const indexPath = join(dir, ".git", "index");
  const originalIndex = readFileSync(indexPath);
  const selected = join(dir, "selected.txt");
  writeFileSync(selected, "first version");
  const stale = await client.previewSelectedCommit(["selected.txt"]);
  writeFileSync(selected, "changed after the preview");
  await expect(client.commitSelection(stale, "stale")).rejects.toThrow("changed after the preview");
  expect(readFileSync(indexPath)).toEqual(originalIndex);

  const current = await client.previewSelectedCommit(["selected.txt"]);
  writeFileSync(join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  await expect(client.commitSelection(current, "rejected")).rejects.toThrow();
  expect(await git.revparse(["HEAD"])).toBe(head);
  expect(readFileSync(indexPath)).toEqual(originalIndex);
  expect(await client.hasIndexLock()).toBe(false);
});

// ─── diff ─────────────────────────────────────────────────────────────────────

test("the staged diff shows inserted content", async () => {
  writeFileSync(join(dir, "README.md"), "line1\nline2\nline3");
  await simpleGit(dir).add("-A");
  expect(await client.getStagedDiff()).toContain("+line3");
});

// ─── commit log ───────────────────────────────────────────────────────────────

test("getLog returns commit history for the current branch", async () => {
  const branch = await client.getCurrentBranch();
  const log = await client.getLog(branch, 10);
  expect(log.length).toBeGreaterThan(0);
  expect(log[0]!.hash.length).toBe(40);
  expect(typeof log[0]!.message).toBe("string");
});

test("getLastCommit returns the most recent commit", async () => {
  const commit = await client.getLastCommit();
  expect(commit.hash.length).toBe(40);
  expect(commit.message).toBe("chore: initial commit");
});

// ─── reset ────────────────────────────────────────────────────────────────────

test("discardLocalChanges removes uncommitted modifications and untracked files", async () => {
  writeFileSync(join(dir, "README.md"), "staged change");
  await simpleGit(dir).add(["--", "README.md"]);
  writeFileSync(join(dir, "README.md"), "unstaged change");
  writeFileSync(join(dir, "untracked.txt"), "new file");

  await client.discardLocalChanges();

  const status = await client.getStatus();
  expect(status.isClean()).toBe(true);
  expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("hello");
});

async function linkResetUpstream(git: SimpleGit, remote: string) {
  await simpleGit(remote).init({ "--bare": null });
  await git.addRemote("team", remote);
  await git.push(["--set-upstream", "team", "HEAD:refs/heads/release"]);
}

test("Reset applies the commit previewed from the configured remote and branch", async () => {
  const remotePath = mkdtempSync(join(tmpdir(), "gitten-reset-remote-"));
  try {
    const git = simpleGit(dir);
    const initial = (await git.raw(["rev-parse", "HEAD"])).trim();
    await linkResetUpstream(git, remotePath);
    writeFileSync(join(dir, "README.md"), "a local commit");
    await git.commit("local commit", { "--all": null });
    const previous = await git.revparse(["HEAD"]);
    writeFileSync(join(dir, "untracked.txt"), "keep private draft");

    const ui = createUIMock({ askSelect: async () => "remote", askConfirm: async () => true });
    await new ResetManager(client, ui).run();

    expect((await git.raw(["rev-parse", "HEAD"])).trim()).toBe(initial);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("hello");
    expect(readFileSync(join(dir, "untracked.txt"), "utf8")).toBe("keep private draft");
    const backup = `refs/gitten/recovery/${previous}`;
    expect(await git.revparse([backup])).toBe(previous);
    expect(await git.raw(["show", `${backup}:README.md`])).toBe("a local commit");
    expect(ui.success).toHaveBeenCalledWith("Branch reset to team/release.");
    expect(ui.info).toHaveBeenCalledWith(`Previous tip saved at ${backup}.`);
  } finally {
    rmSync(remotePath, { recursive: true, force: true });
  }
});

test("Reset preserves the recovery ref when a locked index prevents mutation", async () => {
  const remote = mkdtempSync(join(tmpdir(), "gitten-reset-locked-"));
  try {
    const git = simpleGit(dir);
    await linkResetUpstream(git, remote);
    writeFileSync(join(dir, "README.md"), "saved local content");
    await git.commit("local commit", ["-a"]);
    const previous = await git.revparse(["HEAD"]);
    const lock = join(dir, ".git", "index.lock");
    const ui = createUIMock({
      askSelect: async () => "remote",
      askConfirm: async () => {
        writeFileSync(lock, "owned by another Git command");
        return true;
      },
    });
    await new ResetManager(client, ui).run();
    expect(await git.revparse(["HEAD"])).toBe(previous);
    expect(await git.revparse([`refs/gitten/recovery/${previous}`])).toBe(previous);
    expect(readFileSync(lock, "utf8")).toBe("owned by another Git command");
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("saved local content");
    expect(ui.error).toHaveBeenCalledWith(
      expect.stringContaining(`Previous tip saved at refs/gitten/recovery/${previous}`),
    );
    expect(ui.success).not.toHaveBeenCalled();
  } finally {
    rmSync(remote, { recursive: true, force: true });
  }
});

test("Reset leaves a branch moved during recovery creation untouched and reports its saved tip", async () => {
  const remote = mkdtempSync(join(tmpdir(), "gitten-reset-branch-race-"));
  try {
    const git = simpleGit(dir);
    await linkResetUpstream(git, remote);
    writeFileSync(join(dir, "README.md"), "local work");
    await git.commit("local commit", ["-a"]);
    const target = (await client.getRemoteResetTarget())!;
    const previousTree = await git.revparse(["HEAD^{tree}"]);
    const later = (
      await git.raw(["commit-tree", previousTree, "-p", target.head, "-m", "concurrent commit"])
    ).trim();
    const recovery = `refs/gitten/recovery/${target.head}`;
    const hook = join(dir, ".git", "hooks", "reference-transaction");
    writeFileSync(
      hook,
      [
        "#!/bin/sh",
        'test "$1" = committed || exit 0',
        "while read -r old new ref; do",
        `  if [ "$ref" = '${recovery}' ]; then`,
        `    git -c core.hooksPath=/dev/null update-ref "$(git symbolic-ref HEAD)" '${later}' '${target.head}' || exit 1`,
        "  fi",
        "done",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    await expect(client.resetToRemote(target)).rejects.toThrow(
      "Git state changed while saving the recovery ref",
    );
    expect(await git.revparse(["HEAD"])).toBe(later);
    expect(await git.revparse([recovery])).toBe(target.head);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("local work");
    await expect(client.resetToRemote(target)).rejects.toThrow(
      "Git state changed after the preview",
    );
    expect(await git.revparse(["HEAD"])).toBe(later);
  } finally {
    rmSync(remote, { recursive: true, force: true });
  }
});

test("Reset refuses to replace ignored paths or an untracked file or directory blocking its target", async () => {
  const git = simpleGit(dir);
  const remote = mkdtempSync(join(tmpdir(), "gitten-reset-untracked-"));
  const protectedPaths = [
    ["exact.txt", "exact.txt"],
    ["nested/from-upstream.txt", "nested"],
    ["file-in-upstream", "file-in-upstream/private.txt"],
  ] as const;
  try {
    for (const [tracked] of protectedPaths) {
      const parent = tracked.split("/").slice(0, -1).join("/");
      if (parent) mkdirSync(join(dir, parent), { recursive: true });
      writeFileSync(join(dir, tracked), "upstream");
    }
    await git.add(".");
    await git.commit("commit tracked destination paths");
    await linkResetUpstream(git, remote);
    await git.rm(protectedPaths.map(([tracked]) => tracked));
    await git.commit("remove paths locally");
    const current = await git.revparse(["HEAD"]);
    writeFileSync(join(dir, ".git", "info", "exclude"), "exact.txt\n");
    await git.raw(["config", "--local", "--unset", "core.ignorecase"]).catch(() => {});

    for (const [, untracked] of protectedPaths) {
      const parent = untracked.split("/").slice(0, -1).join("/");
      if (parent) mkdirSync(join(dir, parent), { recursive: true });
      else rmSync(join(dir, untracked), { recursive: true, force: true });
      const privateFile = join(dir, untracked);
      writeFileSync(privateFile, "untracked work");
      const ui = createUIMock({ askSelect: async () => "remote", askConfirm: async () => true });
      await new ResetManager(client, ui).run();
      expect(ui.error).toHaveBeenCalledWith(
        expect.stringContaining(`untracked path '${untracked}'`),
      );
      expect(await git.revparse(["HEAD"])).toBe(current);
      expect(readFileSync(privateFile, "utf8")).toBe("untracked work");
      rmSync(privateFile);
    }
    expect(await git.raw(["for-each-ref", "refs/gitten/recovery"])).toBe("");
  } finally {
    rmSync(remote, { recursive: true, force: true });
  }
});

// ─── repo context ─────────────────────────────────────────────────────────────

test("getRepoContext returns branch and zero counts on a clean repo", async () => {
  const ctx = await client.getRepoContext();
  expect(typeof ctx.branch).toBe("string");
  expect(ctx.modifiedCount).toBe(0);
  expect(ctx.insertions).toBe(0);
  expect(ctx.deletions).toBe(0);
});

test("getRepoContext reflects insertions and file count when files are modified", async () => {
  writeFileSync(join(dir, "README.md"), "line1\nline2\nline3");
  const ctx = await client.getRepoContext();
  expect(ctx.modifiedCount).toBe(1);
  expect(ctx.insertions).toBeGreaterThan(0);
});

// ─── stash ────────────────────────────────────────────────────────────────────

test("stashWithMessage saves changes and cleans the working tree", async () => {
  writeFileSync(join(dir, "README.md"), "stashed change");
  await client.stashWithMessage("WIP: my work");

  expect((await client.getStatus()).isClean()).toBe(true);
  const stashes = await client.getStashes();
  expect(stashes.length).toBe(1);
  expect(stashes[0]!.message).toContain("my work");
});

test("stashPop applies stash and removes it from the list", async () => {
  writeFileSync(join(dir, "README.md"), "stashed");
  await client.stashWithMessage("pop me");
  await client.stashPop((await client.getStashes())[0]!);

  expect((await client.getStatus()).isClean()).toBe(false);
  expect((await client.getStashes()).length).toBe(0);
});

test("stashDrop removes stash without applying it", async () => {
  writeFileSync(join(dir, "README.md"), "stashed");
  await client.stashWithMessage("drop me");
  await client.stashDrop((await client.getStashes())[0]!);

  expect((await client.getStashes()).length).toBe(0);
  expect((await client.getStatus()).isClean()).toBe(true);
});

// ─── gitignore ────────────────────────────────────────────────────────────────

test("writeGitignore and readGitignore round-trip correctly", async () => {
  const patterns = ["node_modules/", ".env", "dist/"];
  await client.writeGitignore(patterns);
  const read = await client.readGitignore();
  for (const p of patterns) {
    expect(read).toContain(p);
  }
});

test("Gitignore untracks only a new literal match and preserves previous ignores and working files", async () => {
  const git = simpleGit(dir);
  const sub = join(dir, "artifacts");
  mkdirSync(sub);
  for (const name of ["note[1].tmp", "note1.tmp", "prior.tmp"]) {
    writeFileSync(join(sub, name), name);
  }
  await git.add(".");
  await git.commit("track artifacts");
  writeFileSync(join(dir, ".gitignore"), "/artifacts/prior.tmp\n");
  const ui = createUIMock({
    askSelect: async () => "add",
    askText: async () => "/artifacts/note\\[1\\].tmp",
    askConfirm: async () => true,
  });
  await new GitignoreManager(createGitClient(sub), ui).run();
  expect(await client.getTrackedFiles()).toEqual([
    "README.md",
    "artifacts/note1.tmp",
    "artifacts/prior.tmp",
  ]);
  expect(readFileSync(join(sub, "note[1].tmp"), "utf8")).toBe("note[1].tmp");
  expect(ui.info).toHaveBeenCalledWith(
    'Paths to remove from the index:\n  "artifacts/note[1].tmp"',
  );
  expect((await git.status()).deleted).toEqual(["artifacts/note[1].tmp"]);
});

test("Gitignore keeps the dotenv template exception when completing a partial template", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, ".gitignore"), "# credentials\n.env\n!.env.example\n");
  writeFileSync(join(dir, ".env.example"), "sample");
  writeFileSync(join(dir, ".env.local"), "local");
  const ui = createUIMock({
    askSelect: async (prompt) => (prompt === "Choose a template:" ? "dotenv" : "template"),
  });
  await new GitignoreManager(client, ui).run();
  expect((await git.status()).not_added).toContain(".env.example");
  expect((await git.status()).not_added).not.toContain(".env.local");
  expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(
    "# credentials\n.env\n.env.*\n!.env.example\n",
  );
});

test("Gitignore leaves a newly staged edit alone when it changed during confirmation", async () => {
  const git = simpleGit(dir);
  const ui = createUIMock({
    askSelect: async () => "add",
    askText: async () => "/README.md",
    askConfirm: async () => {
      writeFileSync(join(dir, "README.md"), "new staged content");
      await git.add("README.md");
      return true;
    },
  });
  await new GitignoreManager(client, ui).run();
  expect(await git.raw(["show", ":README.md"])).toBe("new staged content");
  expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe("/README.md\n");
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Git index changed"));
});

test("Gitignore reports partial success and keeps staged files when Git cannot lock the index", async () => {
  const git = simpleGit(dir);
  const ui = createUIMock({
    askSelect: async () => "add",
    askText: async () => "/README.md",
    askConfirm: async () => {
      writeFileSync(join(dir, ".git", "index.lock"), "another command");
      return true;
    },
  });
  await new GitignoreManager(client, ui).run();
  expect(await git.raw(["show", ":README.md"])).toBe("hello");
  expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe("/README.md\n");
  expect(ui.error).toHaveBeenCalledWith(
    expect.stringContaining(
      "The pattern was saved, but removing files from the index did not complete",
    ),
  );
});

// ─── index lock ───────────────────────────────────────────────────────────────

test("hasIndexLock returns false when no lock file present", async () => {
  expect(await client.hasIndexLock()).toBe(false);
});

test("hasIndexLock returns true when lock file exists", async () => {
  writeFileSync(join(dir, ".git", "index.lock"), "");
  expect(await client.hasIndexLock()).toBe(true);
});

// ─── amend ────────────────────────────────────────────────────────────────────

test("amendCommit changes the last commit message", async () => {
  await client.amendCommit("fix: amended message");
  const last = await client.getLastCommit();
  expect(last.message).toBe("fix: amended message");
});

test("message-only amend preserves the commit tree, staged files, and message body", async () => {
  const git = simpleGit(dir);
  const before = (await git.raw(["rev-parse", "HEAD^{tree}"])).trim();
  writeFileSync(join(dir, "draft.txt"), "draft");
  await simpleGit(dir).add(["--", "draft.txt"]);
  const body = "Release notes\n\nReviewed-by: Example";

  await client.amendCommit(`fix: amended subject\n\n${body}`, true);

  expect((await client.getLastCommit()).body).toContain(body);
  expect((await git.raw(["rev-parse", "HEAD^{tree}"])).trim()).toBe(before);
  expect((await git.status()).staged).toEqual(["draft.txt"]);
});

test("message-only amend restores HEAD and the exact index when a hook changes the reviewed tree or message", async () => {
  const git = simpleGit(dir);
  const original = await git.revparse(["HEAD"]);
  const index = join(dir, ".git", "index");
  writeFileSync(join(dir, "staged.txt"), "staged content");
  await simpleGit(dir).add(["--", "staged.txt"]);
  const bytes = readFileSync(index);
  writeFileSync(join(dir, "outside.txt"), "unreviewed local content");
  const preCommit = join(dir, ".git", "hooks", "pre-commit");
  writeFileSync(preCommit, "#!/bin/sh\ngit add -- outside.txt\n", { mode: 0o755 });
  await expect(client.amendCommit("reviewed subject", true)).rejects.toThrow(
    "Restored the previous commit",
  );
  expect(await git.revparse(["HEAD"])).toBe(original);
  expect(readFileSync(index)).toEqual(bytes);
  rmSync(preCommit);
  const commitMessage = join(dir, ".git", "hooks", "commit-msg");
  writeFileSync(commitMessage, '#!/bin/sh\nprintf "\nHook trailer: changed\n" >> "$1"\n', {
    mode: 0o755,
  });
  await expect(client.amendCommit("reviewed subject\n", true)).rejects.toThrow(
    "Restored the previous commit",
  );
  expect(await git.revparse(["HEAD"])).toBe(original);
  expect(readFileSync(index)).toEqual(bytes);
  expect(
    readdirSync(join(dir, ".git")).filter((path) => /^gitten-amend-|^index\.lock$/.test(path)),
  ).toEqual([]);
});

test("message-only amend leaves a detached HEAD and pending changes intact when a hook refuses it", async () => {
  const git = simpleGit(dir);
  const original = await git.revparse(["HEAD"]);
  await git.raw(["switch", "--detach", original]);
  writeFileSync(join(dir, "staged.txt"), "keep");
  await simpleGit(dir).add(["--", "staged.txt"]);
  const index = readFileSync(join(dir, ".git", "index"));
  const hook = join(dir, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho 'amend declined by fixture' >&2\nexit 1\n", { mode: 0o755 });
  await expect(client.amendCommit("refused", true)).rejects.toThrow("amend declined by fixture");
  expect(await git.revparse(["HEAD"])).toBe(original);
  expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
  rmSync(hook);
  await client.amendCommit("approved while detached\n", true);
  expect((await client.getLastCommit()).message).toBe("approved while detached");
  expect((await git.status()).detached).toBe(true);
  expect((await git.status()).staged).toEqual(["staged.txt"]);
});

test("message-only amend reports a partial result if a hook blocks recovery of the previous ref", async () => {
  const git = simpleGit(dir);
  const ref = await git.raw(["symbolic-ref", "HEAD"]);
  const original = await git.revparse(["HEAD"]);
  const index = readFileSync(join(dir, ".git", "index"));
  const hook = join(dir, ".git", "hooks", "commit-msg");
  writeFileSync(hook, '#!/bin/sh\nprintf "unreviewed\n" > "$1"\n', { mode: 0o755 });
  const recovery = join(dir, ".git", "hooks", "post-commit");
  writeFileSync(recovery, `#!/bin/sh\ntouch '.git/${ref.trim()}.lock'\n`, { mode: 0o755 });
  await expect(client.amendCommit("reviewed", true)).rejects.toThrow(
    `Previous commit: ${original}`,
  );
  expect(await git.revparse(["HEAD"])).not.toBe(original);
  expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
  expect(await git.raw(["cat-file", "-t", original])).toBe("commit\n");
});

test("message-only amend leaves a branch switch performed by a hook untouched", async () => {
  const git = simpleGit(dir);
  const index = readFileSync(join(dir, ".git", "index"));
  const hooks = join(dir, ".git", "hooks");
  const preAmend = join(hooks, "post-index-change");
  await git.branch(["from-index-hook"]);
  writeFileSync(preAmend, "#!/bin/sh\ngit symbolic-ref HEAD refs/heads/from-index-hook\n", {
    mode: 0o755,
  });
  await expect(client.amendCommit("before", true)).rejects.toThrow("HEAD changed before the amend");
  expect(await git.revparse(["--abbrev-ref", "HEAD"])).toBe("from-index-hook");
  rmSync(preAmend);
  const postAmend = join(hooks, "post-commit");
  writeFileSync(
    postAmend,
    '#!/bin/sh\ngit update-ref refs/heads/from-commit-hook "$(git rev-parse HEAD)" && git symbolic-ref HEAD refs/heads/from-commit-hook\n',
    { mode: 0o755 },
  );
  await expect(client.amendCommit("after", true)).rejects.toThrow("HEAD changed during the amend");
  expect(await git.revparse(["--abbrev-ref", "HEAD"])).toBe("from-commit-hook");
  expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
  writeFileSync(postAmend, "#!/bin/sh\ngit update-ref HEAD 'HEAD@{1}'\n", { mode: 0o755 });
  await expect(client.amendCommit("reset by hook", true)).rejects.toThrow(
    "HEAD changed during the amend",
  );
  expect((await client.getLastCommit()).message).toBe("after");
});

test("message-only amend leaves an operation started during temporary index setup pending", async () => {
  const git = simpleGit(dir);
  const before = await git.revparse(["HEAD"]);
  const index = readFileSync(join(dir, ".git", "index"));
  const hook = join(dir, ".git", "hooks", "post-index-change");
  writeFileSync(hook, "#!/bin/sh\nprintf 'fixture\n' > .git/BISECT_START\n", { mode: 0o755 });
  await expect(client.amendCommit("reviewed", true)).rejects.toThrow("Finish the pending bisect");
  expect(await client.getInProgressOperation()).toBe("bisect");
  expect(await git.revparse(["HEAD"])).toBe(before);
  expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
});

test.each(["merge", "rebase"] as const)("Pull finishes a real %s conflict", async (strategy) => {
  const other = mkdtempSync(join(tmpdir(), "gitten-pull-test-"));
  try {
    const local = simpleGit(dir);
    const remote = simpleGit(other);
    await remote.init({ "--bare": null });
    await local.addRemote("origin", other);
    const branch = await client.getCurrentBranch();
    await local.push(["-u", "origin", branch]);

    const clone = join(other, "clone");
    await local.clone(other, clone, ["--branch", branch]);
    const peer = simpleGit(clone);
    await peer.addConfig("user.email", "test@test.com");
    await peer.addConfig("user.name", "Test");
    writeFileSync(join(clone, "README.md"), "remote change\n");
    await peer.commit("remote change", { "--all": null });
    await peer.push();

    writeFileSync(join(dir, "README.md"), "local change\n");
    await local.commit("local change", { "--all": null });
    await local.addConfig("pull.rebase", strategy === "merge" ? "true" : "false");
    const ui = createUIMock({ askSelect: async () => strategy });

    await new PullFlow(client, ui, {
      waitForResolution: async () => {
        expect(await client.getInProgressOperation()).toBe(strategy);
        writeFileSync(join(dir, "README.md"), "resolved change\n");
        writeFileSync(join(dir, "unrelated.txt"), "leave this untracked");
        await simpleGit(dir).add(["--", "README.md"]);
        return true;
      },
    }).run();

    expect(await client.getInProgressOperation()).toBeNull();
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("resolved change\n");
    expect((await local.status()).not_added).toEqual(["unrelated.txt"]);
    const parents = (await local.raw(["log", "-1", "--format=%P"])).trim().split(" ");
    expect(parents).toHaveLength(strategy === "merge" ? 2 : 1);
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

test("Pull reports a new empty commit and only reports up to date on the next run", async () => {
  const remoteDir = mkdtempSync(join(tmpdir(), "gitten-empty-pull-"));
  try {
    const local = simpleGit(dir);
    const branch = await client.getCurrentBranch();
    const remote = simpleGit(remoteDir);
    await remote.init({ "--bare": null });
    await local.addRemote("origin", remoteDir);
    await local.push(["-u", "origin", branch]);
    const writer = join(remoteDir, "writer");
    await local.clone(remoteDir, writer, ["--branch", branch]);
    const peer = simpleGit(writer);
    await peer.addConfig("user.email", "test@test.com");
    await peer.addConfig("user.name", "Test");
    writeFileSync(join(writer, "file café.txt"), "remote content\n");
    await peer.add(".");
    await peer.commit("publish a tracked file");
    await peer.push();
    const ui = createUIMock({ askSelect: async () => "rebase" });
    await new PullFlow(client, ui).run();
    expect(ui.success).toHaveBeenCalledWith("Pulled successfully. 1 file(s) changed.");
    expect(readFileSync(join(dir, "file café.txt"), "utf8")).toBe("remote content\n");

    await peer.raw(["commit", "--allow-empty", "-m", "advance without changing the tree"]);
    await peer.push();
    const newTip = await peer.revparse(["HEAD"]);
    const previousTree = await local.revparse(["HEAD^{tree}"]);

    await new PullFlow(client, ui).run();
    expect(await local.revparse(["HEAD"])).toBe(newTip);
    expect(await local.revparse(["HEAD^{tree}"])).toBe(previousTree);
    expect(ui.success).toHaveBeenCalledWith(
      "Pulled successfully. HEAD moved without tracked file changes.",
    );
    expect(ui.info).not.toHaveBeenCalledWith("Already up to date.");
    await new PullFlow(client, ui).run();
    expect(ui.info).toHaveBeenCalledWith("Already up to date.");
  } finally {
    rmSync(remoteDir, { recursive: true, force: true });
  }
});

test("merge and rebase recovery restore the original checkout and preserve unrelated files", async () => {
  const git = strictGit(dir);
  const branch = await client.getCurrentBranch();
  await git.checkoutLocalBranch("incoming");
  writeFileSync(join(dir, "README.md"), "incoming line\n");
  await git.commit("incoming change", ["-a"]);
  await git.checkout(branch);
  writeFileSync(join(dir, "README.md"), "local line\n");
  await git.commit("local change", ["-a"]);
  writeFileSync(join(dir, "keep.txt"), "untracked work");
  const range = await rewriteRange(client, 1);

  for (const operation of ["merge", "rebase"] as const) {
    await expect(Promise.resolve(git.raw([operation, "incoming"]))).rejects.toThrow();
    expect(await client.getInProgressOperation()).toBe(operation);
    expect(await client.getConflictIdentity(operation)).toContain(operation);
    expect(await client.getConflictedFiles()).toEqual(["README.md"]);
    await expect(client.undoRange(range, "soft")).rejects.toThrow(`pending ${operation}`);
    await expect(client.squashRange(range, "blocked")).rejects.toThrow(`pending ${operation}`);
    await (operation === "merge" ? client.mergeAbort() : client.rebaseAbort());
    expect(await client.getConflictIdentity(operation)).toBeNull();
    expect(await client.getInProgressOperation()).toBeNull();
    expect(await client.getCurrentBranch()).toBe(branch);
    expect(await git.revparse(["HEAD"])).toBe(range.head);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("local line\n");
    expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("untracked work");
    expect(await client.hasIndexLock()).toBe(false);
  }
});

test("merge and rebase abort refuse to change a checkout without a pending operation", async () => {
  const git = simpleGit(dir);
  const head = await git.revparse(["HEAD"]);
  const indexPath = join(dir, ".git", "index");
  const index = readFileSync(indexPath);
  await expect(client.mergeAbort()).rejects.toThrow();
  await expect(client.rebaseAbort()).rejects.toThrow();
  expect(await client.getInProgressOperation()).toBeNull();
  expect(await git.revparse(["HEAD"])).toBe(head);
  expect(readFileSync(indexPath)).toEqual(index);
});

test("staged conflict-marker detection distinguishes markers from whitespace", async () => {
  const git = simpleGit(dir);
  const path = join(dir, "README.md");
  writeFileSync(path, "resolution with trailing whitespace \n");
  await git.add("README.md");
  expect(await client.hasStagedConflictMarkers()).toBe(false);

  writeFileSync(path, "<<<<<<< HEAD\nlocal\n=======\nincoming\n>>>>>>> incoming\n");
  await git.add("README.md");
  expect(await client.hasStagedConflictMarkers()).toBe(true);
});

test("staged conflict-marker detection reports an unreadable index", async () => {
  writeFileSync(join(dir, ".git", "index"), "damaged index");
  await expect(client.hasStagedConflictMarkers()).rejects.toThrow(/index/i);
});

test("recovery refuses an unreadable operation marker and preserves the index", async () => {
  const marker = join(dir, ".git", "MERGE_HEAD");
  mkdirSync(marker);
  const indexPath = join(dir, ".git", "index");
  const index = readFileSync(indexPath);
  expect(await client.getInProgressOperation()).toBe("merge");
  await expect(client.getConflictIdentity("merge")).rejects.toMatchObject({ code: "EISDIR" });
  expect(readFileSync(indexPath)).toEqual(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("amendNoEdit adds staged files to last commit without changing the message", async () => {
  const git = simpleGit(dir);
  const message = "chore: initial commit\n\n# literal notes\n\nReviewed-by: Example";
  await git.raw(["commit", "--amend", "--cleanup=verbatim", "-m", message]);
  await git.raw(["config", "--local", "commit.cleanup", "strip"]);
  writeFileSync(join(dir, "extra.txt"), "extra content");
  await simpleGit(dir).add("-A");
  await client.amendNoEdit();

  const branch = await client.getCurrentBranch();
  const log = await client.getLog(branch, 1);
  expect(log[0]!.message).toBe("chore: initial commit");
  expect(await git.raw(["show", "-s", "--format=%B", "HEAD"])).toBe(`${message}\n\n`);
  expect((await client.getStatus()).isClean()).toBe(true);
});

// ─── tags ─────────────────────────────────────────────────────────────────────

test("getLastTag returns null when no tags exist", async () => {
  expect(await client.getLastTag()).toBeNull();
});

test("createAnnotatedTag creates a tag verifiable in git", async () => {
  await client.createAnnotatedTag("v1.0.0", "Release v1.0.0");
  const git = simpleGit(dir);
  const tags = await git.tags();
  expect(tags.all).toContain("v1.0.0");
});

test("getLastTag returns the most recent tag after creation", async () => {
  await client.createAnnotatedTag("v1.0.0", "Release v1.0.0");
  expect(await client.getLastTag()).toBe("v1.0.0");
});

test("getLogSince returns only commits after the given tag", async () => {
  await client.createAnnotatedTag("v1.0.0", "initial release");

  writeFileSync(join(dir, "new.txt"), "new content");
  await simpleGit(dir).add("-A");
  await simpleGit(dir).commit("feat: add new file");

  const commits = await client.getLogSince("v1.0.0");
  expect(commits.length).toBe(1);
  expect(commits[0]!.message).toBe("feat: add new file");
});

test("getLogSince returns empty array when no commits since tag", async () => {
  await client.createAnnotatedTag("v1.0.0", "initial");
  const commits = await client.getLogSince("v1.0.0");
  expect(commits.length).toBe(0);
});

// ─── bisect ───────────────────────────────────────────────────────────────────

test("bisectStart, bisectGood, and bisectReset complete without error", async () => {
  writeFileSync(join(dir, "b.txt"), "b");
  await simpleGit(dir).add("-A");
  await simpleGit(dir).commit("fix: second commit");

  const branch = await client.getCurrentBranch();
  const log = await client.getLog(branch, 10);
  const goodHash = log[log.length - 1]!.hash;

  await client.bisectStart();
  await client.bisectBad(undefined);
  const result = await client.bisectGood(goodHash);
  expect(result).toHaveProperty("done");
  await client.bisectReset();

  const current = await client.getCurrentBranch();
  expect(current).toBe(branch);
});

test("bisectReset restores HEAD to original branch", async () => {
  const originalBranch = await client.getCurrentBranch();

  writeFileSync(join(dir, "b.txt"), "b");
  await simpleGit(dir).add("-A");
  await simpleGit(dir).commit("second");
  writeFileSync(join(dir, "c.txt"), "c");
  await simpleGit(dir).add("-A");
  await simpleGit(dir).commit("third");

  const log = await client.getLog(originalBranch, 10);
  const goodHash = log[log.length - 1]!.hash;

  await client.bisectStart();
  await client.bisectBad(undefined);
  await client.bisectGood(goodHash);
  await client.bisectReset();

  expect(await client.getCurrentBranch()).toBe(originalBranch);
});

test("Bisect can skip a candidate and continue on a different commit", async () => {
  const git = simpleGit(dir);
  const original = await client.getCurrentBranch();
  const good = await git.revparse(["HEAD"]);
  for (const subject of ["one", "two", "three", "four"]) {
    await git.raw(["commit", "--allow-empty", "-m", subject]);
  }
  const bad = await git.revparse(["HEAD"]);
  await client.bisectStart();
  await client.bisectBad(bad);
  expect(await client.bisectGood(good)).toEqual({ done: false });
  const skipped = await git.revparse(["HEAD"]);
  expect(await client.bisectSkip()).toEqual({ done: false });
  expect(await git.revparse(["HEAD"])).not.toBe(skipped);
  expect(await client.getInProgressOperation()).toBe("bisect");
  await client.bisectReset();
  expect(await client.getCurrentBranch()).toBe(original);
  expect(await git.revparse(["HEAD"])).toBe(bad);
});

test("Bisect reports the full first bad commit in a SHA-256 repository", async () => {
  const workspace = join(dir, "sha256");
  mkdirSync(workspace);
  const git = simpleGit(workspace);
  await git.raw(["init", "--object-format=sha256", "--initial-branch=bisect-main"]);
  await git.addConfig("user.name", "Test");
  await git.addConfig("user.email", "test@test.com");
  await git.raw(["commit", "--allow-empty", "-m", "known good"]);
  const base = await git.revparse(["HEAD"]);
  await git.raw(["commit", "--allow-empty", "-m", "still good"]);
  const middle = await git.revparse(["HEAD"]);
  await git.raw(["commit", "--allow-empty", "-m", "broken"]);
  const tip = await git.revparse(["HEAD"]);

  const sha256 = createGitClient(workspace);
  await sha256.bisectStart();
  await sha256.bisectBad(tip);
  expect(await sha256.bisectGood(base)).toEqual({ done: false });
  expect(await git.revparse(["HEAD"])).toBe(middle);
  expect(await sha256.bisectGood()).toEqual({ done: true, badCommit: { hash: tip, message: "" } });
  expect(tip).toHaveLength(64);
  await sha256.bisectReset();
  expect(await git.revparse(["HEAD"])).toBe(tip);
  expect(await sha256.getCurrentBranch()).toBe("bisect-main");
});

// ─── worktrees ────────────────────────────────────────────────────────────────

test("getWorktrees returns at least the main worktree", async () => {
  const worktrees = await client.getWorktrees();
  expect(worktrees.length).toBeGreaterThanOrEqual(1);
  expect(worktrees[0]!.isMain).toBe(true);
  expect(worktrees[0]!.path).toBe(realpathSync(dir));
});

test("addWorktree creates a new worktree directory at the given path", async () => {
  const wtDir = realpathSync(mkdtempSync(join(tmpdir(), "gitten-wt-")));
  try {
    const branch = await client.getCurrentBranch();
    await client.checkoutNewBranch("feat/for-worktree");
    await client.checkoutBranch(branch);

    await client.addWorktree(wtDir, "feat/for-worktree", false);

    const worktrees = await client.getWorktrees();
    expect(worktrees.some((wt) => wt.path === wtDir)).toBe(true);

    await client.removeWorktree(wtDir);
  } finally {
    rmSync(wtDir, { recursive: true, force: true });
  }
});

test("removeWorktree removes the worktree from the list", async () => {
  const wtDir = realpathSync(mkdtempSync(join(tmpdir(), "gitten-wt-remove-")));
  try {
    await client.checkoutNewBranch("feat/wt-remove");
    const branch = await client.getCurrentBranch();
    await client.checkoutBranch(
      (await client.getBranches()).all.find((b) => b !== branch) ?? branch,
    );

    await client.addWorktree(wtDir, "feat/wt-remove", false).catch(async () => {
      await client.checkoutBranch(branch);
    });
    await client.removeWorktree(wtDir);

    const worktrees = await client.getWorktrees();
    expect(worktrees.every((wt) => wt.path !== wtDir)).toBe(true);
  } finally {
    rmSync(wtDir, { recursive: true, force: true });
  }
});

test("repository status distinguishes staging areas and unstages a literal path from a subdirectory", async () => {
  const git = simpleGit(dir);
  const staged = ":(glob)literal.txt";
  const sub = join(dir, "sub");
  mkdirSync(sub);
  writeFileSync(join(dir, staged), "staged value");
  await git.raw(["--literal-pathspecs", "add", "--", staged]);
  writeFileSync(join(dir, staged), "working value");
  writeFileSync(join(dir, "new file.txt"), "untracked");
  const local = createGitClient(sub);
  const status = await local.describeStatus();
  expect(status.staged.map(({ path }) => path)).toEqual([staged]);
  expect(status.unstaged).toEqual([staged]);
  expect(status.untracked).toEqual(["new file.txt"]);
  expect(await local.getStagedPathDiff([staged])).toContain("+staged value");
  await local.unstagePaths([staged]);
  expect((await local.describeStatus()).staged).toEqual([]);
  expect(readFileSync(join(dir, staged), "utf8")).toBe("working value");
});

test("repository status unstages a selected rename without touching unrelated staging or working files", async () => {
  const git = simpleGit(dir);
  const oldPath = "README.md";
  const newPath = "README café.md";
  await git.raw(["mv", "--", oldPath, newPath]);
  writeFileSync(join(dir, newPath), "working edit after the rename");
  writeFileSync(join(dir, "keep.txt"), "unrelated");
  await git.add("keep.txt");
  const ui = createUIMock({
    askSelect: async () => "unstage",
    askSearchMultiSelect: async (_message, options) =>
      options.filter(({ label }) => label === `${oldPath} → ${newPath}`).map(({ value }) => value),
    askConfirm: async () => true,
  });
  await new RepositoryStatusFlow(client, ui, async () => {}).run();
  expect(ui.showDiff).toHaveBeenCalledWith(expect.stringContaining("rename from README.md"));
  expect((await client.describeStatus()).staged.map(({ path }) => path)).toEqual(["keep.txt"]);
  expect(readFileSync(join(dir, newPath), "utf8")).toBe("working edit after the rename");
  expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("unrelated");
  expect(ui.success).toHaveBeenCalledWith("Unstaged 1 file(s).");
});

test("repository status refuses to unstage a path restaged during confirmation", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "README.md"), "displayed\n");
  await git.add("README.md");
  const head = await git.revparse(["HEAD"]);
  const ui = createUIMock({
    askSelect: async () => "unstage",
    askSearchMultiSelect: async (_message, options) => options.map(({ value }) => value),
    askConfirm: async () => {
      writeFileSync(join(dir, "README.md"), "new index content\n");
      await git.add("README.md");
      return true;
    },
  });
  await new RepositoryStatusFlow(client, ui, async () => {}).run();
  expect(ui.showDiff).toHaveBeenCalledWith(expect.stringContaining("+displayed"));
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("differ from the preview"));
  expect(ui.success).not.toHaveBeenCalled();
  expect(await git.raw(["show", ":README.md"])).toBe("new index content\n");
  expect(await git.revparse(["HEAD"])).toBe(head);
});

test("Cherry-pick leaves both destination branches untouched when confirmation switches HEAD", async () => {
  const git = strictGit(dir);
  const original = await client.getCurrentBranch();
  const base = await git.revparse(["HEAD"]);
  await git.branch(["alternative"]);
  await git.checkoutLocalBranch("source");
  writeFileSync(join(dir, "reviewed.txt"), "source change");
  await git.add("reviewed.txt");
  await git.commit("reviewed change");
  const selected = await git.revparse(["HEAD"]);
  await git.checkout(original);
  const ui = createUIMock({
    askSearchSelect: async () => "refs/heads/source",
    askSearchMultiSelect: async () => [selected],
    askConfirm: async (message) => {
      if (message.startsWith("Apply 1")) await git.checkout("alternative");
      return true;
    },
  });
  await new CherryPicker(client, ui).run();
  expect(await client.getCurrentBranch()).toBe("alternative");
  expect(await git.revparse(["HEAD"])).toBe(base);
  expect(await git.revparse([`refs/heads/${original}`])).toBe(base);
  expect(await git.revparse(["refs/heads/source"])).toBe(selected);
  expect(await git.raw(["ls-files", "--", "reviewed.txt"])).toBe("");
  expect(ui.warn).toHaveBeenCalledWith(
    "The destination branch changed. Review the cherry-pick again.",
  );
});

test("the status menu continues a resolved cherry-pick and keeps pending work when dismissed", async () => {
  const git = simpleGit(dir);
  const current = await client.getCurrentBranch();
  await git.checkoutLocalBranch("incoming");
  writeFileSync(join(dir, "README.md"), "incoming\n");
  await git.commit("incoming change", ["-a"]);
  const incoming = await git.revparse(["HEAD"]);
  await git.checkout(current);
  writeFileSync(join(dir, "README.md"), "ours\n");
  await git.commit("our change", ["-a"]);
  const before = await git.revparse(["HEAD"]);
  await expect(client.cherryPick(incoming)).rejects.toThrow();
  expect(await client.getInProgressOperation()).toBe("cherry-pick");

  const ui = createUIMock({
    askSelect: async () => "recover" as never,
    waitForConflictResolution: async () => null,
  });
  await new RepositoryStatusFlow(client, ui, async () => {}).run();
  expect(await git.revparse(["HEAD"])).toBe(before);
  expect(await client.getInProgressOperation()).toBe("cherry-pick");

  await git.add("README.md");
  await new RepositoryStatusFlow(
    client,
    { ...ui, waitForConflictResolution: async () => true },
    async () => {},
  ).run();
  expect(await git.revparse(["HEAD"])).toBe(before);
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("conflict markers"));

  writeFileSync(join(dir, "README.md"), "resolved\n");
  await git.add("README.md");
  await new RepositoryStatusFlow(
    client,
    { ...ui, waitForConflictResolution: async () => true },
    async () => {},
  ).run();
  expect(await client.getInProgressOperation()).toBeNull();
  expect(await client.getConflictIdentity("cherry-pick")).toBeNull();
  expect(await git.revparse(["HEAD"])).not.toBe(before);
  expect(await git.raw(["show", "HEAD:README.md"])).toBe("resolved\n");
  expect(ui.success).toHaveBeenCalledWith("cherry-pick completed.");
});

test("recovery leaves a replacement cherry-pick pending when the original abort is confirmed", async () => {
  const git = simpleGit(dir);
  const current = await client.getCurrentBranch();
  const incoming: string[] = [];
  for (const branch of ["incoming-first", "incoming-second"]) {
    await git.checkoutLocalBranch(branch);
    writeFileSync(join(dir, "README.md"), `${branch}\n`);
    await git.commit(branch, ["-a"]);
    incoming.push(await git.revparse(["HEAD"]));
    await git.checkout(current);
  }
  writeFileSync(join(dir, "README.md"), "ours\n");
  await git.commit("our change", ["-a"]);
  const ours = await git.revparse(["HEAD"]);
  const replacement = incoming[1]!;
  await expect(client.cherryPick(incoming[0]!)).rejects.toThrow();

  const ui = createUIMock({
    askSelect: async () => "recover",
    waitForConflictResolution: async () => {
      await client.cherryPickAbort();
      await expect(client.cherryPick(replacement)).rejects.toThrow();
      return false;
    },
  });
  await new RepositoryStatusFlow(client, ui, async () => {}).run();
  expect(await git.revparse(["HEAD"])).toBe(ours);
  expect(await git.revparse(["CHERRY_PICK_HEAD"])).toBe(replacement);
  expect(await client.getInProgressOperation()).toBe("cherry-pick");
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("The active Git operation changed"));
  expect(ui.info).not.toHaveBeenCalledWith(expect.stringContaining("aborted"));
});

test("Revert can abort and resume a real conflict while preserving unrelated files", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "README.md"), "first change\n");
  await git.commit("first change", ["-a"]);
  const toRevert = await git.revparse(["HEAD"]);
  writeFileSync(join(dir, "README.md"), "local work\n");
  await git.commit("local work", ["-a"]);
  const previous = await git.revparse(["HEAD"]);
  writeFileSync(join(dir, "keep.txt"), "untracked work");

  const ui = createUIMock({
    askSearchSelect: async () => toRevert,
    askConfirm: async () => true,
  });
  await new RevertCommit(client, ui, {
    waitForResolution: async () => {
      expect(await client.getInProgressOperation()).toBe("revert");
      expect(await client.getConflictDiff()).toContain("first change");
      return false;
    },
  }).run();
  expect(await git.revparse(["HEAD"])).toBe(previous);
  expect(await client.getInProgressOperation()).toBeNull();
  expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("local work\n");

  await expect(client.revertCommit(toRevert)).rejects.toThrow();
  await new RevertCommit(client, ui, {
    waitForResolution: async () => {
      writeFileSync(join(dir, "README.md"), "resolved revert\n");
      await git.add("README.md");
      return true;
    },
  }).run();
  expect(await git.revparse(["HEAD^"])).toBe(previous);
  expect(await git.raw(["show", "HEAD:README.md"])).toBe("resolved revert\n");
  expect(await client.getInProgressOperation()).toBeNull();
  expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("untracked work");
  expect(ui.success).toHaveBeenCalledWith("Revert completed.");
});

test("Purge previews deleted paths and rejects a source whose refs changed after confirmation", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "historical.txt"), "historical");
  await git.add("historical.txt");
  await git.commit("add historical file");
  await git.rm("historical.txt");
  await git.commit("remove historical file");
  const scope = await client.describePurge(["historical.txt", "no-file.txt"]);
  expect(scope.absent).toEqual(["no-file.txt"]);
  expect(scope.refs).toHaveLength(1);
  await git.branch(["new-ref"]);
  const head = await git.revparse(["HEAD"]);
  await expect(client.purgeFromHistory(["historical.txt"], scope.refs)).rejects.toThrow("changed");
  expect(await git.revparse(["HEAD"])).toBe(head);
  expect(await git.raw(["log", "--all", "--oneline", "--", "historical.txt"])).toContain(
    "add historical file",
  );
});

test("Push Branch sends only the previewed commit to the selected remote's configured branch", async () => {
  const git = simpleGit(dir);
  const branch = await client.getCurrentBranch();
  const remotePath = join(dir, "publish.git");
  await git.raw(["init", "--bare", remotePath]);
  const remote = simpleGit(remotePath);
  await git.addRemote("origin", join(dir, "unused.git"));
  await git.addRemote("publish", remotePath);
  for (const [key, value] of [
    ["remote", "publish"],
    ["merge", "refs/heads/review-topic"],
  ] as const) {
    const configured = Bun.spawnSync(["git", "config", `branch.${branch}.${key}`, value], {
      cwd: dir,
    });
    expect(configured.success).toBe(true);
  }
  await git.addConfig("push.followTags", "true");
  await git.raw(["tag", "-a", "v0.0.1", "-m", "tag that should remain local"]);

  const ui = createUIMock({
    askSelect: async () => "publish",
    askConfirm: async () => true,
  });
  await new PushBranch(client, ui).run();
  expect(ui.error).not.toHaveBeenCalled();
  expect(await remote.revparse(["refs/heads/review-topic"])).toBe(await git.revparse(["HEAD"]));
  expect(await remote.raw(["tag"])).toBe("");
  expect(await remote.raw(["for-each-ref", "--format=%(refname)"])).toBe(
    "refs/heads/review-topic\n",
  );
});

test("Push Branch rejects a stale commit and leaves the remote without refs", async () => {
  const git = simpleGit(dir);
  const remotePath = join(dir, "destination.git");
  await git.raw(["init", "--bare", remotePath]);
  await git.addRemote("destination", remotePath);
  const plan = await client.previewBranchPush("destination");
  await git.raw(["commit", "--allow-empty", "-m", "changed after preview"]);
  await expect(client.pushBranch(plan)).rejects.toThrow("changed");
  expect(await simpleGit(remotePath).raw(["for-each-ref"])).toBe("");
});

test("Push Branch reports a non-fast-forward rejection and leaves the remote branch unchanged", async () => {
  const git = simpleGit(dir);
  const branch = await client.getCurrentBranch();
  const remotePath = join(dir, "rejection.git");
  await git.raw(["init", "--bare", remotePath]);
  const remote = simpleGit(remotePath);
  await git.addRemote("publish", remotePath);
  await git.push(["publish", branch]);
  const clone = join(dir, "competing-clone");
  await git.clone(remotePath, clone, ["--branch", branch]);
  const other = simpleGit(clone);
  await other.addConfig("user.email", "other@example.test");
  await other.addConfig("user.name", "Other");
  await other.raw(["commit", "--allow-empty", "-m", "remote ahead"]);
  await other.push();
  const upstream = await other.revparse(["HEAD"]);
  await git.raw(["commit", "--allow-empty", "-m", "local divergence"]);
  const ui = createUIMock({ askConfirm: async () => true });
  await new PushBranch(client, ui).run();
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("Push did not complete"));
  expect(ui.success).not.toHaveBeenCalled();
  expect(await remote.revparse([`refs/heads/${branch}`])).toBe(upstream);
});

test("worktree inventory preserves whitespace and prevents occupied or locked mutations", async () => {
  const git = simpleGit(dir);
  const current = await client.getCurrentBranch();
  const occupiedPath = join(dir, "unused checkout");
  await expect(client.addWorktree(occupiedPath, current, false)).rejects.toThrow(
    "already checked out",
  );

  const branch = "feat/linked";
  const path = join(realpathSync(dir), " linked checkout \n");
  await client.addWorktree(path, branch, true);
  await git.raw(["worktree", "lock", "--reason", "maintenance", "--", path]);
  expect((await client.getWorktrees()).find((entry) => entry.branch === branch)).toEqual({
    path,
    branch,
    isMain: false,
    isLocked: true,
  });
  await expect(client.removeWorktree(path)).rejects.toThrow("unlocked");
  await git.raw(["worktree", "unlock", "--", path]);
  await client.removeWorktree(path);
  expect((await client.getWorktrees()).map((entry) => entry.branch)).toEqual([current]);
});

test("worktree add rejects invalid destinations and safely removes a detached linked checkout", async () => {
  const git = simpleGit(dir);
  const branch = "linked-existing";
  const linked = join(realpathSync(dir), "empty checkout");
  mkdirSync(linked);
  await git.branch([branch]);

  for (const [path, ref] of [
    ["", branch],
    [linked, ""],
    [linked, "-invalid"],
  ] as const) {
    await expect(client.addWorktree(path, ref, false)).rejects.toThrow("path and branch");
  }
  for (const path of [join(dir, "README.md"), dir]) {
    await expect(client.addWorktree(path, branch, false)).rejects.toThrow("empty directory");
  }
  await expect(client.addWorktree(linked, "missing-branch", false)).rejects.toThrow(
    "no longer exists",
  );
  await expect(client.removeWorktree(join(dir, "missing-checkout"))).rejects.toThrow("unlocked");
  await expect(client.removeWorktree(dir)).rejects.toThrow("unlocked");
  expect(readdirSync(linked)).toEqual([]);

  await client.addWorktree(linked, branch, false);
  const linkedGit = simpleGit(linked);
  expect(await linkedGit.revparse(["--abbrev-ref", "HEAD"])).toBe(branch);
  await linkedGit.raw(["switch", "--detach"]);
  await git.raw(["worktree", "lock", "--", linked]);
  expect((await client.getWorktrees()).find(({ path }) => path === linked)).toEqual({
    path: linked,
    branch: "(detached)",
    isMain: false,
    isLocked: true,
  });
  await expect(client.removeWorktree(linked)).rejects.toThrow("unlocked");
  await git.raw(["worktree", "unlock", "--", linked]);
  await client.removeWorktree(linked);
  expect((await client.getWorktrees()).map(({ isMain }) => isMain)).toEqual([true]);
  expect(await client.branchExists(branch)).toBe(true);
});

test("switching from a same-named remote branch sets the selected upstream and stashes untracked files", async () => {
  const git = simpleGit(dir);
  for (const remote of ["origin", "review"]) {
    const path = join(dir, ".git", `${remote}.git`);
    await git.raw(["init", "--bare", path]);
    await git.addRemote(remote, path);
    await git.push([remote, "HEAD:refs/heads/topic"]);
  }
  await git.raw(["commit", "--allow-empty", "-m", "review change"]);
  const reviewed = await git.revparse(["HEAD"]);
  await git.push(["review", "HEAD:refs/heads/topic"]);
  await git.fetch(["--all"]);
  writeFileSync(join(dir, "local changes.txt"), "keep me");
  const ui = createUIMock({
    askSearchSelect: async () => "\0refs/remotes/review/topic",
    askText: async () => "tracking-review",
    askConfirm: async () => true,
  });
  await new BranchSwitcher(client, ui).run();
  expect(await git.revparse(["HEAD"])).toBe(reviewed);
  expect(await git.revparse(["--abbrev-ref", "@{upstream}"])).toBe("review/topic");
  expect((await client.getStashes()).length).toBe(1);
  expect((await client.getStatus()).files.some(({ path }) => path === "local changes.txt")).toBe(
    false,
  );
});

test("a stale remote-tracking checkout leaves the current branch and working tree intact", async () => {
  const git = simpleGit(dir);
  const current = await client.getCurrentBranch();
  const path = join(dir, "tracking.git");
  await git.raw(["init", "--bare", path]);
  await git.addRemote("review", path);
  await git.push(["review", "HEAD:refs/heads/topic"]);
  await git.fetch(["review"]);
  const target = (await client.getTrackingBranches()).find(({ name }) => name === "topic");
  expect(target).toBeDefined();
  await git.raw(["update-ref", "-d", target!.ref]);
  await expect(client.checkoutTrackingBranch(target!, "topic")).rejects.toThrow("changed");
  expect(await client.getCurrentBranch()).toBe(current);
  expect(await client.branchExists("topic")).toBe(false);
});

test("a refused branch switch leaves staged and untracked changes recoverable in the stash", async () => {
  const git = simpleGit(dir);
  const original = await client.getCurrentBranch();
  await client.addWorktree(join(dir, "other-checkout"), "occupied", true);
  writeFileSync(join(dir, "README.md"), "staged changes");
  await git.add("README.md");
  writeFileSync(join(dir, "untracked.txt"), "untracked changes");
  const ui = createUIMock({
    askSearchSelect: async () => "occupied",
    askConfirm: async () => true,
  });
  await expect(new BranchSwitcher(client, ui).run()).rejects.toThrow(/worktree|checked out/i);
  expect(await client.getCurrentBranch()).toBe(original);
  const stashes = await client.getStashes();
  expect(stashes).toHaveLength(1);
  await git.raw(["stash", "apply", "--index", stashes[0]!.oid]);
  expect(await git.raw(["show", ":README.md"])).toBe("staged changes");
  expect(readFileSync(join(dir, "untracked.txt"), "utf8")).toBe("untracked changes");
});

test("Sync rolls back the commit when a hook stages a path outside the confirmed preview", async () => {
  const git = simpleGit(dir);
  const before = await git.revparse(["HEAD"]);
  writeFileSync(join(dir, "selected.txt"), "selected change");
  writeFileSync(join(dir, "unselected.txt"), "already staged");
  await git.add("unselected.txt");
  const indexBefore = await git.raw(["write-tree"]);
  const selection = await client.previewSelectedCommit(["selected.txt"]);
  const hook = join(dir, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\ngit add -- unselected.txt\n");
  chmodSync(hook, 0o755);

  await expect(client.commitSelection(selection, "selected only")).rejects.toThrow(
    "Restored the original branch and index",
  );
  expect(await git.revparse(["HEAD"])).toBe(before);
  expect(await git.raw(["write-tree"])).toBe(indexBefore);
  expect(readFileSync(join(dir, "selected.txt"), "utf8")).toBe("selected change");
});

test("Sync retains the original index and reports the commit when a hook rejects rollback", async () => {
  const git = strictGit(dir);
  const before = await git.revparse(["HEAD"]);
  writeFileSync(join(dir, "selected.txt"), "reviewed change");
  writeFileSync(join(dir, "outside.txt"), "outside the preview");
  const indexPath = join(dir, ".git", "index");
  const index = readFileSync(indexPath);
  writeRewriteHook("pre-commit", ["git add -- outside.txt"]);
  writeRewriteHook("reference-transaction", [
    'test "$1" = prepared || exit 0',
    "while read -r old new ref; do",
    `  if [ "$new" = '${before}' ]; then echo "rollback refused" >&2; exit 1; fi`,
    "done",
  ]);
  const preview = await client.previewSelectedCommit(["selected.txt"]);
  let diagnostic = "";
  try {
    await client.commitSelection(preview, "reviewed commit");
  } catch (error) {
    diagnostic = String(error);
  }
  const current = await git.revparse(["HEAD"]);
  expect(current).not.toBe(before);
  expect(diagnostic).toContain(`at ${current}. The branch could not be restored.`);
  expect(await git.raw(["show", "HEAD:outside.txt"])).toBe("outside the preview");
  expect(readFileSync(indexPath)).toEqual(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("Sync rejects a branch switched after preview and keeps the original index", async () => {
  const git = simpleGit(dir);
  const original = await client.getCurrentBranch();
  await git.branch(["alternate"]);
  writeFileSync(join(dir, "selected.txt"), "selected contents");
  const preview = await client.previewSelectedCommit(["selected.txt"]);
  await client.checkoutBranch("alternate");
  const index = readFileSync(join(dir, ".git", "index"));
  await expect(client.commitSelection(preview, "stale preview")).rejects.toThrow(
    "current branch changed",
  );
  expect(await git.revparse(["HEAD"])).toBe(preview.head!);
  expect(await git.revparse([`refs/heads/${original}`])).toBe(preview.head!);
  expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("Sync restores an unborn branch when a hook changes the root commit tree", async () => {
  const root = join(dir, "initial");
  mkdirSync(root);
  const git = strictGit(root);
  await git.raw(["init", "--initial-branch=first"]);
  await git.addConfig("user.email", "test@example.invalid");
  await git.addConfig("user.name", "Test");
  const initial = createGitClient(root);
  writeFileSync(join(root, "selected.txt"), "confirmed");
  writeFileSync(join(root, "unexpected.txt"), "outside preview");
  writeFileSync(
    join(root, ".git", "hooks", "pre-commit"),
    "#!/bin/sh\ngit add -- unexpected.txt\n",
    { mode: 0o755 },
  );
  const preview = await initial.previewSelectedCommit(["selected.txt"]);
  await expect(initial.commitSelection(preview, "first commit")).rejects.toThrow(
    "Restored the original branch and index",
  );
  expect(preview.head).toBeNull();
  expect(await git.raw(["symbolic-ref", "--short", "HEAD"])).toBe("first\n");
  expect(await git.raw(["for-each-ref", "refs/heads/"])).toBe("");
  expect(await git.raw(["ls-files"])).toBe("");
  expect(await initial.hasIndexLock()).toBe(false);
  expect(readFileSync(join(root, "unexpected.txt"), "utf8")).toBe("outside preview");
});

test("Sync leaves a merge started after preview pending with its index intact", async () => {
  const root = join(dir, "main\nrepository");
  const linked = join(dir, "linked");
  mkdirSync(root);
  await seedRepo(root);
  const main = simpleGit(root);
  const mainClient = createGitClient(root);
  await mainClient.addWorktree(linked, "linked-sync", true);
  writeFileSync(join(root, "incoming.txt"), "merge changes");
  await main.add("incoming.txt");
  await main.commit("incoming changes");
  const incoming = await main.revparse(["HEAD"]);
  const git = simpleGit(linked);
  const linkedClient = createGitClient(linked);
  writeFileSync(join(linked, "selection.txt"), "selected work");
  const preview = await linkedClient.previewSelectedCommit(["selection.txt"]);

  await git.raw(["merge", "--no-ff", "--no-commit", incoming]);
  const indexPath = join(
    (await git.raw(["rev-parse", "--absolute-git-dir"])).replace(/\n$/, ""),
    "index",
  );
  const index = readFileSync(indexPath);
  expect(await mainClient.getInProgressOperation()).toBeNull();
  expect(await linkedClient.getInProgressOperation()).toBe("merge");
  expect(await linkedClient.getConflictIdentity("merge")).toContain(incoming);
  await expect(linkedClient.commitSelection(preview, "selected commit")).rejects.toThrow(
    "pending Git operation (merge)",
  );
  await expect(linkedClient.previewSelectedCommit(["selection.txt"])).rejects.toThrow(
    "pending Git operation (merge)",
  );
  expect(await git.revparse(["HEAD"])).toBe(preview.head!);
  expect(await git.revparse(["MERGE_HEAD"])).toBe(incoming);
  expect(readFileSync(indexPath)).toEqual(index);
  expect(readFileSync(join(linked, "selection.txt"), "utf8")).toBe("selected work");
  expect(await linkedClient.hasIndexLock()).toBe(false);
});

test("Sync keeps the original index when a hook advances HEAD after committing", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "selection.txt"), "selected work");
  const preview = await client.previewSelectedCommit(["selection.txt"]);
  const gitDir = join(dir, ".git");
  const index = readFileSync(join(gitDir, "index"));
  writeFileSync(
    join(gitDir, "hooks", "post-commit"),
    [
      "#!/bin/sh",
      "set -eu",
      "created=$(git rev-parse HEAD)",
      'advanced=$(git commit-tree "HEAD^{tree}" -p "$created" -m "concurrent commit")',
      'git update-ref HEAD "$advanced" "$created"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  await expect(client.commitSelection(preview, "selected commit")).rejects.toThrow(
    "HEAD does not match Git's commit result",
  );
  expect(await git.raw(["log", "-2", "--format=%s"])).toBe("concurrent commit\nselected commit\n");
  expect(await git.raw(["show", "HEAD^:selection.txt"])).toBe("selected work");
  expect(readFileSync(join(gitDir, "index"))).toEqual(index);
  expect(await client.hasIndexLock()).toBe(false);
  expect(readdirSync(gitDir).filter((name) => name.startsWith("gitten-commit-"))).toEqual([]);
});

test("Sync keeps the original index when a hook switches branches at the same commit", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "selection.txt"), "selected work");
  const preview = await client.previewSelectedCommit(["selection.txt"]);
  const indexPath = join(dir, ".git", "index");
  const index = readFileSync(indexPath);
  writeFileSync(
    join(dir, ".git", "hooks", "post-commit"),
    [
      "#!/bin/sh",
      "set -eu",
      'git update-ref refs/heads/alternate "$(git rev-parse HEAD)"',
      "git symbolic-ref HEAD refs/heads/alternate",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  await expect(client.commitSelection(preview, "selected commit")).rejects.toThrow(
    "HEAD changed during commit",
  );
  expect(await git.raw(["symbolic-ref", "HEAD"])).toBe("refs/heads/alternate\n");
  expect(await git.revparse(["HEAD"])).toBe(await git.revparse([preview.branchRef]));
  expect(await git.raw(["show", "HEAD:selection.txt"])).toBe("selected work");
  expect(readFileSync(indexPath)).toEqual(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("Sync reports a commit removed by a post-commit hook and keeps the original index", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "selection.txt"), "selected work");
  const preview = await client.previewSelectedCommit(["selection.txt"]);
  const indexPath = join(dir, ".git", "index");
  const index = readFileSync(indexPath);
  writeFileSync(
    join(dir, ".git", "hooks", "post-commit"),
    [
      "#!/bin/sh",
      "set -eu",
      'git update-ref HEAD "$(git rev-parse HEAD^)" "$(git rev-parse HEAD)"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  await expect(client.commitSelection(preview, "selected commit")).rejects.toThrow(
    "No new commit remains at HEAD",
  );
  expect(await git.revparse(["HEAD"])).toBe(preview.head!);
  expect(readFileSync(indexPath)).toEqual(index);
  expect(readFileSync(join(dir, "selection.txt"), "utf8")).toBe("selected work");
  expect(await client.hasIndexLock()).toBe(false);
});

test("Sync refuses empty selections and leaves a broken index untouched", async () => {
  const git = simpleGit(dir);
  const gitDir = join(dir, ".git");
  await expect(client.previewSelectedCommit([])).rejects.toThrow("Select at least one file");
  expect(readdirSync(gitDir).filter((name) => name.startsWith("gitten-commit-"))).toEqual([]);

  writeFileSync(join(dir, "selection.txt"), "selected work");
  const preview = await client.previewSelectedCommit(["selection.txt"]);
  const indexPath = join(gitDir, "index");
  rmSync(indexPath);
  mkdirSync(indexPath);
  writeFileSync(join(indexPath, "sentinel"), "keep");

  await expect(client.commitSelection(preview, "blocked by broken index")).rejects.toThrow();
  expect(await git.revparse(["HEAD"])).toBe(preview.head!);
  expect(readFileSync(join(indexPath, "sentinel"), "utf8")).toBe("keep");
  expect(await client.hasIndexLock()).toBe(false);
  expect(readdirSync(gitDir).filter((name) => name.startsWith("gitten-commit-"))).toEqual([]);
});

test("Sync exposes a recovery index when a completed commit cannot install its index", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "README.md"), "unrelated staging");
  await git.add("README.md");
  writeFileSync(join(dir, "selection.txt"), "selected work");
  const preview = await client.previewSelectedCommit(["selection.txt"]);
  const gitDir = join(realpathSync(dir), ".git");
  const index = readFileSync(join(gitDir, "index"));
  writeFileSync(
    join(gitDir, "hooks", "post-commit"),
    [
      "#!/bin/sh",
      "set -eu",
      "gitdir=$(git rev-parse --absolute-git-dir)",
      'mv "$gitdir/index" "$gitdir/index.original"',
      'mkdir "$gitdir/index"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  let diagnostic: string;
  try {
    await client.commitSelection(preview, "publish locally");
    throw new Error("Expected index update to fail");
  } catch (error) {
    diagnostic = String(error);
  }
  const [retained] = readdirSync(gitDir).filter((name) => name.startsWith("gitten-commit-"));
  expect(retained).toBeDefined();
  const recovery = join(gitDir, retained!, "next-index");
  expect(diagnostic).toContain("Commit created, but the index could not be restored.");
  expect(diagnostic).toContain(`Recovery index: ${recovery}`);
  expect(await git.raw(["show", "HEAD:selection.txt"])).toBe("selected work");
  const recovered = Bun.spawnSync(["git", "show", ":README.md"], {
    cwd: dir,
    env: { ...process.env, GIT_INDEX_FILE: recovery },
  });
  expect(recovered.exitCode).toBe(0);
  expect(recovered.stdout.toString()).toBe("unrelated staging");
  expect(readFileSync(join(gitDir, "index.original"))).toEqual(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("branch cleanup deletes only the confirmed remote branch through its fetch mapping", async () => {
  const git = simpleGit(dir);
  for (const name of ["origin", "review"]) {
    const path = join(dir, ".git", `${name}.git`);
    await git.raw(["init", "--bare", path]);
    await git.addRemote(name, path);
    await git.push([name, "HEAD:refs/heads/team/topic"]);
  }
  const configured = Bun.spawnSync(
    ["git", "config", "remote.review.fetch", "+refs/heads/team/*:refs/remotes/review/*"],
    { cwd: dir },
  );
  expect(configured.success).toBe(true);
  await git.fetch(["review"]);
  const target = (await client.getTrackingBranches()).find(
    ({ ref }) => ref === "refs/remotes/review/topic",
  );
  expect(target).toBeDefined();
  const plan = await client.previewRemoteBranchDeletion(target!);
  expect(plan.destination).toBe("refs/heads/team/topic");
  await client.deleteRemoteBranch(plan);
  expect(await simpleGit(join(dir, ".git", "review.git")).raw(["for-each-ref"])).toBe("");
  expect(await simpleGit(join(dir, ".git", "origin.git")).revparse(["refs/heads/team/topic"])).toBe(
    await git.revparse(["HEAD"]),
  );
});

test("branch cleanup refuses to delete a ref advanced on the server after confirmation", async () => {
  const git = simpleGit(dir);
  const path = join(dir, ".git", "review.git");
  await git.raw(["init", "--bare", path]);
  await git.addRemote("review", path);
  await git.push(["review", "HEAD:refs/heads/topic"]);
  const target = (await client.getTrackingBranches()).find(
    ({ ref }) => ref === "refs/remotes/review/topic",
  );
  expect(target).toBeDefined();
  const plan = await client.previewRemoteBranchDeletion(target!);
  await git.raw(["commit", "--allow-empty", "-m", "advanced upstream"]);
  // Pushing to the path deliberately leaves the local remote-tracking ref stale.
  await git.push([path, "HEAD:refs/heads/topic"]);
  await expect(client.deleteRemoteBranch(plan)).rejects.toThrow("stale");
  expect(await simpleGit(path).revparse(["refs/heads/topic"])).toBe(await git.revparse(["HEAD"]));
});

async function rewriteRange(
  git: ReturnType<typeof createGitClient>,
  count: number,
): Promise<HistoryRange> {
  const { branchRef, commits } = await git.readRewriteHistory(count);
  const head = commits[0]!;
  const oldest = commits[count - 1]!;
  return { branchRef, head: head.oid, oldest: oldest.oid, base: oldest.firstParent, count };
}

function writeRewriteHook(name: string, lines: string[]): void {
  writeFileSync(
    join(dir, ".git", "hooks", name),
    ["#!/bin/sh", "set -eu", ...lines, ""].join("\n"),
    {
      mode: 0o755,
    },
  );
}

function runWithUnexpectedCommit(body: string, mode: "quiet" | "wrong-parent", parent: string) {
  const bin = join(dir, ".git", "fixture-bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "git"),
    [
      "#!/bin/sh",
      "set -eu",
      'native="$GITTEN_FIXTURE_NATIVE_GIT"',
      'if [ "$1" = "-c" ] && [ "$2" = "core.abbrev=no" ] && [ "$3" = "commit" ]; then',
      "  shift 3",
      '  if [ "$GITTEN_FIXTURE_COMMIT_MODE" = "quiet" ]; then exec "$native" commit --quiet "$@"; fi',
      '  tree=$("$native" write-tree)',
      '  old=$("$native" rev-parse HEAD)',
      '  oid=$("$native" commit-tree "$tree" -p "$GITTEN_FIXTURE_PARENT" -m "unexpected parent")',
      '  "$native" update-ref HEAD "$oid" "$old"',
      '  printf "[%s %s] unexpected parent\\n" "$("$native" branch --show-current)" "$oid"',
      "  exit 0",
      "fi",
      'exec "$native" "$@"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const module = new URL("../../src/git/git-client.ts", import.meta.url).href;
  return runBun(
    [
      "-e",
      `import { createGitClient } from ${JSON.stringify(module)}; const git = createGitClient(); ${body}`,
    ],
    dir,
    {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITTEN_FIXTURE_NATIVE_GIT: Bun.which("git") ?? undefined,
      GITTEN_FIXTURE_COMMIT_MODE: mode,
      GITTEN_FIXTURE_PARENT: parent,
    },
  );
}

test("Sync restores the confirmed branch and index if Git creates a commit with a different parent", async () => {
  const git = strictGit(dir);
  const previous = await git.revparse(["HEAD"]);
  await git.raw(["commit", "--allow-empty", "-m", "confirmed parent"]);
  const head = await git.revparse(["HEAD"]);
  const indexPath = join(dir, ".git", "index");
  const index = readFileSync(indexPath);
  writeFileSync(join(dir, "selection.txt"), "confirmed change");
  const result = runWithUnexpectedCommit(
    'const preview = await git.previewSelectedCommit(["selection.txt"]); await git.commitSelection(preview, "reviewed");',
    "wrong-parent",
    previous,
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain(
    "changed the commit's parent. Restored the original branch and index.",
  );
  expect(await git.revparse(["HEAD"])).toBe(head);
  expect(readFileSync(indexPath)).toEqual(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("Squash restores the original tip when a verified commit has a different parent", async () => {
  const git = strictGit(dir);
  await git.raw(["commit", "--allow-empty", "-m", "second"]);
  await git.raw(["commit", "--allow-empty", "-m", "third"]);
  const range = await rewriteRange(client, 2);
  const indexPath = join(dir, ".git", "index");
  const index = readFileSync(indexPath);
  const result = runWithUnexpectedCommit(
    `await git.squashRange(${JSON.stringify(range)}, "reviewed");`,
    "wrong-parent",
    range.head,
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("The squash commit has a different parent.");
  expect(await git.revparse(["HEAD"])).toBe(range.head);
  expect(await git.revparse([`refs/gitten/recovery/${range.head}`])).toBe(range.head);
  expect(readFileSync(indexPath)).toEqual(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("Squash leaves recovery available when Git commits without reporting its ID", async () => {
  const git = strictGit(dir);
  await git.raw(["commit", "--allow-empty", "-m", "second"]);
  await git.raw(["commit", "--allow-empty", "-m", "third"]);
  const range = await rewriteRange(client, 2);
  const indexPath = join(dir, ".git", "index");
  const index = readFileSync(indexPath);
  const result = runWithUnexpectedCommit(
    `await git.squashRange(${JSON.stringify(range)}, "reviewed");`,
    "quiet",
    range.head,
  );
  const recovery = `refs/gitten/recovery/${range.head}`;
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("Git did not report a usable commit ID.");
  expect(result.stderr.toString()).toContain(recovery);
  expect(await git.raw(["show", "-s", "--format=%s", "HEAD"])).toBe("reviewed\n");
  expect(await git.revparse([recovery])).toBe(range.head);
  expect(readFileSync(indexPath)).toEqual(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("Sync and Squash keep full SHA-256 commit and recovery IDs", async () => {
  const root = join(dir, "sha256-rewrite");
  mkdirSync(root);
  const git = strictGit(root);
  await git.raw(["init", "--object-format=sha256", "--initial-branch=main"]);
  await git.addConfig("user.email", "test@example.invalid");
  await git.addConfig("user.name", "Test");
  const sha256 = createGitClient(root);
  writeFileSync(join(root, "first.txt"), "first change");
  const firstPreview = await sha256.previewSelectedCommit(["first.txt"]);
  const first = await sha256.commitSelection(firstPreview, "first");
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  writeFileSync(join(root, "second.txt"), "second change");
  const secondPreview = await sha256.previewSelectedCommit(["second.txt"]);
  const second = await sha256.commitSelection(secondPreview, "second");
  expect(second).toBe(await git.revparse(["HEAD"]));
  const range = await rewriteRange(sha256, 2);
  const backup = await sha256.squashRange(range, "combined");
  expect(backup).toBe(`refs/gitten/recovery/${second}`);
  expect(await git.revparse([backup])).toBe(second);
  expect(await git.raw(["rev-list", "--count", "HEAD"])).toBe("1\n");
  expect(await git.raw(["show", "HEAD:second.txt"])).toBe("second change");
  expect((await sha256.getStatus()).isClean()).toBe(true);
});

test("Undo follows the first parent of a merge and preserves staged and working files", async () => {
  const git = simpleGit(dir);
  const current = await client.getCurrentBranch();
  await git.checkoutLocalBranch("side");
  writeFileSync(join(dir, "side.txt"), "side work");
  await git.add("side.txt");
  await git.commit("side work");
  const side = await git.revparse(["HEAD"]);
  await git.checkout(current);
  await git.raw(["commit", "--allow-empty", "-m", "mainline"]);
  const base = await git.revparse(["HEAD"]);
  await git.raw(["merge", "--no-ff", "--no-edit", "side"]);
  const range = await rewriteRange(client, 1);
  expect(range.base).toBe(base);
  expect((await client.readRewriteHistory(10)).commits.map(({ oid }) => oid)).not.toContain(side);
  writeFileSync(join(dir, "staged.txt"), "independent staged file");
  await git.add("staged.txt");
  const index = await git.raw(["write-tree"]);
  const backup = await client.undoRange(range, "soft");
  expect(await git.revparse(["HEAD"])).toBe(base);
  expect(await git.revparse([backup])).toBe(range.head);
  expect(await git.raw(["write-tree"])).toBe(index);
  expect(readFileSync(join(dir, "side.txt"), "utf8")).toBe("side work");
});

test("mixed Undo to the root makes the branch unborn and keeps working files", async () => {
  const git = simpleGit(dir);
  const range = await rewriteRange(client, 1);
  expect(range.base).toBeNull();
  writeFileSync(join(dir, "README.md"), "edited and staged");
  await git.add("README.md");
  const backup = await client.undoRange(range, "mixed");
  expect(await git.revparse(["--verify", "HEAD"]).catch(() => null)).toBeNull();
  expect(await git.revparse([backup])).toBe(range.head);
  expect(await git.raw(["ls-files"])).toBe("");
  expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("edited and staged");
  expect((await client.readRewriteHistory(10)).commits).toEqual([]);
});

test("Squash through the root creates one commit with the confirmed tree", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "two.txt"), "two");
  await git.add("two.txt");
  await git.commit("two");
  const range = await rewriteRange(client, 2);
  const tree = await git.revparse(["HEAD^{tree}"]);
  const backup = await client.squashRange(range, "one combined commit");
  expect(await git.raw(["log", "--format=%s"])).toBe("one combined commit\n");
  expect(await git.revparse(["HEAD^{tree}"])).toBe(tree);
  expect(await git.revparse([backup])).toBe(range.head);
  expect((await client.getStatus()).isClean()).toBe(true);
});

test("a failed Squash hook restores the original tip and keeps recovery and index intact", async () => {
  const git = simpleGit(dir);
  await git.raw(["commit", "--allow-empty", "-m", "second"]);
  const range = await rewriteRange(client, 2);
  const originalIndex = await git.raw(["write-tree"]);
  const hook = join(dir, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho hook declined >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  await expect(client.squashRange(range, "blocked")).rejects.toThrow(
    /Restored the original branch.*\nhook declined/,
  );
  expect(await git.revparse(["HEAD"])).toBe(range.head);
  expect(await git.revparse([`refs/gitten/recovery/${range.head}`])).toBe(range.head);
  expect(await git.raw(["write-tree"])).toBe(originalIndex);
  expect(await client.hasIndexLock()).toBe(false);
});

test("Undo and Squash reject a moved branch and retain the confirmed index state", async () => {
  const git = simpleGit(dir);
  await git.raw(["commit", "--allow-empty", "-m", "second"]);
  const range = await rewriteRange(client, 2);
  await git.raw(["commit", "--allow-empty", "-m", "concurrent third"]);
  const changedHead = await git.revparse(["HEAD"]);
  const index = await git.raw(["write-tree"]);
  await expect(client.undoRange(range, "mixed")).rejects.toThrow("changed after the preview");
  await expect(client.squashRange(range, "blocked")).rejects.toThrow("changed after the preview");
  expect(await git.revparse(["HEAD"])).toBe(changedHead);
  expect(await git.raw(["write-tree"])).toBe(index);
});

test("Undo preserves both branches when recovery creation switches HEAD at the same commit", async () => {
  const git = simpleGit(dir);
  await git.raw(["commit", "--allow-empty", "-m", "second"]);
  const range = await rewriteRange(client, 1);
  await git.branch(["alternate"]);
  const indexPath = join(dir, ".git", "index");
  const index = readFileSync(indexPath);
  const backup = `refs/gitten/recovery/${range.head}`;
  writeRewriteHook("reference-transaction", [
    'test "$1" = committed || exit 0',
    "while read -r old new ref; do",
    `  if [ "$ref" = '${backup}' ]; then`,
    "    git -c core.hooksPath=/dev/null symbolic-ref HEAD refs/heads/alternate",
    "  fi",
    "done",
  ]);

  await expect(client.undoRange(range, "mixed")).rejects.toThrow(
    /Could not begin the rewrite\. Recovery ref .*\nThe checked-out branch changed/,
  );
  expect(await git.raw(["symbolic-ref", "HEAD"])).toBe("refs/heads/alternate\n");
  expect(await git.revparse([range.branchRef])).toBe(range.head);
  expect(await git.revparse([backup])).toBe(range.head);
  expect(await git.revparse(["HEAD"])).toBe(range.head);
  expect(readFileSync(indexPath)).toEqual(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("mixed Undo restores the original tip if the prepared index cannot be installed", async () => {
  const git = simpleGit(dir);
  await git.raw(["commit", "--allow-empty", "-m", "second"]);
  const range = await rewriteRange(client, 1);
  const gitDir = join(dir, ".git");
  const index = readFileSync(join(gitDir, "index"));
  const backup = `refs/gitten/recovery/${range.head}`;
  writeRewriteHook("reference-transaction", [
    'test "$1" = committed || exit 0',
    "gitdir=$(git rev-parse --absolute-git-dir)",
    "while read -r old new ref; do",
    `  if [ "$ref" = '${range.branchRef}' ] && [ "$new" = '${range.base}' ]; then`,
    '    mv "$gitdir/index" "$gitdir/index.original"',
    '    mkdir "$gitdir/index"',
    "  fi",
    "done",
  ]);

  await expect(client.undoRange(range, "mixed")).rejects.toThrow(
    `Restored the original branch. Recovery ref ${backup}.`,
  );
  expect(await git.revparse(["HEAD"])).toBe(range.head);
  expect(await git.revparse([backup])).toBe(range.head);
  expect(readFileSync(join(gitDir, "index.original"))).toEqual(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("Squash leaves a bisect started during recovery creation pending", async () => {
  const git = simpleGit(dir);
  await git.raw(["commit", "--allow-empty", "-m", "second"]);
  const range = await rewriteRange(client, 2);
  const backup = `refs/gitten/recovery/${range.head}`;
  const index = await git.raw(["write-tree"]);
  writeRewriteHook("reference-transaction", [
    'test "$1" = committed || exit 0',
    "while read -r old new ref; do",
    `  if [ "$ref" = '${backup}' ]; then`,
    "    git -c core.hooksPath=/dev/null bisect start",
    "  fi",
    "done",
  ]);

  await expect(client.squashRange(range, "blocked")).rejects.toThrow(
    `Recovery ref ${backup}.\nGit started a bisect`,
  );
  expect(await client.getInProgressOperation()).toBe("bisect");
  expect(await git.revparse(["HEAD"])).toBe(range.head);
  expect(await git.revparse([backup])).toBe(range.head);
  expect(await git.raw(["write-tree"])).toBe(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("Squash refuses a dirty worktree and history rewrite requires an attached branch", async () => {
  const git = simpleGit(dir);
  await git.raw(["commit", "--allow-empty", "-m", "second"]);
  const range = await rewriteRange(client, 2);
  writeFileSync(join(dir, "README.md"), "local work");
  await expect(client.squashRange(range, "blocked")).rejects.toThrow("working tree changed");
  expect(await git.revparse(["HEAD"])).toBe(range.head);
  expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("local work");
  expect(await git.raw(["for-each-ref", "refs/gitten/recovery"])).toBe("");
  await git.raw(["switch", "--detach"]);
  await expect(client.readRewriteHistory(10)).rejects.toThrow("Check out a local branch");
  expect(await git.revparse(["HEAD"])).toBe(range.head);
});

test("Squash rolls back when a hook changes the confirmed commit tree", async () => {
  const git = simpleGit(dir);
  const parent = await git.revparse(["HEAD"]);
  await git.raw(["commit", "--allow-empty", "-m", "second"]);
  const range = await rewriteRange(client, 1);
  expect(range.base).toBe(parent);
  const index = await git.raw(["write-tree"]);
  writeRewriteHook("pre-commit", ['printf "hook edit" > hook.txt', "git add -- hook.txt"]);

  await expect(client.squashRange(range, "combined")).rejects.toThrow(
    "The squash result differs from the confirmed tree.",
  );
  expect(await git.revparse(["HEAD"])).toBe(range.head);
  expect(await git.revparse([`refs/gitten/recovery/${range.head}`])).toBe(range.head);
  expect(await git.raw(["write-tree"])).toBe(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("Squash keeps a concurrently advanced branch and reports its recovery ref", async () => {
  const git = simpleGit(dir);
  await git.raw(["commit", "--allow-empty", "-m", "second"]);
  const range = await rewriteRange(client, 2);
  const index = await git.raw(["write-tree"]);
  const backup = `refs/gitten/recovery/${range.head}`;
  writeRewriteHook("post-commit", [
    "created=$(git rev-parse HEAD)",
    'advanced=$(git commit-tree "HEAD^{tree}" -p "$created" -m "concurrent commit")',
    'git update-ref HEAD "$advanced" "$created"',
  ]);

  await expect(client.squashRange(range, "combined")).rejects.toThrow(
    `The rewrite failed and the ref could not be restored. Recovery ref ${backup}.`,
  );
  expect(await git.raw(["log", "-2", "--format=%s"])).toBe("concurrent commit\ncombined\n");
  expect(await git.revparse([backup])).toBe(range.head);
  expect(await git.raw(["write-tree"])).toBe(index);
  expect(await client.hasIndexLock()).toBe(false);
});

test("Undo refuses to mistake a shallow boundary for the root", async () => {
  const git = simpleGit(dir);
  await git.raw(["commit", "--allow-empty", "-m", "second"]);
  const copy = join(dir, "shallow");
  await git.clone(dir, copy, ["--depth=1", "--no-local"]);
  const shallow = createGitClient(copy);
  const one = await rewriteRange(shallow, 1);
  await expect(shallow.undoRange(one, "soft")).rejects.toThrow("history is shallow");
  expect(await simpleGit(copy).revparse(["HEAD"])).toBe(one.head);

  const copiedGit = strictGit(copy);
  await copiedGit.addConfig("user.email", "test@example.invalid");
  await copiedGit.addConfig("user.name", "Test");
  await copiedGit.raw(["switch", "--orphan", "independent"]);
  await copiedGit.raw(["commit", "--allow-empty", "--allow-empty-message", "-m", ""]);
  expect(await copiedGit.revparse(["--is-shallow-repository"])).toBe("true");
  const root = await rewriteRange(shallow, 1);
  expect((await shallow.readRewriteHistory(1)).commits[0]?.subject).toBe("");
  const backup = await shallow.undoRange(root, "soft");
  expect(await copiedGit.revparse([backup])).toBe(root.head);
  expect(await copiedGit.raw(["for-each-ref", "refs/heads/independent"])).toBe("");
});

test("stash inspection and application use the captured OID and include untracked changes when selected", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "README.md"), "tracked edit\n");
  writeFileSync(join(dir, "new file\t☕.txt"), "untracked content\n");
  await client.stashWithMessage("includes | special characters", true);
  const [entry] = await client.getStashes();
  expect(entry?.oid).toMatch(/^[a-f0-9]{40}$/);
  expect(entry?.message).toContain("includes | special characters");
  expect(await client.getStashStat(entry!.oid)).toEqual({
    filesChanged: 2,
    insertions: 2,
    deletions: 1,
  });
  expect(await client.getStashDiff(entry!.oid)).toContain("+untracked content");
  expect((await client.getStatus()).files).toEqual([]);
  await client.stashApply(entry!);
  expect(readFileSync(join(dir, "new file\t☕.txt"), "utf8")).toBe("untracked content\n");
  expect((await client.getStashes())[0]?.oid).toBe(entry!.oid);
  expect(await git.raw(["log", "-1", "--format=%s"])).not.toContain("includes");
});

test("stash statistics count binary files without inventing inserted or deleted lines", async () => {
  writeFileSync(join(dir, "blob with spaces.bin"), Buffer.from([0, 1, 2, 255]));
  await client.stashWithMessage("binary file", true);
  const [entry] = await client.getStashes();
  expect(entry).toBeDefined();
  expect(await client.getStashStat(entry!.oid)).toEqual({
    filesChanged: 1,
    insertions: 0,
    deletions: 0,
  });
  expect(await client.getStashDiff(entry!.oid)).toContain("Binary files");
});

test("empty index operations preserve staged content and tracked ignored files", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "README.md"), "staged content");
  await git.add("README.md");
  writeFileSync(join(dir, ".gitignore"), "README.md\n");
  const staged = await git.raw(["write-tree"]);
  await client.unstagePaths([]);
  await client.untrackFiles([]);
  expect(await git.raw(["write-tree"])).toBe(staged);
  expect(await client.getIgnoredTrackedFiles()).toEqual(["README.md"]);
});

test("Stash preserves the index and working files when a new untracked path appears during review", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "README.md"), "staged edit");
  await git.add("README.md");
  writeFileSync(join(dir, "first.txt"), "first untracked");
  const ui = createUIMock({
    askSelect: async () => "push",
    askConfirm: async () => true,
    askText: async () => {
      writeFileSync(join(dir, "late.txt"), "not consented");
      return "save";
    },
  });
  await new StashManager(client, ui).run();
  expect(await client.getStashes()).toEqual([]);
  expect(await git.raw(["show", ":README.md"])).toBe("staged edit");
  expect(readFileSync(join(dir, "first.txt"), "utf8")).toBe("first untracked");
  expect(readFileSync(join(dir, "late.txt"), "utf8")).toBe("not consented");
  expect(ui.warn).toHaveBeenCalledWith(
    expect.stringContaining("working tree or Git operation changed"),
  );
  expect(ui.success).not.toHaveBeenCalled();
});

test("a conflicting Stash pop keeps the selected stash and reports the working-tree conflict", async () => {
  const git = simpleGit(dir);
  writeFileSync(join(dir, "README.md"), "stashed edit\n");
  await client.stashWithMessage("conflict fixture");
  const selection = (await client.getStashes())[0]!;
  writeFileSync(join(dir, "README.md"), "divergent edit\n");
  await git.commit("make an overlapping edit", ["-a"]);
  const before = await git.revparse(["HEAD"]);
  const ui = createUIMock({
    askSelect: async (prompt) => (prompt === "How to apply?" ? "pop" : "apply"),
    askSearchSelect: async () => selection,
  });
  await new StashManager(client, ui).run();
  expect((await client.getStashes()).map(({ oid }) => oid)).toEqual([selection.oid]);
  expect(await git.revparse(["HEAD"])).toBe(before);
  expect((await git.status()).conflicted).toEqual(["README.md"]);
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining(selection.oid.slice(0, 12)));
  expect(ui.success).not.toHaveBeenCalled();
});

test("drop and pop reject an index reused by a different stash", async () => {
  writeFileSync(join(dir, "README.md"), "first stashed edit");
  await client.stashWithMessage("first");
  const [first] = await client.getStashes();
  writeFileSync(join(dir, "README.md"), "second stashed edit");
  await client.stashWithMessage("second");
  const [second, original] = await client.getStashes();
  expect(original?.oid).toBe(first?.oid);
  expect(second?.oid).not.toBe(first?.oid);
  await expect(client.stashDrop(first!)).rejects.toThrow("stash list changed");
  await expect(client.stashPop(first!)).rejects.toThrow("stash list changed");
  expect((await client.getStashes()).map(({ oid }) => oid)).toEqual([second!.oid, first!.oid]);
  expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("hello");
});

test("Diff separates working, staged, direct-ref and merge-base comparisons", async () => {
  const git = simpleGit(dir);
  const current = await client.getCurrentBranch();
  await git.checkoutLocalBranch("comparison");
  writeFileSync(join(dir, "target.txt"), "target side");
  await git.add("target.txt");
  await git.commit("target change");
  await git.checkout(current);
  writeFileSync(join(dir, "base.txt"), "base side");
  await git.add("base.txt");
  await git.commit("base change");
  writeFileSync(join(dir, "README.md"), "staged only\n");
  await git.add("README.md");
  writeFileSync(join(dir, "README.md"), "working only\n");
  expect(await client.readDiff({ scope: "working" })).toContain("+working only");
  expect(await client.readDiff({ scope: "staged" })).toContain("+staged only");
  const pair = { base: `refs/heads/${current}`, target: "refs/heads/comparison" };
  const direct = await client.readDiff({ scope: "refs", ...pair });
  expect(direct).toContain("-base side");
  expect(direct).toContain("+target side");
  const fromBase = await client.readDiff({ scope: "merge-base", ...pair });
  expect(fromBase).not.toContain("base side");
  expect(fromBase).toContain("+target side");
  await expect(
    client.readDiff({ scope: "refs", base: "refs/heads/absent", target: pair.target }),
  ).rejects.toThrow();
});

test("Log paging stays anchored when HEAD receives a new commit between pages", async () => {
  const git = simpleGit(dir);
  const original = await git.revparse(["HEAD"]);
  await git.raw(["commit", "--allow-empty", "-m", "second"]);
  const first = await client.readLogPage({ limit: 1, offset: 0 });
  expect(first.hasNext).toBe(true);
  expect(first.commits[0]?.hash ?? null).toBe(first.head);
  await git.raw(["commit", "--allow-empty", "-m", "third"]);
  const next = await client.readLogPage({ head: first.head!, limit: 1, offset: 1 });
  expect(next.commits.map(({ hash }) => hash)).toEqual([original]);
  expect(next.hasNext).toBe(false);
  expect(await git.revparse(["HEAD"])).not.toBe(first.head);
});

test("Git history preserves Unicode, body lines, and the exact commit in a diff", async () => {
  const git = simpleGit(dir);
  const before = await git.revparse(["HEAD"]);
  const subject = "feat: café ò and tea";
  const body = "Paragraph with ò accents\n\nReviewed-by: example";
  writeFileSync(join(dir, "README.md"), "new content\n");
  await git.raw(["commit", "-a", "-m", `${subject}\n\n${body}`]);
  const head = await git.revparse(["HEAD"]);
  const logged = await client.getLastCommit();
  expect(logged).toEqual({ hash: head, message: subject, body: `${body}\n` });
  expect(await client.getLogSince(before)).toEqual([logged]);
  expect((await client.readLogPage({ limit: 1, offset: 0 })).commits).toEqual([logged]);
  expect(await client.getCommitDiff(head)).toContain("+new content");
});

test("an unborn checkout has an empty log page and no commit to amend", async () => {
  const root = join(dir, "unborn");
  mkdirSync(root);
  await simpleGit(root).init();
  const empty = createGitClient(root);
  expect(await empty.readLogPage({ limit: 30, offset: 0 })).toEqual({
    head: null,
    commits: [],
    hasNext: false,
  });
  await expect(empty.getLastCommit()).rejects.toThrow();
});

test("Sync publishes the selected commit and records upstream on the chosen remote", async () => {
  const git = simpleGit(dir);
  await git.checkoutLocalBranch("feature/sync");
  for (const remote of ["origin", "review"]) {
    const path = join(dir, ".git", `${remote}.git`);
    await git.raw(["init", "--bare", path]);
    await git.addRemote(remote, path);
  }
  writeFileSync(join(dir, "selected.txt"), "sync this");
  const ui = createUIMock({
    askMultiSelect: async () => ["selected.txt"],
    askText: async () => "commit selected file",
    askSelect: async () => "review",
    askConfirm: async () => true,
  });
  await new SyncFlow(client, ui).run();
  expect(ui.error).not.toHaveBeenCalled();
  const oid = await git.revparse(["HEAD"]);
  expect(await git.revparse(["--abbrev-ref", "@{upstream}"])).toBe("review/feature/sync");
  expect(
    await simpleGit(join(dir, ".git", "review.git")).revparse(["refs/heads/feature/sync"]),
  ).toBe(oid);
  expect(await simpleGit(join(dir, ".git", "origin.git")).raw(["for-each-ref"])).toBe("");
});

test("Sync reports a rejected push with the selected commit still saved locally", async () => {
  const git = simpleGit(dir);
  await git.checkoutLocalBranch("feature/reject");
  const path = join(dir, ".git", "remote.git");
  await git.raw(["init", "--bare", path]);
  await git.addRemote("review", path);
  const reject = join(path, "hooks", "pre-receive");
  writeFileSync(reject, "#!/bin/sh\necho rejected by fixture >&2\nexit 1\n");
  chmodSync(reject, 0o755);
  writeFileSync(join(dir, "selected.txt"), "keep this commit");
  const ui = createUIMock({
    askMultiSelect: async () => ["selected.txt"],
    askText: async () => "selected file",
    askConfirm: async () => true,
  });
  await new SyncFlow(client, ui).run();
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("rejected by fixture"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("saved locally"));
  expect(await git.raw(["show", "HEAD:selected.txt"])).toBe("keep this commit");
  expect(await simpleGit(path).raw(["for-each-ref"])).toBe("");
});

test("Tag publishes the annotated object from the reviewed commit to the selected remote only", async () => {
  const git = simpleGit(dir);
  for (const remote of ["origin", "review"]) {
    const path = join(dir, ".git", `${remote}.git`);
    await git.raw(["init", "--bare", path]);
    await git.addRemote(remote, path);
  }
  const original = await git.revparse(["HEAD"]);
  await git.branch(["v1.2.3"]);
  const ui = createUIMock({
    askText: async (message) => {
      if (message === "Tag name:") return "v1.2.3";
      await git.raw(["commit", "--allow-empty", "-m", "commit after tag preview"]);
      return "reviewed release";
    },
    askSelect: async () => "review",
    askConfirm: async () => true,
  });
  await new TagWizard(client, ui).run();
  const published = simpleGit(join(dir, ".git", "review.git"));
  expect(ui.error).not.toHaveBeenCalled();
  expect(await published.revparse(["refs/tags/v1.2.3^{commit}"])).toBe(original);
  expect(await published.raw(["cat-file", "-t", "refs/tags/v1.2.3"])).toBe("tag\n");
  expect(await simpleGit(join(dir, ".git", "origin.git")).raw(["for-each-ref"])).toBe("");
});

test("Tag refuses a replaced annotation and keeps the remote untouched", async () => {
  const git = simpleGit(dir);
  const path = join(dir, ".git", "remote.git");
  await git.raw(["init", "--bare", path]);
  await git.addRemote("review", path);
  await client.createAnnotatedTag("v1.2.3", "first message");
  const plan = await client.previewTagPush("v1.2.3", "review");
  await git.raw(["tag", "-fa", "v1.2.3", "-m", "new message"]);
  await expect(client.pushTag(plan)).rejects.toThrow("tag or destination changed");
  expect(await simpleGit(path).raw(["for-each-ref"])).toBe("");
  expect(await git.raw(["cat-file", "-p", "refs/tags/v1.2.3"])).toContain("new message");
});

test("Amend refuses staged changes modified after the displayed preview", async () => {
  const git = simpleGit(dir);
  await git.checkoutLocalBranch("feature/amend");
  const before = await git.revparse(["HEAD"]);
  writeFileSync(join(dir, "README.md"), "previewed stage");
  await git.add("README.md");
  const ui = createUIMock({
    askSelect: async () => "both",
    askConfirm: async () => true,
    askText: async () => {
      writeFileSync(join(dir, "README.md"), "stage changed concurrently");
      await git.add("README.md");
      return "updated subject";
    },
  });
  await new AmendFlow(client, ui).run();
  expect(ui.showDiff).toHaveBeenCalledWith(expect.stringContaining("+previewed stage"));
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("differ from the preview"));
  expect(await git.revparse(["HEAD"])).toBe(before);
  expect(await git.raw(["show", ":README.md"])).toBe("stage changed concurrently");
});

test("branch validation uses Git and rejects checkout shorthand as a literal branch name", async () => {
  const git = simpleGit(dir);
  await git.checkoutLocalBranch("previous");
  await git.checkoutLocalBranch("other");
  expect(await client.isValidBranchName("feat/valid")).toBe(true);
  expect(await client.isValidBranchName("feat/bad..name")).toBe(false);
  expect(await client.isValidBranchName("@{-1}")).toBe(false);
});

test("detached HEAD is kept separate from the local branch list", async () => {
  const git = simpleGit(dir);
  const named = await client.getCurrentBranch();
  await git.raw(["checkout", "--detach", "HEAD"]);
  expect(await client.getBranches()).toEqual({ all: [named], current: "" });
});

test("Git paths preserve trailing whitespace in the repository root for a selected commit", async () => {
  const root = join(dir, "checkout trailing whitespace \n");
  mkdirSync(root);
  const git = simpleGit(root);
  await git.raw(["init", "-b", "topic"]);
  await git.addConfig("user.email", "example@example.test");
  await git.addConfig("user.name", "Example");
  const repo = createGitClient(root);
  expect(await repo.getRepositoryRoot()).toBe(realpathSync(root));
  writeFileSync(join(root, "chosen.txt"), "content");
  const selection = await repo.previewSelectedCommit(["chosen.txt"]);
  const oid = await repo.commitSelection(selection, "first commit");
  expect(oid).toBe(await git.revparse(["HEAD"]));
  expect(await git.raw(["show", "HEAD:chosen.txt"])).toBe("content");
});
