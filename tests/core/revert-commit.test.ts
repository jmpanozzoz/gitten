import { expect, mock, test } from "bun:test";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { RevertCommit } from "../../src/core/revert-commit";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const COMMITS = [
  { hash: "abc1234", message: "feat: add login" },
  { hash: "def5678", message: "fix: header typo" },
];

test("resumes a pending revert without asking for or reverting another commit", async () => {
  const git = createGitMock({ getInProgressOperation: async () => "revert" });
  const ui = createUIMock({ waitForConflictResolution: async () => true });
  await new RevertCommit(git, ui).run();
  expect(git.revertContinue).toHaveBeenCalledTimes(1);
  expect(git.revertCommit).not.toHaveBeenCalled();
  expect(ui.success).toHaveBeenCalledWith("Revert completed.");
});

test("keeps other pending operations untouched and reports non-conflict revert failures", async () => {
  const busy = createGitMock({ getInProgressOperation: async () => "merge" });
  const ui = createUIMock({
    askSearchSelect: async () => "abc1234",
    askConfirm: async () => true,
  });
  await new RevertCommit(busy, ui).run();
  expect(ui.warn).toHaveBeenCalledWith("Finish the pending merge before reverting.");
  expect(busy.revertCommit).not.toHaveBeenCalled();

  const git = createGitMock({
    getLog: async () => COMMITS,
    revertCommit: async () => {
      throw new Error("cannot create revert commit");
    },
  });
  await expect(new RevertCommit(git, ui).run()).rejects.toThrow("cannot create revert commit");
  expect(git.revertAbort).not.toHaveBeenCalled();
  expect(ui.success).not.toHaveBeenCalled();
});

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
    getInProgressOperation: mock().mockResolvedValueOnce(null).mockResolvedValue("revert"),
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

  await new RevertCommit(git, ui, { waitForResolution }).run();

  expect(git.revertAbort).toHaveBeenCalledTimes(1);
});

test("calls revertContinue when conflict is resolved and user presses ENTER", async () => {
  const git = createGitMock({
    getInProgressOperation: mock().mockResolvedValueOnce(null).mockResolvedValue("revert"),
    getLog: mock(() => Promise.resolve(COMMITS)),
    revertCommit: mock(() => Promise.reject(new Error("conflict"))),
    getConflictedFiles: mock().mockResolvedValueOnce(["src/app.ts"]).mockResolvedValueOnce([]),
    revertContinue: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("abc1234")),
    askConfirm: mock(() => Promise.resolve(true)),
  });
  const waitForResolution = mock(() => Promise.resolve(true)); // ENTER

  await new RevertCommit(git, ui, { waitForResolution }).run();

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
