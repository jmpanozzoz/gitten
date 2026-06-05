import { expect, mock, test } from "bun:test";
import { RevertCommit } from "../../src/core/revert-commit";
import { GoBackSignal } from "../../src/ui/go-back";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

mock.module("../../src/config/config", () => ({
  readConfig: mock(() => Promise.resolve({})),
  // Faithful to the real getLimits (defaults ⊕ config.limits) — Bun applies this
  // module mock process-wide, so a fixed stub would corrupt other suites.
  getLimits: (config: { limits?: Record<string, number> }) => ({
    undoCommitLimit: 10,
    cherryPickLogLimit: 30,
    bisectLogLimit: 30,
    revertLogLimit: 30,
    ...(config?.limits ?? {}),
  }),
}));

const COMMITS = [
  { hash: "abc1234", message: "feat: add login" },
  { hash: "def5678", message: "fix: header typo" },
];

// ─── happy path ───────────────────────────────────────────────────────────────

test("calls revertCommit with selected hash and shows success", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    revertCommit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("abc1234")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new RevertCommit(git, ui).run();

  expect(git.revertCommit).toHaveBeenCalledWith("abc1234");
  expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("feat: add login"));
});

// ─── abort on confirm ─────────────────────────────────────────────────────────

test("aborts without reverting when user declines confirmation", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    revertCommit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("abc1234")),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new RevertCommit(git, ui).run();

  expect(git.revertCommit).not.toHaveBeenCalled();
});

// ─── empty repo ───────────────────────────────────────────────────────────────

test("shows info and returns when there are no commits", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();

  await new RevertCommit(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(git.revertCommit).not.toHaveBeenCalled();
});

// ─── protected branch ────────────────────────────────────────────────────────

test("warns and aborts when on a protected branch and user declines", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("main")),
  });
  const ui = createUIMock({ askConfirm: mock(() => Promise.resolve(false)) });

  await new RevertCommit(git, ui).run();

  expect(ui.askConfirm).toHaveBeenCalledWith(expect.stringContaining("main"));
  expect(git.revertCommit).not.toHaveBeenCalled();
});

test("proceeds when on a protected branch and user confirms", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("main")),
    getLog: mock(() => Promise.resolve(COMMITS)),
    revertCommit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("abc1234")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new RevertCommit(git, ui).run();

  expect(git.revertCommit).toHaveBeenCalledWith("abc1234");
});

// ─── conflict handling ────────────────────────────────────────────────────────

test("calls revertAbort when conflict occurs and user presses ESC", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    revertCommit: mock(() => Promise.reject(new Error("conflict"))),
    getConflictedFiles: mock(() => Promise.resolve(["src/app.ts"])),
    revertAbort: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("abc1234")),
    askConfirm: mock(() => Promise.resolve(true)),
  });
  const waitForResolution = mock(() => Promise.resolve(false)); // ESC

  await new RevertCommit(git, ui, waitForResolution).run();

  expect(git.revertAbort).toHaveBeenCalledTimes(1);
});

test("calls revertContinue when conflict is resolved and user presses ENTER", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    revertCommit: mock(() => Promise.reject(new Error("conflict"))),
    getConflictedFiles: mock(() => Promise.resolve(["src/app.ts"])),
    revertContinue: mock(() => Promise.resolve()),
    addAll: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("abc1234")),
    askConfirm: mock(() => Promise.resolve(true)),
  });
  const waitForResolution = mock(() => Promise.resolve(true)); // ENTER

  await new RevertCommit(git, ui, waitForResolution).run();

  expect(git.addAll).toHaveBeenCalled();
  expect(git.revertContinue).toHaveBeenCalledTimes(1);
});

// ─── cancellation ─────────────────────────────────────────────────────────────

test("propagates GoBackSignal when user presses ESC on commit select", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.reject(new GoBackSignal())),
  });

  await expect(new RevertCommit(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
});
