import { expect, mock, test } from "bun:test";
import type { RepositoryStatus } from "../../src/core/ports/git-client.port";
import { RepositoryStatusFlow } from "../../src/core/repository-status";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const rename = { path: "new name.ts", previousPath: "old name.ts" };
const plain = { path: "café.ts" };
const unstage = async () => "unstage";
const recover = async () => "recover";
const resumeBisect = async () => {};

function status(overrides: Partial<RepositoryStatus> = {}): RepositoryStatus {
  return {
    branch: "feat/status",
    upstream: "origin/feat/status",
    ahead: 1,
    behind: 2,
    staged: [rename, plain],
    unstaged: [plain.path],
    untracked: ["notes.txt"],
    ...overrides,
  };
}

test("inspects both sides of a staged rename and shows the tracking and working state", async () => {
  const patch = "diff --git a/old name.ts b/new name.ts";
  const git = createGitMock({
    describeStatus: async () => status(),
    getStagedPathDiff: mock(async () => patch),
  });
  const ui = createUIMock({
    askSelect: async () => "inspect",
    askSearchSelect: mock(async () => rename),
  });
  await new RepositoryStatusFlow(git, ui, resumeBisect).run();
  expect(git.getStagedPathDiff).toHaveBeenCalledWith([rename.previousPath, rename.path]);
  expect(ui.askSearchSelect).toHaveBeenCalledWith("Inspect staged file:", [
    { value: rename, label: "old name.ts → new name.ts" },
    { value: plain, label: "café.ts" },
  ]);
  expect(ui.showDiff).toHaveBeenCalledWith(patch);
  expect(ui.info).toHaveBeenCalledWith("feat/status · origin/feat/status · 1 ahead · 2 behind");
  expect(ui.info).toHaveBeenCalledWith("Unstaged (1)\ncafé.ts");
  expect(ui.info).toHaveBeenCalledWith("Untracked (1)\nnotes.txt");
  expect(git.unstagePaths).not.toHaveBeenCalled();
});

test("reports when the inspected staged entry disappeared", async () => {
  const git = createGitMock({ describeStatus: async () => status() });
  const ui = createUIMock({ askSelect: async () => "inspect", askSearchSelect: async () => plain });
  await new RepositoryStatusFlow(git, ui, resumeBisect).run();
  expect(git.getStagedPathDiff).toHaveBeenCalledWith([plain.path]);
  expect(ui.info).toHaveBeenCalledWith("No staged diff remains for this selection.");
  expect(ui.showDiff).not.toHaveBeenCalled();
});

test("does not prompt to unstage an empty selection or paths that are no longer staged", async () => {
  const git = createGitMock({ describeStatus: async () => status() });
  for (const selected of [[], [plain]]) {
    const ui = createUIMock({ askSelect: unstage, askSearchMultiSelect: async () => selected });
    await new RepositoryStatusFlow(git, ui, resumeBisect).run();
    expect(ui.askConfirm).not.toHaveBeenCalled();
  }
  expect(git.unstagePaths).not.toHaveBeenCalled();
});

test("declining an unstage preview keeps both sides of the rename staged", async () => {
  const git = createGitMock({
    describeStatus: async () => status(),
    getStagedPathDiff: async () => "rename preview",
  });
  const ui = createUIMock({ askSelect: unstage, askSearchMultiSelect: async () => [rename] });
  await new RepositoryStatusFlow(git, ui, resumeBisect).run();
  expect(ui.showDiff).toHaveBeenCalledWith("rename preview");
  expect(ui.askConfirm).toHaveBeenCalledWith(
    "Unstage these paths and keep their working files?",
    false,
  );
  expect(git.unstagePaths).not.toHaveBeenCalled();
});

test("a Git operation that starts during unstage confirmation leaves the index alone", async () => {
  const git = createGitMock({
    describeStatus: async () => status(),
    getStagedPathDiff: async () => "selected diff",
    getInProgressOperation: mock().mockResolvedValueOnce(null).mockResolvedValue("rebase"),
  });
  const ui = createUIMock({
    askSelect: unstage,
    askSearchMultiSelect: async () => [plain],
    askConfirm: async () => true,
  });
  await new RepositoryStatusFlow(git, ui, resumeBisect).run();
  expect(ui.warn).toHaveBeenCalledWith("A Git operation started. Staging was left as is.");
  expect(git.unstagePaths).not.toHaveBeenCalled();
});

test("offers bisect recovery and keeps unstage unavailable during a pending operation", async () => {
  const git = createGitMock({
    describeStatus: async () => status(),
    getInProgressOperation: async () => "bisect",
  });
  const resume = mock(resumeBisect);
  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("back").mockResolvedValue("recover"),
  });
  await new RepositoryStatusFlow(git, ui, resume).run();
  expect(resume).not.toHaveBeenCalled();
  expect(ui.askSelect).toHaveBeenCalledWith("Repository status", [
    { value: "back", label: "Return to menu" },
    { value: "inspect", label: "Inspect staged file" },
    { value: "recover", label: "Resume or abort bisect" },
  ]);
  await new RepositoryStatusFlow(git, ui, resume).run();
  expect(resume).toHaveBeenCalledTimes(1);
  expect(git.unstagePaths).not.toHaveBeenCalled();
});

test("does not open recovery if the selected operation changed", async () => {
  const git = createGitMock({
    getInProgressOperation: mock().mockResolvedValueOnce("merge").mockResolvedValue("rebase"),
  });
  const ui = createUIMock({ askSelect: recover });
  await new RepositoryStatusFlow(git, ui, resumeBisect).run();
  expect(ui.warn).toHaveBeenCalledWith(
    "The active Git operation changed. Open repository status again.",
  );
  expect(ui.waitForConflictResolution).not.toHaveBeenCalled();
});

test("an explicit request aborts only the matching pending recovery operation", async () => {
  const git = createGitMock({ getInProgressOperation: async () => "rebase" });
  const ui = createUIMock({ askSelect: recover, waitForConflictResolution: async () => false });
  await new RepositoryStatusFlow(git, ui, resumeBisect).run();
  expect(git.rebaseAbort).toHaveBeenCalledTimes(1);
  expect(git.mergeAbort).not.toHaveBeenCalled();
  expect(git.rebaseContinue).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("rebase aborted"));
});
