import { test, expect, mock } from "bun:test";
import { BranchCleaner } from "../../src/core/branch-cleaner";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const PROTECTED = ["main", "master", "dev", "develop"];

test.each(PROTECTED)('never includes "%s" in candidates', (branch) => {
  const cleaner = new BranchCleaner(createGitMock(), createUIMock());
  const candidates = cleaner.filterCandidates(
    [...PROTECTED, "feat/some-feature"],
    "feat/other"
  );
  expect(candidates).not.toContain(branch);
});

test("never includes current branch in candidates", () => {
  const cleaner = new BranchCleaner(createGitMock(), createUIMock());
  const candidates = cleaner.filterCandidates(
    ["feat/a", "feat/b", "fix/c"],
    "feat/a"
  );
  expect(candidates).not.toContain("feat/a");
  expect(candidates).toContain("feat/b");
  expect(candidates).toContain("fix/c");
});

test("deletes selected local branches", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["feat/old", "fix/typo"], current: "main" })
    ),
    deleteLocalBranchForce: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve(["feat/old", "fix/typo"] as never)),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new BranchCleaner(git, ui).run();

  expect(git.deleteLocalBranchForce).toHaveBeenCalledWith("feat/old");
  expect(git.deleteLocalBranchForce).toHaveBeenCalledWith("fix/typo");
  expect(git.deleteRemoteBranch).not.toHaveBeenCalled();
});

test("also deletes remote branches when confirmed", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["feat/old"], current: "main" })
    ),
    deleteLocalBranchForce: mock(() => Promise.resolve()),
    deleteRemoteBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve(["feat/old"] as never)),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchCleaner(git, ui).run();

  expect(git.deleteRemoteBranch).toHaveBeenCalledWith("feat/old");
});

test("continues deleting remaining branches after a single failure", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["feat/a", "feat/b"], current: "main" })
    ),
    deleteLocalBranchForce: mock()
      .mockRejectedValueOnce(new Error("unmerged"))
      .mockResolvedValueOnce(undefined),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve(["feat/a", "feat/b"] as never)),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new BranchCleaner(git, ui).run();

  expect(git.deleteLocalBranchForce).toHaveBeenCalledTimes(2);
  expect(ui.warn).toHaveBeenCalled();
});

test("shows last activity date in branch label", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["feat/old"], current: "main" })
    ),
    getBranchLastActivity: mock(() => Promise.resolve("3 months ago")),
    deleteLocalBranchForce: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock((_, options) => {
      expect(options[0].label).toContain("3 months ago");
      return Promise.resolve([] as never);
    }),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new BranchCleaner(git, ui).run();

  expect(git.getBranchLastActivity).toHaveBeenCalledWith("feat/old");
});
