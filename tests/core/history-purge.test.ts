import { expect, mock, test } from "bun:test";
import { isRepositoryFilePath } from "../../src/core/domain/purge-path";
import { HistoryPurge } from "../../src/core/history-purge";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const TRACKED = ["src/app.ts", ".env", "secrets.json"];

function confirmTwice() {
  return {
    askConfirm: mock().mockResolvedValueOnce(true).mockResolvedValueOnce(true),
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
  expect(ui.askSearchMultiSelect).not.toHaveBeenCalled();
});

test("aborts when working tree has uncommitted changes", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getStatus: mock(() =>
      Promise.resolve({
        files: [{ path: ".env", status: "?" }],
        isClean: () => false,
        hasStagedChanges: () => false,
        commitsAhead: 0,
        commitsBehind: 0,
      }),
    ),
  });
  const ui = createUIMock();

  await new HistoryPurge(git, ui).run();

  expect(ui.error).toHaveBeenCalled();
  expect(ui.askSearchMultiSelect).not.toHaveBeenCalled();
});

test("aborts when no files are selected", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getTrackedFiles: mock(() => Promise.resolve(TRACKED)),
    purgeFromHistory: mock(async () => "/tmp/rewritten.git"),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve([])),
  });

  await new HistoryPurge(git, ui).run();

  expect(git.purgeFromHistory).not.toHaveBeenCalled();
});

// ─── confirmations ────────────────────────────────────────────────────────────

test("aborts without purging when user declines first confirmation", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getTrackedFiles: mock(() => Promise.resolve(TRACKED)),
    purgeFromHistory: mock(async () => "/tmp/rewritten.git"),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve([".env"])),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new HistoryPurge(git, ui).run();

  expect(git.purgeFromHistory).not.toHaveBeenCalled();
});

test("aborts without purging when user declines second confirmation", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getTrackedFiles: mock(() => Promise.resolve(TRACKED)),
    purgeFromHistory: mock(async () => "/tmp/rewritten.git"),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve([".env"])),
    askConfirm: mock().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
  });

  await new HistoryPurge(git, ui).run();

  expect(git.purgeFromHistory).not.toHaveBeenCalled();
});

// ─── happy path ───────────────────────────────────────────────────────────────

test("calls purgeFromHistory with selected files after double confirmation", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getTrackedFiles: mock(() => Promise.resolve(TRACKED)),
    purgeFromHistory: mock(async () => "/tmp/rewritten.git"),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve([".env", "secrets.json"])),
    ...confirmTwice(),
  });

  await new HistoryPurge(git, ui).run();

  expect(git.purgeFromHistory).toHaveBeenCalledTimes(1);
  expect(git.purgeFromHistory).toHaveBeenCalledWith(
    [".env", "secrets.json"],
    ["object refs/heads/main"],
  );
});

test("reports the copy for local inspection after successful purge", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getTrackedFiles: mock(() => Promise.resolve(TRACKED)),
    purgeFromHistory: mock(async () => "/tmp/rewritten.git"),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve([".env"])),
    ...confirmTwice(),
  });

  await new HistoryPurge(git, ui).run();

  expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("/tmp/rewritten.git"));
});

test("shows selected file names in the warning before confirming", async () => {
  const git = createGitMock({
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    getTrackedFiles: mock(() => Promise.resolve(TRACKED)),
    purgeFromHistory: mock(async () => "/tmp/rewritten.git"),
  });
  const ui = createUIMock({
    askSearchMultiSelect: mock(() => Promise.resolve([".env"])),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new HistoryPurge(git, ui).run();

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining(".env"));
});

test("Purge accepts a deleted path, deduplicates it, and quotes paths in the preview", async () => {
  const historical = "old\npath [1].txt";
  const git = createGitMock();
  const ui = createUIMock({
    askSearchMultiSelect: async () => ["", historical],
    askText: async () => historical,
    ...confirmTwice(),
  });
  await new HistoryPurge(git, ui).run();
  expect(git.purgeFromHistory).toHaveBeenCalledWith([historical], ["object refs/heads/main"]);
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining('"old\\npath [1].txt"'));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("rotate them"));
});

test("Purge rejects a historical path when it is invalid, absent, or has no refs to preview", async () => {
  const git = createGitMock({
    describePurge: mock()
      .mockResolvedValueOnce({ refs: ["oid refs/heads/main"], absent: ["old.txt"] })
      .mockResolvedValue({ refs: [], absent: [] }),
  });
  const ui = createUIMock({
    askSearchMultiSelect: async () => [""],
    askText: mock().mockResolvedValueOnce("../elsewhere").mockResolvedValue("old.txt"),
  });
  const flow = new HistoryPurge(git, ui);
  for (let i = 0; i < 3; i++) await flow.run();
  expect(ui.error).toHaveBeenCalledWith("Use an exact path relative to the repository.");
  expect(ui.error).toHaveBeenCalledWith("No history found for: old.txt");
  expect(ui.error).toHaveBeenCalledWith("No refs to rewrite.");
  expect(ui.askConfirm).not.toHaveBeenCalled();
  expect(git.purgeFromHistory).not.toHaveBeenCalled();
});

test("repository file paths preserve literal names and reject ambiguous path syntax", () => {
  for (const path of ["-old [1].txt", "nested/café.txt", "a\\b", ":!literal"]) {
    expect(isRepositoryFilePath(path)).toBe(true);
  }
  for (const path of [
    "",
    ".",
    "a/../b",
    "a/./b",
    "/etc",
    "folder//file",
    "folder/",
    "C:/page",
    "C:\\page",
    "\\\\share\\file",
    "a\0b",
  ]) {
    expect(isRepositoryFilePath(path)).toBe(false);
  }
});
