import { test, expect, mock } from "bun:test";
import { BranchCleaner } from "../../src/core/branch-cleaner";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const PROTECTED = ["main", "master", "dev", "develop"];

// ─── branch filtering ─────────────────────────────────────────────────────────

test("includes protected branches in candidates (shown with extra confirm)", () => {
  const cleaner = new BranchCleaner(createGitMock(), createUIMock());
  const candidates = cleaner.filterCandidates(
    [...PROTECTED, "feat/some-feature"],
    "feat/other"
  );
  for (const branch of PROTECTED) {
    expect(candidates).toContain(branch);
  }
  expect(candidates).toContain("feat/some-feature");
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

// ─── local branch deletion ────────────────────────────────────────────────────

test("uses force delete for local branches", async () => {
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

test("continues deleting remaining branches after a single local failure", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["feat/a", "feat/b"], current: "main" })
    ),
    deleteLocalBranchForce: mock()
      .mockRejectedValueOnce(new Error("not found"))
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

// ─── remote-only branches ─────────────────────────────────────────────────────

test("shows remote-only branches with [remote only] label", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["feat/local"], current: "main" })
    ),
    getRemoteBranches: mock(() => Promise.resolve(["feat/local", "feat/remote-only"])),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock((_, options: { value: string; label: string }[]) => {
      const remoteOption = options.find((o) => o.value === "remote:feat/remote-only");
      expect(remoteOption?.label).toContain("[remote only]");
      return Promise.resolve([] as never);
    }),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new BranchCleaner(git, ui).run();
});

test("deletes remote-only branch from origin without asking", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: [], current: "main" })
    ),
    getRemoteBranches: mock(() => Promise.resolve(["feat/orphan"])),
    deleteRemoteBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve(["remote:feat/orphan"] as never)),
  });

  await new BranchCleaner(git, ui).run();

  expect(git.deleteRemoteBranch).toHaveBeenCalledWith("feat/orphan");
  expect(git.deleteLocalBranchForce).not.toHaveBeenCalled();
  expect(ui.askConfirm).not.toHaveBeenCalled();
});

test("shows protected branches in remote-only list (no longer filtered out)", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: [], current: "dev" })
    ),
    getRemoteBranches: mock(() =>
      Promise.resolve(["main", "master", "feat/ok"])
    ),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock((_, options: { value: string; label: string }[]) => {
      const values = options.map((o) => o.value);
      expect(values).toContain("remote:main");
      expect(values).toContain("remote:master");
      expect(values).toContain("remote:feat/ok");
      return Promise.resolve([] as never);
    }),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new BranchCleaner(git, ui).run();
});

// ─── protected branch extra confirmation ─────────────────────────────────────

test("asks extra confirmation when a protected branch is selected", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/old"], current: "feat/old" })
    ),
    deleteLocalBranchForce: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve(["main"] as never)),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchCleaner(git, ui).run();

  const confirmCalls = (ui.askConfirm as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(confirmCalls.some((msg) => msg.includes("main") && msg.includes("protected"))).toBe(true);
});

test("aborts deletion when user declines protected branch confirmation", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/old"], current: "feat/old" })
    ),
    deleteLocalBranchForce: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve(["main"] as never)),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new BranchCleaner(git, ui).run();

  expect(git.deleteLocalBranchForce).not.toHaveBeenCalled();
});

test("skips extra confirm when no protected branches are selected", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["feat/old", "feat/another"], current: "main" })
    ),
    deleteLocalBranchForce: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve(["feat/old"] as never)),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new BranchCleaner(git, ui).run();

  const confirmCalls = (ui.askConfirm as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(confirmCalls.every((msg) => !msg.includes("protected"))).toBe(true);
});

// ─── activity label ───────────────────────────────────────────────────────────

test("shows last activity date in branch label", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["feat/old"], current: "main" })
    ),
    getBranchLastActivity: mock(() => Promise.resolve("3 months ago")),
    deleteLocalBranchForce: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock((_, options: { value: string; label: string }[]) => {
      expect(options[0].label).toContain("3 months ago");
      return Promise.resolve([] as never);
    }),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new BranchCleaner(git, ui).run();

  expect(git.getBranchLastActivity).toHaveBeenCalledWith("feat/old");
});
