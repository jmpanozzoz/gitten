import { test, expect, mock } from "bun:test";
import { UndoCommit } from "../../src/core/undo-commit";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const LAST_COMMIT = { hash: "abc1234", message: "feat: add login page" };

function selectMode(mode: "soft" | "mixed") {
  return { askSelect: mock(() => Promise.resolve(mode)) };
}

// ─── happy paths ─────────────────────────────────────────────────────────────

test("soft reset: calls resetSoft when user confirms", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    resetSoft: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...selectMode("soft"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new UndoCommit(git, ui).run();

  expect(git.resetSoft).toHaveBeenCalledTimes(1);
});

test("mixed reset: calls resetMixed when user confirms", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    resetMixed: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...selectMode("mixed"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new UndoCommit(git, ui).run();

  expect(git.resetMixed).toHaveBeenCalledTimes(1);
});

test("shows last commit info before asking mode", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    resetSoft: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...selectMode("soft"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new UndoCommit(git, ui).run();

  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("abc1234"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("feat: add login page"));
});

// ─── cancellation ─────────────────────────────────────────────────────────────

test("aborts without resetting when user declines confirmation", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    resetSoft: mock(() => Promise.resolve()),
    resetMixed: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...selectMode("soft"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new UndoCommit(git, ui).run();

  expect(git.resetSoft).not.toHaveBeenCalled();
  expect(git.resetMixed).not.toHaveBeenCalled();
});

// ─── error handling ───────────────────────────────────────────────────────────

test("shows error and aborts when repository has no commits", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.reject(new Error("does not have any commits yet"))),
  });
  const ui = createUIMock();

  await new UndoCommit(git, ui).run();

  expect(ui.error).toHaveBeenCalled();
  expect(ui.askSelect).not.toHaveBeenCalled();
});

test("soft reset does not call resetMixed", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    resetSoft: mock(() => Promise.resolve()),
    resetMixed: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...selectMode("soft"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new UndoCommit(git, ui).run();

  expect(git.resetSoft).toHaveBeenCalledTimes(1);
  expect(git.resetMixed).not.toHaveBeenCalled();
});

test("mixed reset does not call resetSoft", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    resetSoft: mock(() => Promise.resolve()),
    resetMixed: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...selectMode("mixed"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new UndoCommit(git, ui).run();

  expect(git.resetMixed).toHaveBeenCalledTimes(1);
  expect(git.resetSoft).not.toHaveBeenCalled();
});
