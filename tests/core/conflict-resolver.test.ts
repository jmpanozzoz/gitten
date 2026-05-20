import { test, expect, mock } from "bun:test";
import { resolveConflict } from "../../src/core/conflict-resolver";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

test("warns with file list when conflicted files exist", async () => {
  const git = createGitMock({
    getConflictedFiles: mock(() => Promise.resolve(["src/app.ts", "src/utils.ts"])),
  });
  const ui = createUIMock();
  const actions = {
    label: "Cherry-pick",
    onContinue: mock(() => Promise.resolve()),
    onAbort: mock(() => Promise.resolve()),
  };

  await resolveConflict(git, ui, actions, () => Promise.resolve(true));

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("src/app.ts"));
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Resolve in your IDE"));
});

test("warns with generic conflict message when no conflicted files reported", async () => {
  const git = createGitMock({
    getConflictedFiles: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();
  const actions = {
    label: "Cherry-pick",
    onContinue: mock(() => Promise.resolve()),
    onAbort: mock(() => Promise.resolve()),
  };

  await resolveConflict(git, ui, actions, () => Promise.resolve(true));

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("conflict detected"));
});

test("calls onContinue and shows success when user presses ENTER", async () => {
  const git = createGitMock({
    getConflictedFiles: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();
  const onContinue = mock(() => Promise.resolve());
  const onAbort = mock(() => Promise.resolve());
  const actions = { label: "Cherry-pick", onContinue, onAbort };

  await resolveConflict(git, ui, actions, () => Promise.resolve(true));

  expect(onContinue).toHaveBeenCalledTimes(1);
  expect(onAbort).not.toHaveBeenCalled();
  expect(ui.success).toHaveBeenCalled();
});

test("calls onAbort and shows info message when user presses ESC", async () => {
  const git = createGitMock({
    getConflictedFiles: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();
  const onContinue = mock(() => Promise.resolve());
  const onAbort = mock(() => Promise.resolve());
  const actions = { label: "Cherry-pick", onContinue, onAbort };

  await resolveConflict(git, ui, actions, () => Promise.resolve(false));

  expect(onAbort).toHaveBeenCalledTimes(1);
  expect(onContinue).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("aborted"));
});

test("calls ui.error and does not propagate when onContinue throws", async () => {
  const git = createGitMock({
    getConflictedFiles: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();
  const onContinue = mock(() => Promise.reject(new Error("continue failed")));
  const onAbort = mock(() => Promise.resolve());
  const actions = { label: "Cherry-pick", onContinue, onAbort };

  await expect(resolveConflict(git, ui, actions, () => Promise.resolve(true))).resolves.toBeUndefined();

  expect(ui.error).toHaveBeenCalled();
});
