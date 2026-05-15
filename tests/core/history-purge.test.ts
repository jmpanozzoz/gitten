import { test, expect, mock } from "bun:test";
import { HistoryPurge } from "../../src/core/history-purge";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const TRACKED = ["src/app.ts", ".env", "secrets.json"];

function confirmTwice() {
  return {
    askConfirm: mock()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true),
  };
}

// ─── preconditions ────────────────────────────────────────────────────────────

test("aborts with instructions when git filter-repo is not installed", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(false)),
  });
  const ui = createUIMock();

  await new HistoryPurge(git, ui).run();

  expect(ui.error).toHaveBeenCalled();
  expect(ui.askMultiSelect).not.toHaveBeenCalled();
});

test("aborts when working tree has uncommitted changes", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getStatus: mock(() =>
      Promise.resolve({ files: [{ path: ".env", status: "?" }], isClean: () => false })
    ),
  });
  const ui = createUIMock();

  await new HistoryPurge(git, ui).run();

  expect(ui.error).toHaveBeenCalled();
  expect(ui.askMultiSelect).not.toHaveBeenCalled();
});

test("aborts when no files are selected", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getTrackedFiles: mock(() => Promise.resolve(TRACKED)),
    purgeFromHistory: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askMultiSelect: mock(() => Promise.resolve([])),
  });

  await new HistoryPurge(git, ui).run();

  expect(git.purgeFromHistory).not.toHaveBeenCalled();
});

// ─── confirmations ────────────────────────────────────────────────────────────

test("aborts without purging when user declines first confirmation", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getTrackedFiles: mock(() => Promise.resolve(TRACKED)),
    purgeFromHistory: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askMultiSelect: mock(() => Promise.resolve([".env"])),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new HistoryPurge(git, ui).run();

  expect(git.purgeFromHistory).not.toHaveBeenCalled();
});

test("aborts without purging when user declines second confirmation", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getTrackedFiles: mock(() => Promise.resolve(TRACKED)),
    purgeFromHistory: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askMultiSelect: mock(() => Promise.resolve([".env"])),
    askConfirm: mock()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false),
  });

  await new HistoryPurge(git, ui).run();

  expect(git.purgeFromHistory).not.toHaveBeenCalled();
});

// ─── happy path ───────────────────────────────────────────────────────────────

test("calls purgeFromHistory with selected files after double confirmation", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getTrackedFiles: mock(() => Promise.resolve(TRACKED)),
    purgeFromHistory: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askMultiSelect: mock(() => Promise.resolve([".env", "secrets.json"])),
    ...confirmTwice(),
  });

  await new HistoryPurge(git, ui).run();

  expect(git.purgeFromHistory).toHaveBeenCalledTimes(1);
  expect(git.purgeFromHistory).toHaveBeenCalledWith([".env", "secrets.json"]);
});

test("shows force-push reminder after successful purge", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getTrackedFiles: mock(() => Promise.resolve(TRACKED)),
    purgeFromHistory: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askMultiSelect: mock(() => Promise.resolve([".env"])),
    ...confirmTwice(),
  });

  await new HistoryPurge(git, ui).run();

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("force"));
});

test("shows selected file names in the warning before confirming", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getTrackedFiles: mock(() => Promise.resolve(TRACKED)),
    purgeFromHistory: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askMultiSelect: mock(() => Promise.resolve([".env"])),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new HistoryPurge(git, ui).run();

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining(".env"));
});
