import { expect, mock, test } from "bun:test";
import { showDiffPages } from "../../src/core/diff-pages";
import { DiffViewer } from "../../src/core/diff-viewer";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

test("compares local and remote branches by their full refs", async () => {
  const reference = "refs/remotes/review/main";
  const git = createGitMock({
    getBranches: async () => ({ all: ["main"], current: "main" }),
    getTrackingBranches: async () => [
      { remote: "review", name: "main", ref: reference, head: "a".repeat(40) },
    ],
    readDiff: mock(async () => "diff --git a/app.ts b/app.ts\n+new line"),
  });
  const ui = createUIMock({
    askSelect: async () => "refs",
    askSearchSelect: mock()
      .mockResolvedValueOnce("refs/heads/main")
      .mockResolvedValueOnce(reference),
  });

  await new DiffViewer(git, ui).run();

  expect(git.readDiff).toHaveBeenCalledWith({
    scope: "refs",
    base: "refs/heads/main",
    target: reference,
  });
  expect(ui.showDiff).toHaveBeenCalledWith(expect.stringContaining("+new line"));
});

test("a staged comparison describes an empty result and needs no other branch", async () => {
  const git = createGitMock();
  const ui = createUIMock({ askSelect: async () => "staged" });
  await new DiffViewer(git, ui).run();
  expect(git.readDiff).toHaveBeenCalledWith({ scope: "staged" });
  expect(ui.info).toHaveBeenCalledWith("No differences for this comparison.");
  expect(ui.askSearchSelect).not.toHaveBeenCalled();
});

test("ref comparisons require two available refs", async () => {
  const git = createGitMock({ getBranches: async () => ({ all: ["main"], current: "main" }) });
  const ui = createUIMock({ askSelect: async () => "merge-base" });
  await new DiffViewer(git, ui).run();
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("add another branch"));
  expect(git.readDiff).not.toHaveBeenCalled();
});

test("cancelling ref selection leaves the diff unread", async () => {
  const git = createGitMock({
    getBranches: async () => ({ all: ["main", "topic"], current: "main" }),
  });
  const ui = createUIMock({
    askSelect: async () => "merge-base",
    askSearchSelect: async () => {
      throw new GoBackSignal();
    },
  });
  await expect(new DiffViewer(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(git.readDiff).not.toHaveBeenCalled();
});

test("large diffs can advance, move back and exit without truncating the final page", async () => {
  const lines = Array.from({ length: 83 }, (_, i) => `+line ${i + 1}`);
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("next")
      .mockResolvedValueOnce("next")
      .mockResolvedValueOnce("previous")
      .mockRejectedValueOnce(new GoBackSignal()),
  });
  await showDiffPages(ui, lines.join("\n"));
  expect(ui.showDiff).toHaveBeenCalledTimes(4);
  expect(ui.showDiff).toHaveBeenNthCalledWith(3, "+line 81\n+line 82\n+line 83");
  expect(ui.info).toHaveBeenNthCalledWith(4, "Diff page 2 of 3");
});

test("offers Detached HEAD as a comparison ref alongside the repository's named branch", async () => {
  const git = createGitMock({ getBranches: async () => ({ all: ["main"], current: "" }) });
  const ui = createUIMock({
    askSelect: async () => "refs",
    askSearchSelect: async (prompt, options) => {
      if (prompt === "Base branch:") {
        expect(options).toContainEqual({ label: "Detached HEAD", value: "HEAD" });
        return "HEAD";
      }
      return "refs/heads/main";
    },
  });
  await new DiffViewer(git, ui).run();
  expect(git.readDiff).toHaveBeenCalledWith({
    scope: "refs",
    base: "HEAD",
    target: "refs/heads/main",
  });
});

test("Back exits the pager and unrelated terminal failures propagate", async () => {
  const diff = Array.from({ length: 82 }, () => "+line").join("\n");
  const ui = createUIMock({ askSelect: async () => "back" });
  await showDiffPages(ui, diff);
  expect(ui.showDiff).toHaveBeenCalledTimes(1);
  const broken = createUIMock({
    askSelect: async () => {
      throw new Error("terminal unavailable");
    },
  });
  await expect(showDiffPages(broken, diff)).rejects.toThrow("terminal unavailable");
});
