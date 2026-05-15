import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { GitClient } from "../../src/git/git-client";

let dir: string;
let client: GitClient;

async function seedRepo() {
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test");
  writeFileSync(join(dir, "README.md"), "hello");
  await git.add(".");
  await git.commit("chore: initial commit");
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gitten-integration-"));
  client = new GitClient(dir);
  await seedRepo();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ─── repo detection ───────────────────────────────────────────────────────────

test("checkIsRepo returns true for a git repo", async () => {
  expect(await client.checkIsRepo()).toBe(true);
});

test("checkIsRepo returns false for a plain directory", async () => {
  const plain = mkdtempSync(join(tmpdir(), "gitten-plain-"));
  try {
    expect(await new GitClient(plain).checkIsRepo()).toBe(false);
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

test("getStatus is clean after addAll and commit", async () => {
  writeFileSync(join(dir, "new-file.txt"), "content");
  await client.addAll();
  await client.commit("test: add new-file");
  const status = await client.getStatus();
  expect(status.isClean()).toBe(true);
});

test("getStatus.commitsAhead is 0 on a fresh local branch with no remote", async () => {
  const status = await client.getStatus();
  expect(status.commitsAhead).toBe(0);
});

// ─── staging ──────────────────────────────────────────────────────────────────

test("addFiles stages only the specified files", async () => {
  writeFileSync(join(dir, "a.txt"), "a");
  writeFileSync(join(dir, "b.txt"), "b");
  await client.addFiles(["a.txt"]);
  const git = simpleGit(dir);
  const st = await git.status();
  expect(st.staged).toContain("a.txt");
  expect(st.staged).not.toContain("b.txt");
});

// ─── diff ─────────────────────────────────────────────────────────────────────

test("getDiffStat returns insertions and deletions after staging", async () => {
  writeFileSync(join(dir, "README.md"), "line1\nline2\nline3");
  await client.addAll();
  const stat = await client.getDiffStat();
  expect(stat.insertions).toBeGreaterThan(0);
});

// ─── commit log ───────────────────────────────────────────────────────────────

test("getLog returns commit history for the current branch", async () => {
  const branch = await client.getCurrentBranch();
  const log = await client.getLog(branch, 10);
  expect(log.length).toBeGreaterThan(0);
  expect(log[0].hash.length).toBe(7);
  expect(typeof log[0].message).toBe("string");
});

test("getLastCommit returns the most recent commit", async () => {
  const commit = await client.getLastCommit();
  expect(commit.hash.length).toBe(7);
  expect(commit.message).toBe("chore: initial commit");
});

// ─── reset ────────────────────────────────────────────────────────────────────

test("resetSoft(1) unstages last commit but keeps changes staged", async () => {
  writeFileSync(join(dir, "new.txt"), "content");
  await client.addAll();
  await client.commit("test: second commit");

  await client.resetSoft(1);

  const git = simpleGit(dir);
  const st = await git.status();
  expect(st.staged.length).toBeGreaterThan(0);
});

test("resetMixed(1) unstages last commit leaving changes in working tree", async () => {
  writeFileSync(join(dir, "new.txt"), "content");
  await client.addAll();
  await client.commit("test: second commit");

  await client.resetMixed(1);

  const git = simpleGit(dir);
  const st = await git.status();
  expect(st.staged.length).toBe(0);
  expect(st.files.length).toBeGreaterThan(0);
});

test("resetSoft(2) undoes last two commits keeping both sets of changes staged", async () => {
  writeFileSync(join(dir, "b.txt"), "b");
  await client.addAll();
  await client.commit("test: second");
  writeFileSync(join(dir, "c.txt"), "c");
  await client.addAll();
  await client.commit("test: third");

  await client.resetSoft(2);

  const branch = await client.getCurrentBranch();
  const log = await client.getLog(branch, 10);
  expect(log.length).toBe(1);
  expect(log[0].message).toBe("chore: initial commit");
  const git = simpleGit(dir);
  const st = await git.status();
  expect(st.staged.length).toBeGreaterThan(0);
});

// ─── discard ──────────────────────────────────────────────────────────────────

test("discardLocalChanges removes uncommitted modifications and untracked files", async () => {
  writeFileSync(join(dir, "README.md"), "dirty change");
  writeFileSync(join(dir, "untracked.txt"), "new file");

  await client.discardLocalChanges();

  const status = await client.getStatus();
  expect(status.isClean()).toBe(true);
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
  expect(stashes[0].message).toContain("my work");
});

test("stashPop applies stash and removes it from the list", async () => {
  writeFileSync(join(dir, "README.md"), "stashed");
  await client.stashWithMessage("pop me");
  await client.stashPop(0);

  expect((await client.getStatus()).isClean()).toBe(false);
  expect((await client.getStashes()).length).toBe(0);
});

test("stashDrop removes stash without applying it", async () => {
  writeFileSync(join(dir, "README.md"), "stashed");
  await client.stashWithMessage("drop me");
  await client.stashDrop(0);

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

// ─── index lock ───────────────────────────────────────────────────────────────

test("hasIndexLock returns false when no lock file present", async () => {
  expect(await client.hasIndexLock()).toBe(false);
});

test("hasIndexLock returns true when lock file exists", async () => {
  writeFileSync(join(dir, ".git", "index.lock"), "");
  expect(await client.hasIndexLock()).toBe(true);
});
