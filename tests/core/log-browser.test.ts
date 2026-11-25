import { expect, mock, test } from "bun:test";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { LogBrowser } from "../../src/core/log-browser";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const infoText = (ui: ReturnType<typeof createUIMock>): string =>
  (ui.info as ReturnType<typeof mock>).mock.calls.map((c) => String(c[0])).join("\n");

test("informs and does not prompt when the branch has no commits", async () => {
  const git = createGitMock({
    readLogPage: async () => ({ head: null, commits: [], hasNext: false }),
  });
  const ui = createUIMock();

  await new LogBrowser(git, ui).run();

  expect(ui.info).toHaveBeenCalledWith("No commits to show.");
  expect(ui.askSearchSelect).not.toHaveBeenCalled();
});

test("renders the diff of the selected commit, then exits on cancel", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("main")),
    readLogPage: async () => ({
      head: "abc1234",
      commits: [{ hash: "abc1234", message: "feat: x" }],
      hasNext: false,
    }),
    getCommitDiff: mock(() => Promise.resolve("+added line\n-removed line")),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("abc1234") // inspect this commit
      .mockRejectedValueOnce(new GoBackSignal()), // then leave the browser
  });

  await expect(new LogBrowser(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);

  expect(git.getCommitDiff).toHaveBeenCalledWith("abc1234");
  expect(ui.showDiff).toHaveBeenCalledWith("+added line\n-removed line");
});

test("does not offer AI explanation when no explainer is injected", async () => {
  const git = createGitMock({
    readLogPage: async () => ({
      head: "abc1234",
      commits: [{ hash: "abc1234", message: "feat: x" }],
      hasNext: false,
    }),
    getCommitDiff: mock(() => Promise.resolve("+code")),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("abc1234")
      .mockRejectedValueOnce(new GoBackSignal()),
  });

  await expect(new LogBrowser(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);

  expect(ui.askConfirm).not.toHaveBeenCalled();
});

test("explains the commit with AI when an explainer is injected and confirmed", async () => {
  const aiExplainer = mock(() => Promise.resolve("Adds X to handle Y"));
  const git = createGitMock({
    readLogPage: async () => ({
      head: "abc1234",
      commits: [{ hash: "abc1234", message: "feat: x" }],
      hasNext: false,
    }),
    getCommitDiff: mock(() => Promise.resolve("+code")),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("abc1234")
      .mockRejectedValueOnce(new GoBackSignal()),
    askConfirm: mock(() => Promise.resolve(true)), // yes, explain
  });

  await expect(new LogBrowser(git, ui, aiExplainer).run()).rejects.toBeInstanceOf(GoBackSignal);

  expect(aiExplainer).toHaveBeenCalledWith("+code");
  expect(infoText(ui)).toContain("Adds X to handle Y");
});

test("reports an empty commit and skips AI when there is no diff", async () => {
  const aiExplainer = mock(() => Promise.resolve("should not run"));
  const git = createGitMock({
    readLogPage: async () => ({
      head: "abc1234",
      commits: [{ hash: "abc1234", message: "chore: empty" }],
      hasNext: false,
    }),
    getCommitDiff: mock(() => Promise.resolve("")),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("abc1234")
      .mockRejectedValueOnce(new GoBackSignal()),
  });

  await expect(new LogBrowser(git, ui, aiExplainer).run()).rejects.toBeInstanceOf(GoBackSignal);

  expect(infoText(ui)).toContain("No changes in this commit.");
  expect(aiExplainer).not.toHaveBeenCalled();
});

test("navigates the pinned history snapshot and inspects a commit from a later page", async () => {
  const head = "c".repeat(40);
  const older = "b".repeat(40);
  const git = createGitMock({
    readLogPage: mock(async ({ offset }) => ({
      head,
      commits: [{ hash: offset ? older : head, message: offset ? "old" : "new" }],
      hasNext: offset === 0,
    })),
    getCommitDiff: async () => "+old content",
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("older")
      .mockResolvedValueOnce(older)
      .mockResolvedValueOnce("newer")
      .mockRejectedValueOnce(new GoBackSignal()),
  });
  await expect(new LogBrowser(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(git.readLogPage).toHaveBeenNthCalledWith(2, { head, limit: 30, offset: 30 });
  expect(git.readLogPage).toHaveBeenNthCalledWith(3, { head, limit: 30, offset: 0 });
  expect(ui.showDiff).toHaveBeenCalledWith("+old content");
});
