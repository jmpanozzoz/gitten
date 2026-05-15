import { test, expect, mock } from "bun:test";
import { ResetManager } from "../../src/core/reset-manager";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";
import { GoBackSignal } from "../../src/ui/go-back";

// ── discard local changes ──────────────────────────────────────────────────────

test("shows info and returns when working tree is clean (discard action)", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve({ files: [], isClean: () => true })),
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
      Promise.resolve({ files: [{ path: "file.ts", status: "M" }], isClean: () => false })
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
      Promise.resolve({ files: [{ path: "file.ts", status: "M" }], isClean: () => false })
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
      Promise.resolve({ files: [{ path: "file.ts", status: "M" }], isClean: () => false })
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
    "This will discard all local commits and changes not pushed to origin/feat/my-feature."
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

  expect(git.fetchRemote).not.toHaveBeenCalled();
  expect(git.resetHardToRemote).not.toHaveBeenCalled();
});

// ── ESC navigation ─────────────────────────────────────────────────────────────

test("propagates GoBackSignal when user presses ESC on action menu", async () => {
  const git = createGitMock();
  const ui = createUIMock({
    askSelect: mock(() => { throw new GoBackSignal(); }),
  });

  await expect(new ResetManager(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
});
