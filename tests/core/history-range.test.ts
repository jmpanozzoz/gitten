import { expect, test } from "bun:test";
import { editableHistory, selectHistoryRange } from "../../src/core/history-range";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

test.each([
  new Error("detached HEAD"),
  "invalid history",
])("reports the reason a history snapshot is unavailable: %s", async (error) => {
  const git = createGitMock({ readRewriteHistory: async () => Promise.reject(error) });
  const ui = createUIMock();
  expect(await editableHistory(git, ui, 10)).toBeUndefined();
  expect(ui.warn).toHaveBeenCalledWith(error instanceof Error ? error.message : error);
});

test("does not open the range picker when there are no commits", async () => {
  const ui = createUIMock();
  expect(
    await selectHistoryRange(ui, { branchRef: "refs/heads/topic", commits: [] }, "Undo"),
  ).toBeUndefined();
  expect(ui.askSearchSelect).not.toHaveBeenCalled();
});
