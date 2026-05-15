import { test, expect, mock } from "bun:test";
import { UndoCommit } from "../../src/core/undo-commit";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";
import { GoBackSignal } from "../../src/ui/go-back";

const LAST_COMMIT = { hash: "abc1234", message: "feat: add login page" };

// Helper: builds git+ui mocks for the new multi-commit flow.
// By default selects the first commit (n=1) and the given mode.
function buildMocks(mode: "soft" | "mixed", confirmed = true) {
  let selectCallCount = 0;
  const git = createGitMock({
    getLog: mock(() => Promise.resolve([LAST_COMMIT])),
    resetSoft: mock(() => Promise.resolve()),
    resetMixed: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => {
      selectCallCount++;
      // First call = commit selection, second call = mode selection
      if (selectCallCount === 1) return Promise.resolve(LAST_COMMIT.hash as never);
      return Promise.resolve(mode as never);
    }),
    askConfirm: mock(() => Promise.resolve(confirmed)),
  });
  return { git, ui };
}

// ─── happy paths ─────────────────────────────────────────────────────────────

test("soft reset: calls resetSoft when user confirms", async () => {
  const { git, ui } = buildMocks("soft");

  await new UndoCommit(git, ui).run();

  expect(git.resetSoft).toHaveBeenCalledTimes(1);
  expect(git.resetSoft).toHaveBeenCalledWith(1);
});

test("mixed reset: calls resetMixed when user confirms", async () => {
  const { git, ui } = buildMocks("mixed");

  await new UndoCommit(git, ui).run();

  expect(git.resetMixed).toHaveBeenCalledTimes(1);
  expect(git.resetMixed).toHaveBeenCalledWith(1);
});

test("shows last commit info in the commit selection prompt", async () => {
  const { git, ui } = buildMocks("soft");

  await new UndoCommit(git, ui).run();

  expect(ui.askSelect).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining([
      expect.objectContaining({ value: "abc1234", label: expect.stringContaining("abc1234") }),
    ])
  );
});

// ─── cancellation ─────────────────────────────────────────────────────────────

test("aborts without resetting when user declines confirmation", async () => {
  const { git, ui } = buildMocks("soft", false);

  await new UndoCommit(git, ui).run();

  expect(git.resetSoft).not.toHaveBeenCalled();
  expect(git.resetMixed).not.toHaveBeenCalled();
});

// ─── error handling ───────────────────────────────────────────────────────────

test("shows info and aborts when repository has no commits", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();

  await new UndoCommit(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(ui.askSelect).not.toHaveBeenCalled();
});

test("soft reset does not call resetMixed", async () => {
  const { git, ui } = buildMocks("soft");

  await new UndoCommit(git, ui).run();

  expect(git.resetSoft).toHaveBeenCalledTimes(1);
  expect(git.resetMixed).not.toHaveBeenCalled();
});

test("mixed reset does not call resetSoft", async () => {
  const { git, ui } = buildMocks("mixed");

  await new UndoCommit(git, ui).run();

  expect(git.resetMixed).toHaveBeenCalledTimes(1);
  expect(git.resetSoft).not.toHaveBeenCalled();
});

// ─── multi-commit undo ────────────────────────────────────────────────────────

const COMMITS = [
  { hash: "abc1234", message: "feat: add login page" },
  { hash: "def5678", message: "fix: correct typo" },
  { hash: "ghi9012", message: "chore: update deps" },
];

function makeMultiMocks({
  selectedHash = COMMITS[2].hash,
  mode = "soft" as "soft" | "mixed",
  confirmed = true,
} = {}) {
  let selectCallCount = 0;
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    resetSoft: mock(() => Promise.resolve()),
    resetMixed: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => {
      selectCallCount++;
      if (selectCallCount === 1) return Promise.resolve(selectedHash as never);
      return Promise.resolve(mode as never);
    }),
    askConfirm: mock(() => Promise.resolve(confirmed)),
  });
  return { git, ui };
}

test("shows last 10 commits and lets user select how many to undo", async () => {
  const { git, ui } = makeMultiMocks();

  await new UndoCommit(git, ui).run();

  expect(git.getLog).toHaveBeenCalledTimes(1);
  expect(ui.askSelect).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining([
      expect.objectContaining({ value: COMMITS[0].hash }),
      expect.objectContaining({ value: COMMITS[1].hash }),
      expect.objectContaining({ value: COMMITS[2].hash }),
    ])
  );
});

test("undoes N commits with soft reset when user selects a commit N steps back", async () => {
  // COMMITS[2] is at index 2, so n = 3
  const { git } = makeMultiMocks({ selectedHash: COMMITS[2].hash, mode: "soft" });
  const ui = createUIMock({
    askSelect: mock(() => {
      let call = 0;
      return (() => {
        call++;
        if (call === 1) return Promise.resolve(COMMITS[2].hash as never);
        return Promise.resolve("soft" as never);
      })();
    }),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  // Simpler: build mocks manually
  let selectCallCount = 0;
  const git2 = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    resetSoft: mock(() => Promise.resolve()),
  });
  const ui2 = createUIMock({
    askSelect: mock(() => {
      selectCallCount++;
      if (selectCallCount === 1) return Promise.resolve(COMMITS[2].hash as never);
      return Promise.resolve("soft" as never);
    }),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new UndoCommit(git2, ui2).run();

  expect(git2.resetSoft).toHaveBeenCalledTimes(1);
  expect(git2.resetSoft).toHaveBeenCalledWith(3);
});

test("undoes N commits with mixed reset when user selects a commit N steps back", async () => {
  let selectCallCount = 0;
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    resetMixed: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => {
      selectCallCount++;
      if (selectCallCount === 1) return Promise.resolve(COMMITS[1].hash as never);
      return Promise.resolve("mixed" as never);
    }),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new UndoCommit(git, ui).run();

  // COMMITS[1] is at index 1, so n = 2
  expect(git.resetMixed).toHaveBeenCalledTimes(1);
  expect(git.resetMixed).toHaveBeenCalledWith(2);
});

test("confirms with correct commit count before resetting", async () => {
  let selectCallCount = 0;
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    resetSoft: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => {
      selectCallCount++;
      if (selectCallCount === 1) return Promise.resolve(COMMITS[2].hash as never);
      return Promise.resolve("soft" as never);
    }),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new UndoCommit(git, ui).run();

  // n=3 (index 2 + 1), mode=soft
  expect(ui.askConfirm).toHaveBeenCalledWith(expect.stringContaining("3"));
  expect(ui.askConfirm).toHaveBeenCalledWith(expect.stringContaining("soft"));
});

test("aborts when user declines confirmation (multi-commit)", async () => {
  let selectCallCount = 0;
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    resetSoft: mock(() => Promise.resolve()),
    resetMixed: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => {
      selectCallCount++;
      if (selectCallCount === 1) return Promise.resolve(COMMITS[0].hash as never);
      return Promise.resolve("soft" as never);
    }),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new UndoCommit(git, ui).run();

  expect(git.resetSoft).not.toHaveBeenCalled();
  expect(git.resetMixed).not.toHaveBeenCalled();
});

test("propagates GoBackSignal when ESC pressed on commit selection", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.reject(new GoBackSignal())),
  });

  await expect(new UndoCommit(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
});

test("shows info when no commits are available", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();

  await new UndoCommit(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(ui.askSelect).not.toHaveBeenCalled();
});
