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

test("getLog returns commit history for the current branch", async () => {
  const branch = await client.getCurrentBranch();
  const log = await client.getLog(branch, 10);
  expect(log.length).toBeGreaterThan(0);
  expect(log[0].hash.length).toBe(7);
  expect(typeof log[0].message).toBe("string");
});

test("hasIndexLock returns false when no lock file present", async () => {
  expect(await client.hasIndexLock()).toBe(false);
});

test("hasIndexLock returns true when lock file exists", async () => {
  writeFileSync(join(dir, ".git", "index.lock"), "");
  expect(await client.hasIndexLock()).toBe(true);
});
