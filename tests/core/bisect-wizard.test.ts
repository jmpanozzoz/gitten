import { test, expect, mock } from "bun:test";
import { BisectWizard } from "../../src/core/bisect-wizard";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const COMMITS = [
  { hash: "abc1234", message: "feat: add login" },
  { hash: "def5678", message: "fix: fix redirect" },
  { hash: "ghi9012", message: "chore: update deps" },
];
const NOT_DONE: import("../../src/core/ports/git-client.port").BisectResult = { done: false };
const DONE: import("../../src/core/ports/git-client.port").BisectResult = {
  done: true,
  badCommit: { hash: "abc1234", message: "feat: add login" },
};

// ─── setup ────────────────────────────────────────────────────────────────────

test("starts bisect with bad=HEAD and good=selected commit", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    bisectStart: mock(() => Promise.resolve()),
    bisectBad: mock(() => Promise.resolve(DONE)),
    bisectGood: mock(() => Promise.resolve(NOT_DONE)),
    bisectReset: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("def5678")),
    askSelect: mock(() => Promise.resolve("stop")),
  });

  await new BisectWizard(git, ui).run();

  expect(git.bisectStart).toHaveBeenCalledTimes(1);
  expect(git.bisectBad).toHaveBeenCalledWith(undefined);
  expect(git.bisectGood).toHaveBeenCalledWith("def5678");
});

// ─── loop navigation ──────────────────────────────────────────────────────────

test("calls bisectBad when user marks current commit as bad", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    bisectStart: mock(() => Promise.resolve()),
    bisectBad: mock()
      .mockResolvedValueOnce(NOT_DONE)
      .mockResolvedValueOnce(DONE),
    bisectGood: mock(() => Promise.resolve(NOT_DONE)),
    bisectReset: mock(() => Promise.resolve()),
    getLastCommit: mock(() => Promise.resolve({ hash: "abc1234", message: "feat: add login" })),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("def5678")),
    askSelect: mock(() => Promise.resolve("bad")),
  });

  await new BisectWizard(git, ui).run();

  expect(git.bisectBad).toHaveBeenCalledTimes(2);
});

test("calls bisectGood when user marks current commit as good", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    bisectStart: mock(() => Promise.resolve()),
    bisectBad: mock(() => Promise.resolve(NOT_DONE)),
    bisectGood: mock()
      .mockResolvedValueOnce(NOT_DONE)
      .mockResolvedValueOnce(DONE),
    bisectReset: mock(() => Promise.resolve()),
    getLastCommit: mock(() => Promise.resolve({ hash: "abc1234", message: "feat: add login" })),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("def5678")),
    askSelect: mock(() => Promise.resolve("good")),
  });

  await new BisectWizard(git, ui).run();

  expect(git.bisectGood).toHaveBeenCalledTimes(2);
});

// ─── stop ─────────────────────────────────────────────────────────────────────

test("calls bisectReset when user stops", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    bisectStart: mock(() => Promise.resolve()),
    bisectBad: mock(() => Promise.resolve(NOT_DONE)),
    bisectGood: mock(() => Promise.resolve(NOT_DONE)),
    bisectReset: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("def5678")),
    askSelect: mock(() => Promise.resolve("stop")),
  });

  await new BisectWizard(git, ui).run();

  expect(git.bisectReset).toHaveBeenCalledTimes(1);
});

// ─── result display ───────────────────────────────────────────────────────────

test("shows culprit commit when bisect completes", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    bisectStart: mock(() => Promise.resolve()),
    bisectBad: mock(() => Promise.resolve(NOT_DONE)),
    bisectGood: mock(() => Promise.resolve(DONE)),
    bisectReset: mock(() => Promise.resolve()),
    getLastCommit: mock(() => Promise.resolve({ hash: "abc1234", message: "feat: add login" })),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("def5678")),
    askSelect: mock(() => Promise.resolve("good")),
  });

  await new BisectWizard(git, ui).run();

  expect(ui.success).toHaveBeenCalledWith(
    expect.stringContaining("abc1234")
  );
  expect(git.bisectReset).toHaveBeenCalledTimes(1);
});

// ─── no commits ───────────────────────────────────────────────────────────────

test("aborts early when no commits are available", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve([])),
    bisectStart: mock(() => Promise.resolve()),
  });
  const ui = createUIMock();

  await new BisectWizard(git, ui).run();

  expect(git.bisectStart).not.toHaveBeenCalled();
  expect(ui.warn).toHaveBeenCalled();
});

// ─── error handling ───────────────────────────────────────────────────────────

test("resets bisect and shows error when bisectBad fails during loop", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    bisectStart: mock(() => Promise.resolve()),
    bisectBad: mock()
      .mockResolvedValueOnce(NOT_DONE)
      .mockRejectedValueOnce(new Error("git bisect failed")),
    bisectGood: mock(() => Promise.resolve(NOT_DONE)),
    bisectReset: mock(() => Promise.resolve()),
    getLastCommit: mock(() => Promise.resolve({ hash: "abc1234", message: "feat: add login" })),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("def5678")),
    askSelect: mock(() => Promise.resolve("bad")),
  });

  await new BisectWizard(git, ui).run();

  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("Bisect failed"));
  expect(git.bisectReset).toHaveBeenCalled();
});

test("resets bisect and shows error when start fails", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    bisectStart: mock(() => Promise.reject(new Error("already bisecting"))),
    bisectReset: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("def5678")),
  });

  await new BisectWizard(git, ui).run();

  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("Failed to start bisect"));
  expect(git.bisectReset).toHaveBeenCalled();
});
