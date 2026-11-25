import { expect, mock, test } from "bun:test";
import type { StatusSummary } from "../../src/core/ports/git-client.port";
import { SquashFlow } from "../../src/core/squash-flow";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const branchRef = "refs/heads/feature";
const history = {
  branchRef,
  commits: [
    { oid: "c".repeat(40), firstParent: "b".repeat(40), subject: "feat: c" },
    { oid: "b".repeat(40), firstParent: "a".repeat(40), subject: "feat: b" },
    { oid: "a".repeat(40), firstParent: null, subject: "feat: a" },
  ],
};

const dirty = (): StatusSummary => ({
  files: [{ path: "x.ts", status: "M" }],
  isClean: () => false,
  hasStagedChanges: () => false,
  commitsAhead: 0,
  commitsBehind: 0,
});

test("uses a default Squash message when the oldest commit has no subject", async () => {
  const oldest = { ...history.commits[2]!, subject: "" };
  const git = createGitMock({
    readRewriteHistory: async () => ({
      ...history,
      commits: [...history.commits.slice(0, 2), oldest],
    }),
  });
  const ui = createUIMock({
    askSearchSelect: async () => oldest.oid,
    askText: mock().mockResolvedValue(""),
    askConfirm: mock().mockResolvedValue(true),
  });
  await new SquashFlow(git, ui).run();
  expect(ui.askText).toHaveBeenCalledWith(
    "Squashed commit message:",
    undefined,
    "chore: squash commits",
  );
  expect(git.squashRange).toHaveBeenCalledWith(
    expect.objectContaining({ oldest: oldest.oid }),
    "chore: squash commits",
  );
});

test("warns and stops when the working tree is dirty", async () => {
  const git = createGitMock({
    getStatus: async () => dirty(),
    readRewriteHistory: async () => history,
  });
  const ui = createUIMock();
  await new SquashFlow(git, ui).run();
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("uncommitted changes"));
  expect(git.squashRange).not.toHaveBeenCalled();
});

test("requires at least two commits and a boundary below HEAD", async () => {
  const git = createGitMock({
    readRewriteHistory: mock()
      .mockResolvedValueOnce({ ...history, commits: history.commits.slice(0, 1) })
      .mockResolvedValueOnce(history),
  });
  const ui = createUIMock({ askSearchSelect: async () => history.commits[0]!.oid });
  const flow = new SquashFlow(git, ui);
  await flow.run();
  await flow.run();
  expect(ui.info).toHaveBeenCalledWith("Need at least 2 commits to squash.");
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("below HEAD"));
  expect(git.squashRange).not.toHaveBeenCalled();
});

test("passes the selected range and oldest subject to Squash when no message is entered", async () => {
  const git = createGitMock({ readRewriteHistory: async () => history });
  const ui = createUIMock({
    askSearchSelect: async () => history.commits[2]!.oid,
    askText: async () => " ",
    askConfirm: mock(async () => true),
  });
  await new SquashFlow(git, ui).run();
  expect(ui.askConfirm).toHaveBeenCalledWith("Squash 3 commits into one?", false);
  expect(git.squashRange).toHaveBeenCalledWith(
    {
      branchRef,
      head: history.commits[0]!.oid,
      oldest: history.commits[2]!.oid,
      base: null,
      count: 3,
    },
    "feat: a",
  );
});

test("uses the AI message only after specific consent", async () => {
  const summarize = mock(async () => "feat: combined work");
  const git = createGitMock({ readRewriteHistory: async () => history });
  const ui = createUIMock({
    askSearchSelect: async () => history.commits[1]!.oid,
    askConfirm: mock(async () => true),
  });
  await new SquashFlow(git, ui, summarize).run();
  expect(summarize).toHaveBeenCalledWith(["feat: c", "feat: b"]);
  expect(git.squashRange).toHaveBeenCalledWith(
    expect.objectContaining({ base: history.commits[2]!.oid }),
    "feat: combined work",
  );
});

test("declining Squash on a protected branch leaves the refs unchanged", async () => {
  const git = createGitMock({
    readRewriteHistory: async () => ({ ...history, branchRef: "refs/heads/main" }),
  });
  const ui = createUIMock({
    askSearchSelect: async () => history.commits[1]!.oid,
    askConfirm: async () => false,
  });
  await new SquashFlow(git, ui).run();
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Protected branch main"));
  expect(git.squashRange).not.toHaveBeenCalled();
});

test("Squash stops before prompting when a pending Git operation prevents a rewrite", async () => {
  const git = createGitMock({ getInProgressOperation: async () => "rebase" });
  const ui = createUIMock();
  await new SquashFlow(git, ui).run();
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("pending rebase"));
  expect(ui.askSearchSelect).not.toHaveBeenCalled();
  expect(git.squashRange).not.toHaveBeenCalled();
});

test("Squash keeps the explicit subject when AI fails and falls back on an empty suggestion", async () => {
  const summarize = mock().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("");
  const git = createGitMock({ readRewriteHistory: async () => history });
  const ui = createUIMock({
    askSearchSelect: async () => history.commits[1]!.oid,
    askText: mock().mockResolvedValueOnce("Keep this subject").mockResolvedValueOnce(""),
    askConfirm: async () => true,
  });
  const flow = new SquashFlow(git, ui, summarize);
  await flow.run();
  await flow.run();
  expect(git.squashRange).toHaveBeenNthCalledWith(1, expect.any(Object), "Keep this subject");
  expect(git.squashRange).toHaveBeenNthCalledWith(2, expect.any(Object), "feat: b");
});
