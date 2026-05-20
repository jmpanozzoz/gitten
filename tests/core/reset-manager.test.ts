import { test, expect, mock } from "bun:test";
import { ResetManager } from "../../src/core/reset-manager";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";
import { GoBackSignal } from "../../src/ui/go-back";

// ── discard local changes ──────────────────────────────────────────────────────

test("shows info and returns when working tree is clean (discard action)", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve({ files: [], isClean: () => true, hasStagedChanges: () => false, commitsAhead: 0, commitsBehind: 0 })),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("discard" as never)),
  });

  await new ResetManager(git, ui).run();

  expect(ui.info).toHaveBeenCalledWith("Working tree is already clean.");
  expect(git.discardLocalChanges).not.toHaveBeenCalled();
});

test("asks confirmation before discarding changes", async () => {
  const git = createGitMock({
    getStatus: mock(() =>
      Promise.resolve({ files: [{ path: "file.ts", status: "M" }], isClean: () => false, hasStagedChanges: () => false, commitsAhead: 0, commitsBehind: 0 })
    ),
    discardLocalChanges: mock(() => Promise.resolve()),
  });
  const askConfirm = mock(() => Promise.resolve(false));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("discard" as never)),
    askConfirm,
  });

  await new ResetManager(git, ui).run();

  expect(askConfirm).toHaveBeenCalledWith(
    "This will permanently discard all uncommitted changes and untracked files."
  );
});

test("discards local changes when user confirms", async () => {
  const git = createGitMock({
    getStatus: mock(() =>
      Promise.resolve({ files: [{ path: "file.ts", status: "M" }], isClean: () => false, hasStagedChanges: () => false, commitsAhead: 0, commitsBehind: 0 })
    ),
    discardLocalChanges: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("discard" as never)),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new ResetManager(git, ui).run();

  expect(git.discardLocalChanges).toHaveBeenCalledTimes(1);
  expect(ui.success).toHaveBeenCalledWith("Working tree is clean.");
});

test("does not discard when user declines confirmation", async () => {
  const git = createGitMock({
    getStatus: mock(() =>
      Promise.resolve({ files: [{ path: "file.ts", status: "M" }], isClean: () => false, hasStagedChanges: () => false, commitsAhead: 0, commitsBehind: 0 })
    ),
    discardLocalChanges: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("discard" as never)),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new ResetManager(git, ui).run();

  expect(git.discardLocalChanges).not.toHaveBeenCalled();
});

// ── reset to remote ────────────────────────────────────────────────────────────

test("asks confirmation before resetting to remote", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("feat/my-feature")),
    fetchRemote: mock(() => Promise.resolve()),
    resetHardToRemote: mock(() => Promise.resolve()),
  });
  const askConfirm = mock(() => Promise.resolve(false));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remote" as never)),
    askConfirm,
  });

  await new ResetManager(git, ui).run();

  expect(askConfirm).toHaveBeenCalledWith(
    "Reset branch 'feat/my-feature' to origin/feat/my-feature? This cannot be undone."
  );
});

test("fetches and resets to remote when user confirms", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("main")),
    fetchRemote: mock(() => Promise.resolve()),
    resetHardToRemote: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remote" as never)),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new ResetManager(git, ui).run();

  expect(git.fetchRemote).toHaveBeenCalledTimes(1);
  expect(git.resetHardToRemote).toHaveBeenCalledWith("main");
  expect(ui.success).toHaveBeenCalledWith("Branch reset to origin/main.");
});

test("does not reset when user declines confirmation", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("main")),
    fetchRemote: mock(() => Promise.resolve()),
    resetHardToRemote: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remote" as never)),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new ResetManager(git, ui).run();

  // fetchRemote is called before confirm to show commits at risk
  expect(git.fetchRemote).toHaveBeenCalledTimes(1);
  expect(git.resetHardToRemote).not.toHaveBeenCalled();
});

test("shows local commits that would be lost before asking confirmation", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("feat/local")),
    fetchRemote: mock(() => Promise.resolve()),
    getLogSince: mock(() => Promise.resolve([
      { hash: "abc1234", message: "feat: unpushed change" },
      { hash: "def5678", message: "fix: also unpushed" },
    ])),
    resetHardToRemote: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remote" as never)),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new ResetManager(git, ui).run();

  const warnCalls = (ui.warn as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(warnCalls.some((m) => m.includes("2 local commit(s)"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("abc1234"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("def5678"))).toBe(true);
});

// ── ESC navigation ─────────────────────────────────────────────────────────────

test("propagates GoBackSignal when user presses ESC on action menu", async () => {
  const git = createGitMock();
  const ui = createUIMock({
    askSelect: mock(() => { throw new GoBackSignal(); }),
  });

  await expect(new ResetManager(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
});

// ─── AI lost commits summary ───────────────────────────────────────────────────

test("summarizes commits to be lost with AI before confirmation", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("feat/test")),
    getLogSince: mock(() => Promise.resolve([
      { hash: "abc", message: "feat: add feature" },
      { hash: "def", message: "fix: patch bug" },
    ])),
    resetHardToRemote: mock(() => Promise.resolve()),
  });
  const aiSummarizer = mock(() => Promise.resolve("• Added new feature\n• Patched a bug"));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remote")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new ResetManager(git, ui, aiSummarizer).run();

  expect(aiSummarizer).toHaveBeenCalledWith(["feat: add feature", "fix: patch bug"]);
  const infoCalls = (ui.info as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(infoCalls.some((m) => m.includes("What will be lost"))).toBe(true);
});

test("skips AI summary when no local commits to lose", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("feat/test")),
    getLogSince: mock(() => Promise.resolve([])),
    resetHardToRemote: mock(() => Promise.resolve()),
  });
  const aiSummarizer = mock(() => Promise.resolve("• something"));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remote")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new ResetManager(git, ui, aiSummarizer).run();

  expect(aiSummarizer).not.toHaveBeenCalled();
});
