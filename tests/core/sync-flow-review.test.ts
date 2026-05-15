import { test, expect, mock } from "bun:test";
import { SyncFlow } from "../../src/core/sync-flow";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const FILES = [{ path: "src/app.ts", status: "M" }];
const DIRTY_STATUS = { files: FILES, isClean: () => false, commitsAhead: 0 };
const SELECT_ALL = { askMultiSelect: mock(() => Promise.resolve(["src/app.ts"])) };

function makeFlow(aiReviewer?: (diff: string) => Promise<string[]>) {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    addFiles: mock(() => Promise.resolve()),
    getStagedDiff: mock(() => Promise.resolve("+const x = 1;")),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    askText: mock(() => Promise.resolve("feat: my commit")),
    askConfirm: mock(() => Promise.resolve(true)),
  });
  return { flow: new SyncFlow(git, ui, undefined, aiReviewer), git, ui };
}

// ─── review not triggered ──────────────────────────────────────────────────────

test("never asks for AI review when no aiReviewer is provided", async () => {
  const { flow, ui } = makeFlow(undefined);

  await flow.run();

  const confirmCalls = (ui.askConfirm as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(confirmCalls.every((msg) => !msg.toLowerCase().includes("review"))).toBe(true);
});

// ─── review offered and accepted ──────────────────────────────────────────────

test("offers AI review when aiReviewer is provided and shows findings as warnings", async () => {
  const aiReviewer = mock(() => Promise.resolve(["Hardcoded value found", "Missing error handling"]));
  const { flow, ui } = makeFlow(aiReviewer);
  (ui.askConfirm as ReturnType<typeof mock>)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true);

  await flow.run();

  expect(aiReviewer).toHaveBeenCalledTimes(1);
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Hardcoded value found"));
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Missing error handling"));
});

test("shows success message when AI review finds no issues", async () => {
  const aiReviewer = mock(() => Promise.resolve([]));
  const { flow, ui } = makeFlow(aiReviewer);
  (ui.askConfirm as ReturnType<typeof mock>)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true);

  await flow.run();

  expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("No issues"));
});

// ─── review declined by user ──────────────────────────────────────────────────

test("skips AI review when user declines the review prompt", async () => {
  const aiReviewer = mock(() => Promise.resolve(["Some issue"]));
  const { flow, ui } = makeFlow(aiReviewer);
  (ui.askConfirm as ReturnType<typeof mock>)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);

  await flow.run();

  expect(aiReviewer).not.toHaveBeenCalled();
  expect(ui.warn).not.toHaveBeenCalledWith(expect.stringContaining("Some issue"));
});

// ─── review proceeds to commit ────────────────────────────────────────────────

test("proceeds to commit after review regardless of findings", async () => {
  const aiReviewer = mock(() => Promise.resolve(["Potential bug on line 5"]));
  const { flow, git, ui } = makeFlow(aiReviewer);
  (ui.askConfirm as ReturnType<typeof mock>)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true);

  await flow.run();

  expect(git.commit).toHaveBeenCalledTimes(1);
});

// ─── review AI failure ────────────────────────────────────────────────────────

test("warns and proceeds when AI reviewer throws", async () => {
  const aiReviewer = mock(() => Promise.reject(new Error("API timeout")));
  const { flow, git, ui } = makeFlow(aiReviewer);
  (ui.askConfirm as ReturnType<typeof mock>)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true);

  await flow.run();

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("API timeout"));
  expect(git.commit).toHaveBeenCalledTimes(1);
});
