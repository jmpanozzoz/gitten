import { expect, mock, test } from "bun:test";
import { GoBackSignal } from "../../src/core/domain/navigation";
import type { UndoMode } from "../../src/core/ports/git-client.port";
import { UndoCommit } from "../../src/core/undo-commit";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const branchRef = "refs/heads/main";
const history = {
  branchRef,
  commits: [
    { oid: "b".repeat(40), firstParent: "a".repeat(40), subject: "latest" },
    { oid: "a".repeat(40), firstParent: null, subject: "root" },
  ],
};

function scenario(mode: UndoMode, confirmed = true) {
  const git = createGitMock({ readRewriteHistory: async () => history });
  const ui = createUIMock({
    askSearchSelect: mock(async () => history.commits[1]!.oid),
    askSelect: async () => mode,
    askConfirm: mock(async () => confirmed),
  });
  return { git, ui };
}

test.each([
  "soft",
  "mixed",
] as const)("Undo %s passes the confirmed first-parent range by full OID", async (mode) => {
  const { git, ui } = scenario(mode);
  await new UndoCommit(git, ui).run();
  expect(ui.askSearchSelect).toHaveBeenCalledWith(
    expect.stringContaining("through"),
    expect.arrayContaining([{ value: history.commits[1]!.oid, label: "aaaaaaaaaaaa — root" }]),
  );
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Protected branch main"));
  expect(ui.askConfirm).toHaveBeenCalledWith(`Undo 2 commit(s) with ${mode} reset?`, false);
  expect(git.undoRange).toHaveBeenCalledWith(
    {
      branchRef,
      head: history.commits[0]!.oid,
      oldest: history.commits[1]!.oid,
      base: null,
      count: 2,
    },
    mode,
  );
});

test("declining Undo leaves the branch and index mutation uncalled", async () => {
  const { git, ui } = scenario("mixed", false);
  await new UndoCommit(git, ui).run();
  expect(git.undoRange).not.toHaveBeenCalled();
});

test("Escape during Undo selection leaves history untouched", async () => {
  const { git, ui } = scenario("soft");
  const cancelled = {
    ...ui,
    askSearchSelect: async () => {
      throw new GoBackSignal();
    },
  };
  await expect(new UndoCommit(git, cancelled).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(git.undoRange).not.toHaveBeenCalled();
});

test("reports an empty history without offering an Undo action", async () => {
  const git = createGitMock();
  const ui = createUIMock();
  await new UndoCommit(git, ui).run();
  expect(ui.info).toHaveBeenCalledWith("No commits to undo.");
  expect(ui.askSearchSelect).not.toHaveBeenCalled();
});

test("leaves an active Git operation alone", async () => {
  const git = createGitMock({ getInProgressOperation: async () => "rebase" });
  const ui = createUIMock();
  await new UndoCommit(git, ui).run();
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("pending rebase"));
  expect(git.readRewriteHistory).not.toHaveBeenCalled();
});

test("Undo rejects a selection that is absent from the displayed history", async () => {
  const { git, ui } = scenario("soft");
  const picker = createUIMock({ askSearchSelect: async () => "not-in-history" });
  await new UndoCommit(git, { ...ui, askSearchSelect: picker.askSearchSelect }).run();
  expect(ui.askConfirm).not.toHaveBeenCalled();
  expect(git.undoRange).not.toHaveBeenCalled();
});
