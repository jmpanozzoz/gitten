import { test, expect, mock } from "bun:test";
import { SyncFlow } from "../../src/core/sync-flow";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const DIRTY_STATUS = { files: [{ path: "src/app.ts" }], isClean: () => false };
const CLEAN_STATUS = { files: [], isClean: () => true };
const CONFIRM_YES = { askConfirm: mock(() => Promise.resolve(true)) };

test("stages, commits and pushes when working tree is dirty", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    addAll: mock(() => Promise.resolve()),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...CONFIRM_YES,
    askText: mock(() => Promise.resolve("feat: my commit")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.addAll).toHaveBeenCalledTimes(1);
  expect(git.commit).toHaveBeenCalledWith("feat: my commit");
  expect(git.push).toHaveBeenCalledTimes(1);
});

test("shows diff stat summary after staging", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    addAll: mock(() => Promise.resolve()),
    getDiffStat: mock(() => Promise.resolve({ insertions: 42, deletions: 7 })),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...CONFIRM_YES,
    askText: mock(() => Promise.resolve("feat: my commit")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.getDiffStat).toHaveBeenCalledTimes(1);
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("42"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("7"));
});

test("uses default commit message when input is empty", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    addAll: mock(() => Promise.resolve()),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...CONFIRM_YES,
    askText: mock(() => Promise.resolve("")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.commit).toHaveBeenCalledWith("chore: update");
});

test("skips staging and commit when working tree is clean", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS)),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({ ...CONFIRM_YES });

  await new SyncFlow(git, ui).run();

  expect(git.addAll).not.toHaveBeenCalled();
  expect(git.commit).not.toHaveBeenCalled();
  expect(git.push).toHaveBeenCalledTimes(1);
});

test("returns early without pushing when user declines", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
  });
  const ui = createUIMock({
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new SyncFlow(git, ui).run();

  expect(git.addAll).not.toHaveBeenCalled();
  expect(git.push).not.toHaveBeenCalled();
});

test("retries with upstream flag when push has no upstream", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS)),
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
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS)),
    push: mock(() => Promise.reject(new Error("rejected — fetch first"))),
  });
  const ui = createUIMock({ ...CONFIRM_YES });

  await new SyncFlow(git, ui).run();

  expect(ui.error).toHaveBeenCalled();
  expect(git.push).toHaveBeenCalledTimes(1);
});

test("rethrows unexpected push errors", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS)),
    push: mock(() => Promise.reject(new Error("permission denied (publickey)"))),
  });
  const ui = createUIMock({ ...CONFIRM_YES });

  expect(new SyncFlow(git, ui).run()).rejects.toThrow("permission denied");
});
