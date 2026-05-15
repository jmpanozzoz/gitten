import { test, expect, mock } from "bun:test";
import { BranchSwitcher } from "../../src/core/branch-switcher";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const BRANCHES = { all: ["main", "dev", "feat/login", "fix/bug-42"], current: "feat/login" };
const CLEAN = { files: [], isClean: () => true };
const DIRTY = { files: [{ path: "src/app.ts", status: "M" }], isClean: () => false };

// ─── no branches ─────────────────────────────────────────────────────────────

test("shows info and returns when no other branches exist", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main"], current: "main" })),
  });
  const ui = createUIMock();

  await new BranchSwitcher(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(ui.askSelect).not.toHaveBeenCalled();
});

// ─── clean working tree ───────────────────────────────────────────────────────

test("checks out selected branch directly when working tree is clean", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(CLEAN)),
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("main")),
  });

  await new BranchSwitcher(git, ui).run();

  expect(git.checkoutBranch).toHaveBeenCalledWith("main");
  expect(git.stash).not.toHaveBeenCalled();
});

test("excludes current branch from the list", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(CLEAN)),
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("main")),
  });

  await new BranchSwitcher(git, ui).run();

  const options = (ui.askSelect as ReturnType<typeof mock>).mock.calls[0][1] as {
    value: string;
  }[];
  expect(options.some((o) => o.value === "feat/login")).toBe(false);
  expect(options.some((o) => o.value === "main")).toBe(true);
  expect(options.some((o) => o.value === "dev")).toBe(true);
});

test("shows last activity date alongside each branch name", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(CLEAN)),
    getBranchLastActivity: mock(() => Promise.resolve("3 hours ago")),
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("main")),
  });

  await new BranchSwitcher(git, ui).run();

  const options = (ui.askSelect as ReturnType<typeof mock>).mock.calls[0][1] as {
    label: string;
  }[];
  expect(options.every((o) => o.label.includes("3 hours ago"))).toBe(true);
});

// ─── dirty working tree ───────────────────────────────────────────────────────

test("stashes changes and switches when user confirms on dirty tree", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(DIRTY)),
    stash: mock(() => Promise.resolve()),
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("main")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchSwitcher(git, ui).run();

  expect(git.stash).toHaveBeenCalledTimes(1);
  expect(git.checkoutBranch).toHaveBeenCalledWith("main");
});

test("aborts without switching when user declines stash on dirty tree", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(DIRTY)),
    stash: mock(() => Promise.resolve()),
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("main")),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new BranchSwitcher(git, ui).run();

  expect(git.stash).not.toHaveBeenCalled();
  expect(git.checkoutBranch).not.toHaveBeenCalled();
});

test("shows stash hint after switching from dirty tree", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(DIRTY)),
    stash: mock(() => Promise.resolve()),
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("main")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchSwitcher(git, ui).run();

  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("stash"));
});
