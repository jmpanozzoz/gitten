import { test, expect, mock } from "bun:test";
import { PullFlow } from "../../src/core/pull-flow";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const WITH_REMOTE = [{ name: "origin", url: "https://github.com/user/repo.git" }];

test("shows info and returns when no remotes configured", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();

  await new PullFlow(git, ui).run();

  expect(git.pull).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalled();
});

test("shows info when already up to date", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.resolve({ filesChanged: 0 })),
  });
  const ui = createUIMock();

  await new PullFlow(git, ui).run();

  expect(git.pull).toHaveBeenCalledTimes(1);
  expect(ui.info).toHaveBeenCalled();
  expect(ui.success).not.toHaveBeenCalled();
});

test("shows success with file count when new commits pulled", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.resolve({ filesChanged: 3 })),
  });
  const ui = createUIMock();

  await new PullFlow(git, ui).run();

  expect(git.pull).toHaveBeenCalledTimes(1);
  expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("3"));
});

test("shows error when branch has no upstream", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("has no upstream branch"))),
  });
  const ui = createUIMock();

  await new PullFlow(git, ui).run();

  expect(ui.error).toHaveBeenCalled();
  expect(git.mergeAbort).not.toHaveBeenCalled();
});

test("on conflict + ENTER: stages, continues merge and shows success", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("conflict in src/app.ts"))),
    addAll: mock(() => Promise.resolve()),
    mergeContinue: mock(() => Promise.resolve()),
  });
  const ui = createUIMock();
  const waitForResolution = mock(() => Promise.resolve(true));

  await new PullFlow(git, ui, waitForResolution).run();

  expect(git.addAll).toHaveBeenCalledTimes(1);
  expect(git.mergeContinue).toHaveBeenCalledTimes(1);
  expect(git.mergeAbort).not.toHaveBeenCalled();
  expect(ui.success).toHaveBeenCalled();
});

test("on conflict + ESC: aborts merge and shows info", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("automatic merge failed; fix conflicts"))),
    mergeAbort: mock(() => Promise.resolve()),
  });
  const ui = createUIMock();
  const waitForResolution = mock(() => Promise.resolve(false));

  await new PullFlow(git, ui, waitForResolution).run();

  expect(git.mergeAbort).toHaveBeenCalledTimes(1);
  expect(git.addAll).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalled();
});

// ─── conflict file list ───────────────────────────────────────────────────────

test("lists conflicted files by name on merge conflict", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("conflict"))),
    getConflictedFiles: mock(() => Promise.resolve(["src/auth.ts", "src/routes.ts"])),
    mergeAbort: mock(() => Promise.resolve()),
  });
  const ui = createUIMock();
  const waitForResolution = mock(() => Promise.resolve(false));

  await new PullFlow(git, ui, waitForResolution).run();

  const warnCalls = (ui.warn as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(warnCalls.some((m) => m.includes("2 file(s)"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("src/auth.ts"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("src/routes.ts"))).toBe(true);
});

test("shows generic conflict message when no files reported by git", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("conflict"))),
    getConflictedFiles: mock(() => Promise.resolve([])),
    mergeAbort: mock(() => Promise.resolve()),
  });
  const ui = createUIMock();
  const waitForResolution = mock(() => Promise.resolve(false));

  await new PullFlow(git, ui, waitForResolution).run();

  const warnCalls = (ui.warn as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(warnCalls.some((m) => m.includes("detected"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("•"))).toBe(false);
});

test("rethrows unexpected pull errors", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("repository not found"))),
  });
  const ui = createUIMock();

  expect(new PullFlow(git, ui).run()).rejects.toThrow("repository not found");
});

// ─── rebase strategy ─────────────────────────────────────────────────────────

test("calls pullRebase when user selects rebase strategy", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pullRebase: mock(() => Promise.resolve({ filesChanged: 2 })),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("rebase" as never)),
  });

  await new PullFlow(git, ui).run();

  expect(git.pullRebase).toHaveBeenCalledTimes(1);
  expect(git.pull).not.toHaveBeenCalled();
  expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("2"));
});

test("calls pull (merge) when user selects merge strategy", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.resolve({ filesChanged: 1 })),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("merge" as never)),
  });

  await new PullFlow(git, ui).run();

  expect(git.pull).toHaveBeenCalledTimes(1);
  expect(git.pullRebase).not.toHaveBeenCalled();
});
