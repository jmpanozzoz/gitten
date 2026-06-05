import { expect, mock, test } from "bun:test";
import { LogBrowser } from "../../src/core/log-browser";
import { GoBackSignal } from "../../src/ui/go-back";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const infoText = (ui: ReturnType<typeof createUIMock>): string =>
  (ui.info as ReturnType<typeof mock>).mock.calls.map((c) => String(c[0])).join("\n");

test("informs and does not prompt when the branch has no commits", async () => {
  const git = createGitMock({ getLog: mock(() => Promise.resolve([])) });
  const ui = createUIMock();

  await new LogBrowser(git, ui).run();

  expect(ui.info).toHaveBeenCalledWith("No commits to show.");
  expect(ui.askSearchSelect).not.toHaveBeenCalled();
});

test("renders the diff of the selected commit, then exits on cancel", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("main")),
    getLog: mock(() => Promise.resolve([{ hash: "abc1234", message: "feat: x" }])),
    getCommitDiff: mock(() => Promise.resolve("+added line\n-removed line")),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("abc1234") // inspect this commit
      .mockRejectedValueOnce(new GoBackSignal()), // then leave the browser
  });

  await expect(new LogBrowser(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);

  expect(git.getCommitDiff).toHaveBeenCalledWith("abc1234");
  expect(infoText(ui)).toContain("added line");
});

test("does not offer AI explanation when no explainer is injected", async () => {
  const git = createGitMock({
    getLog: mock(() => Promise.resolve([{ hash: "abc1234", message: "feat: x" }])),
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
    getLog: mock(() => Promise.resolve([{ hash: "abc1234", message: "feat: x" }])),
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
    getLog: mock(() => Promise.resolve([{ hash: "abc1234", message: "chore: empty" }])),
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
