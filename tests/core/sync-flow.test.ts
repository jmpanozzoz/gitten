import { test, expect, mock } from "bun:test";
import { SyncFlow } from "../../src/core/sync-flow";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const FILES = [
  { path: "src/app.ts", status: "M" },
  { path: ".env", status: "?" },
];
const DIRTY_STATUS = { files: FILES, isClean: () => false };
const CLEAN_STATUS = { files: [], isClean: () => true };
const CONFIRM_YES = { askConfirm: mock(() => Promise.resolve(true)) };
const CONFIRM_NO = { askConfirm: mock(() => Promise.resolve(false)) };
const SELECT_ALL = { askMultiSelect: mock(() => Promise.resolve(["src/app.ts", ".env"])) };
const SELECT_NONE = { askMultiSelect: mock(() => Promise.resolve([])) };

// ─── dirty working tree ───────────────────────────────────────────────────────

test("stages, commits and pushes selected files when user confirms push", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    addFiles: mock(() => Promise.resolve()),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    ...CONFIRM_YES,
    askText: mock(() => Promise.resolve("feat: my commit")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.addFiles).toHaveBeenCalledWith(["src/app.ts", ".env"]);
  expect(git.commit).toHaveBeenCalledWith("feat: my commit");
  expect(git.push).toHaveBeenCalledTimes(1);
});

test("commits without pushing when user declines push", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    addFiles: mock(() => Promise.resolve()),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    ...CONFIRM_NO,
    askText: mock(() => Promise.resolve("feat: local only")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.commit).toHaveBeenCalledTimes(1);
  expect(git.push).not.toHaveBeenCalled();
});

test("stages only the files the user selects", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    addFiles: mock(() => Promise.resolve()),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askMultiSelect: mock(() => Promise.resolve(["src/app.ts"])),
    askConfirm: mock(() => Promise.resolve(true)),
    askText: mock(() => Promise.resolve("fix: partial stage")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.addFiles).toHaveBeenCalledWith(["src/app.ts"]);
  expect(git.commit).toHaveBeenCalledTimes(1);
});

test("aborts without staging when user selects no files", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    addFiles: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({ ...SELECT_NONE });

  await new SyncFlow(git, ui).run();

  expect(git.addFiles).not.toHaveBeenCalled();
  expect(git.commit).not.toHaveBeenCalled();
  expect(git.push).not.toHaveBeenCalled();
});

test("shows file paths with their status in the multiselect", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    addFiles: mock(() => Promise.resolve()),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    askText: mock(() => Promise.resolve("chore: update")),
  });

  await new SyncFlow(git, ui).run();

  const options = (ui.askMultiSelect as ReturnType<typeof mock>).mock.calls[0][1] as {
    value: string;
    label: string;
  }[];
  expect(options.some((o) => o.label.includes("M") && o.label.includes("src/app.ts"))).toBe(true);
  expect(options.some((o) => o.label.includes("?") && o.label.includes(".env"))).toBe(true);
});

test("uses default commit message when input is empty", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    addFiles: mock(() => Promise.resolve()),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    ...CONFIRM_YES,
    askText: mock(() => Promise.resolve("")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.commit).toHaveBeenCalledWith("chore: update");
});

test("shows diff stat summary after staging", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    addFiles: mock(() => Promise.resolve()),
    getDiffStat: mock(() => Promise.resolve({ insertions: 42, deletions: 7 })),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    ...CONFIRM_YES,
    askText: mock(() => Promise.resolve("feat: stats")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.getDiffStat).toHaveBeenCalledTimes(1);
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("42"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("7"));
});

// ─── clean working tree ───────────────────────────────────────────────────────

test("skips staging and commit when working tree is clean", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS_AHEAD)),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({ ...CONFIRM_YES });

  await new SyncFlow(git, ui).run();

  expect(git.addFiles).not.toHaveBeenCalled();
  expect(git.commit).not.toHaveBeenCalled();
  expect(git.push).toHaveBeenCalledTimes(1);
});

test("returns early without pushing when user declines on clean tree", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS)),
  });
  const ui = createUIMock({
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new SyncFlow(git, ui).run();

  expect(git.push).not.toHaveBeenCalled();
});

// ─── push error handling ──────────────────────────────────────────────────────

test("retries with upstream flag when push has no upstream", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS_AHEAD)),
    push: mock()
      .mockRejectedValueOnce(new Error("has no upstream"))
      .mockResolvedValueOnce(undefined),
  });
  const ui = createUIMock({ ...CONFIRM_YES });

  await new SyncFlow(git, ui).run();

  expect(git.push).toHaveBeenCalledTimes(2);
  expect(git.push).toHaveBeenLastCalledWith(true);
});

test("shows error and aborts when push is rejected due to remote changes", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS_AHEAD)),
    push: mock(() => Promise.reject(new Error("rejected — fetch first"))),
  });
  const ui = createUIMock({ ...CONFIRM_YES });

  await new SyncFlow(git, ui).run();

  expect(ui.error).toHaveBeenCalled();
  expect(git.push).toHaveBeenCalledTimes(1);
});

test("rethrows unexpected push errors", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS_AHEAD)),
    push: mock(() => Promise.reject(new Error("permission denied (publickey)"))),
  });
  const ui = createUIMock({ ...CONFIRM_YES });

  expect(new SyncFlow(git, ui).run()).rejects.toThrow("permission denied");
});

// ─── already up to date ───────────────────────────────────────────────────────

test("shows info and returns when working tree is clean and branch is up to date", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS)),
  });
  const ui = createUIMock();

  await new SyncFlow(git, ui).run();

  expect(ui.info).toHaveBeenCalledWith("Already up to date — nothing to commit or push.");
  expect(ui.askConfirm).not.toHaveBeenCalled();
  expect(git.push).not.toHaveBeenCalled();
});

test("asks to push when working tree is clean but branch has commits ahead", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS_AHEAD)),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({ ...CONFIRM_YES });

  await new SyncFlow(git, ui).run();

  expect(ui.askConfirm).toHaveBeenCalledWith("Nothing to commit. Push current branch?");
  expect(git.push).toHaveBeenCalledTimes(1);
});
