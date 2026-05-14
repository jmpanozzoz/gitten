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

test("pulls and shows success on clean fast-forward", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.resolve()),
  });
  const ui = createUIMock();

  await new PullFlow(git, ui).run();

  expect(git.pull).toHaveBeenCalledTimes(1);
  expect(ui.success).toHaveBeenCalled();
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

test("rethrows unexpected pull errors", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("repository not found"))),
  });
  const ui = createUIMock();

  expect(new PullFlow(git, ui).run()).rejects.toThrow("repository not found");
});
