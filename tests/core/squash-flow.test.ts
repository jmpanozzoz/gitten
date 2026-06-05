import { expect, mock, test } from "bun:test";
import type { StatusSummary } from "../../src/core/ports/git-client.port";
import { SquashFlow } from "../../src/core/squash-flow";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

// getLog is newest-first: c3 is HEAD (index 0), c1 is oldest (index 2).
const COMMITS = [
  { hash: "c3", message: "feat: c" },
  { hash: "c2", message: "feat: b" },
  { hash: "c1", message: "feat: a" },
];

const dirtyStatus = (): StatusSummary => ({
  files: [{ path: "x.ts", status: "M" }],
  isClean: () => false,
  hasStagedChanges: () => false,
  commitsAhead: 0,
  commitsBehind: 0,
});

test("warns and aborts when on a protected branch and the user declines", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("main")),
  });
  const ui = createUIMock({ askConfirm: mock(() => Promise.resolve(false)) });

  await new SquashFlow(git, ui).run();

  expect(ui.askConfirm).toHaveBeenCalledWith(expect.stringContaining("main"));
  expect(git.resetSoft).not.toHaveBeenCalled();
  expect(git.commit).not.toHaveBeenCalled();
});

test("aborts when the working tree is not clean", async () => {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(dirtyStatus())),
    getLog: mock(() => Promise.resolve(COMMITS)),
  });
  const ui = createUIMock();

  await new SquashFlow(git, ui).run();

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("uncommitted changes"));
  expect(git.resetSoft).not.toHaveBeenCalled();
});

test("informs when there are fewer than 2 commits to squash", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve([{ hash: "c1", message: "feat: a" }])),
  });
  const ui = createUIMock();

  await new SquashFlow(git, ui).run();

  expect(ui.info).toHaveBeenCalledWith("Need at least 2 commits to squash.");
  expect(git.resetSoft).not.toHaveBeenCalled();
});

test("aborts when the chosen boundary is HEAD (only 1 commit)", async () => {
  const git = createGitMock({ getLog: mock(() => Promise.resolve(COMMITS)) });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("c3")), // index 0 → count 1
  });

  await new SquashFlow(git, ui).run();

  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("below HEAD"));
  expect(git.resetSoft).not.toHaveBeenCalled();
});

test("soft-resets and recommits the chosen number of commits", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    resetSoft: mock(() => Promise.resolve()),
    commit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("c1")), // index 2 → count 3
    askText: mock(() => Promise.resolve("feat: squashed work")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new SquashFlow(git, ui).run();

  expect(git.resetSoft).toHaveBeenCalledWith(3);
  expect(git.commit).toHaveBeenCalledWith("feat: squashed work");
});

test("falls back to the base commit message when left blank", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    resetSoft: mock(() => Promise.resolve()),
    commit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("c1")), // count 3
    askText: mock(() => Promise.resolve("   ")), // blank → use placeholder
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new SquashFlow(git, ui).run();

  // toSquash = [c3, c2, c1]; base (oldest) message is "feat: a".
  expect(git.commit).toHaveBeenCalledWith("feat: a");
});

test("uses the AI summary as the message when requested", async () => {
  const aiSummarizer = mock(() => Promise.resolve("feat: combined work"));
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    resetSoft: mock(() => Promise.resolve()),
    commit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("c1")), // count 3
    askText: mock(() => Promise.resolve("")), // blank → use AI placeholder
    askConfirm: mock(() => Promise.resolve(true)), // yes to AI + yes to squash
  });

  await new SquashFlow(git, ui, aiSummarizer).run();

  expect(aiSummarizer).toHaveBeenCalledWith(["feat: c", "feat: b", "feat: a"]);
  expect(git.commit).toHaveBeenCalledWith("feat: combined work");
});

test("does not squash when the final confirmation is declined", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve(COMMITS)),
    resetSoft: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("c1")),
    askText: mock(() => Promise.resolve("feat: squashed")),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new SquashFlow(git, ui).run();

  expect(git.resetSoft).not.toHaveBeenCalled();
  expect(git.commit).not.toHaveBeenCalled();
});
