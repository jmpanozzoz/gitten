import { expect, mock, test } from "bun:test";
import { BranchCleaner } from "../../src/core/branch-cleaner";
import { GoBackSignal } from "../../src/core/domain/navigation";
import type { TrackingBranch } from "../../src/core/ports/git-client.port";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

function branch(remote: string, name: string): TrackingBranch {
  return { remote, name, ref: `refs/remotes/${remote}/${name}`, head: "b".repeat(40) };
}

test("lists local branches except the current one and keeps same-name remotes distinct", async () => {
  const git = createGitMock({
    getBranches: async () => ({ all: ["main", "topic"], current: "main" }),
    getBranchLastActivity: async () => "two weeks ago",
    getTrackingBranches: async () => [branch("origin", "topic"), branch("review", "topic")],
  });
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => {
      expect(options.map(({ label }) => label)).toEqual([
        "topic · local · two weeks ago",
        "origin/topic · remote · bbbbbbbbbbbb",
        "review/topic · remote · bbbbbbbbbbbb",
      ]);
      return [];
    },
  });
  await new BranchCleaner(git, ui).run();
  expect(git.deleteLocalBranch).not.toHaveBeenCalled();
  expect(git.deleteRemoteBranch).not.toHaveBeenCalled();
});

test("continues after a local deletion fails and reports the exact partial count", async () => {
  const git = createGitMock({
    getBranches: async () => ({ all: ["first", "second"], current: "main" }),
    deleteLocalBranch: mock()
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValueOnce(undefined),
  });
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => options.map(({ value }) => value),
  });
  await new BranchCleaner(git, ui).run();
  expect(git.deleteLocalBranch).toHaveBeenCalledTimes(2);
  expect(ui.warn).toHaveBeenCalledWith("Deleted 1 of 2 selected branch(es).");
});

test("declines a protected branch before mutating either local or remote refs", async () => {
  const git = createGitMock({
    getBranches: async () => ({ all: ["main"], current: "topic" }),
    getTrackingBranches: async () => [branch("review", "topic")],
  });
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => options.map(({ value }) => value),
    askConfirm: mock(async () => false),
  });
  await new BranchCleaner(git, ui).run();
  expect(ui.askConfirm).toHaveBeenCalledWith("Delete protected branch(es) main?", false);
  expect(git.deleteLocalBranch).not.toHaveBeenCalled();
  expect(git.deleteRemoteBranch).not.toHaveBeenCalled();
});

test("only pushes deletion to the confirmed remote with the corresponding preview", async () => {
  const chosen = branch("review", "topic");
  const git = createGitMock({
    getTrackingBranches: async () => [branch("origin", "topic"), chosen],
    previewRemoteBranchDeletion: async (target) => ({
      target,
      destination: "refs/heads/actual-topic",
      urls: ["https://user:secret@example.test/owner/review"],
    }),
  });
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => [options[1]!.value],
    askConfirm: mock(async () => true),
  });
  await new BranchCleaner(git, ui).run();
  expect(git.deleteRemoteBranch).toHaveBeenCalledWith(expect.objectContaining({ target: chosen }));
  expect(git.deleteLocalBranch).not.toHaveBeenCalled();
  expect(ui.askConfirm).toHaveBeenCalledWith("Delete refs/heads/actual-topic from review?", false);
  expect(ui.info).toHaveBeenCalledWith(
    expect.stringContaining("https://example.test/owner/review"),
  );
});

test("requires explicit permission before forcing an unmerged local branch", async () => {
  const git = createGitMock({
    getBranches: async () => ({ all: ["work"], current: "main" }),
    getLog: async () => [{ hash: "a".repeat(40), message: "work in progress" }],
    deleteLocalBranch: async () => {
      throw new Error("branch is not fully merged");
    },
  });
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => [options[0]!.value],
    askConfirm: mock(async () => true),
  });
  await new BranchCleaner(git, ui).run();
  expect(ui.askConfirm).toHaveBeenCalledWith(
    '"work" at aaaaaaaaaaaa has unmerged commits. Force deletion?',
    false,
  );
  expect(git.deleteLocalBranchForce).toHaveBeenCalledWith("work");
});

test("a remote alias cannot bypass confirmation for a protected destination", async () => {
  const alias = branch("review", "archived");
  const git = createGitMock({
    getTrackingBranches: async () => [alias, branch("review", "main")],
    previewRemoteBranchDeletion: async (target) => ({
      target,
      destination: "refs/heads/main",
      urls: [],
    }),
  });
  const confirm = mock().mockResolvedValueOnce(true).mockResolvedValue(false);
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => options.map(({ value }) => value),
    askConfirm: confirm,
  });
  await new BranchCleaner(git, ui).run();
  expect(confirm).toHaveBeenCalledWith("Delete protected branch(es) review/main?", false);
  expect(confirm).toHaveBeenCalledWith("Delete protected remote branch review/main?", false);
  expect(git.deleteRemoteBranch).not.toHaveBeenCalled();
});

test("cancelling a later remote confirmation reports branches already deleted", async () => {
  const git = createGitMock({
    getBranches: async () => ({ all: ["first"], current: "main" }),
    getTrackingBranches: async () => [branch("review", "second")],
  });
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => options.map(({ value }) => value),
    askConfirm: mock().mockRejectedValue(new GoBackSignal()),
  });
  await expect(new BranchCleaner(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(git.deleteLocalBranch).toHaveBeenCalledWith("first");
  expect(git.deleteRemoteBranch).not.toHaveBeenCalled();
  expect(ui.warn).toHaveBeenCalledWith("Deleted 1 of 2 selected branch(es).");
});

test("reports an empty branch list without opening the selection prompt", async () => {
  const git = createGitMock({ getBranches: async () => ({ all: ["main"], current: "main" }) });
  const ui = createUIMock();
  await new BranchCleaner(git, ui).run();
  expect(ui.info).toHaveBeenCalledWith("No branches available to delete.");
  expect(ui.askSearchMultiSelect).not.toHaveBeenCalled();
});

test("does not offer force deletion when the unmerged branch tip cannot be read", async () => {
  const git = createGitMock({
    getBranches: async () => ({ all: ["work"], current: "main" }),
    getLog: mock().mockRejectedValue(new Error("ref unavailable")),
    deleteLocalBranch: mock().mockRejectedValue(new Error("branch is not fully merged")),
  });
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => options.map(({ value }) => value),
  });
  await new BranchCleaner(git, ui).run();
  expect(git.getLog).toHaveBeenCalledWith("refs/heads/work", 1);
  expect(ui.warn).toHaveBeenCalledWith('Could not verify local branch "work".');
  expect(ui.askConfirm).not.toHaveBeenCalled();
  expect(git.deleteLocalBranchForce).not.toHaveBeenCalled();
});

test("preserves a moved local branch and reports a rejected force deletion separately", async () => {
  const log = { hash: "a".repeat(40), message: "confirmed" };
  const git = createGitMock({
    getBranches: async () => ({ all: ["moved", "locked"], current: "main" }),
    getLog: mock()
      .mockResolvedValueOnce([log])
      .mockResolvedValueOnce([{ ...log, hash: "b".repeat(40) }])
      .mockResolvedValue([log]),
    deleteLocalBranch: mock().mockRejectedValue(new Error("branch is not fully merged")),
    deleteLocalBranchForce: mock().mockRejectedValue(new Error("could not lock ref")),
  });
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => options.map(({ value }) => value),
    askConfirm: mock(async () => true),
  });
  await new BranchCleaner(git, ui).run();
  expect(git.deleteLocalBranchForce).toHaveBeenCalledTimes(1);
  expect(git.deleteLocalBranchForce).toHaveBeenCalledWith("locked");
  expect(ui.warn).toHaveBeenCalledWith(
    'Local branch "moved" changed. Review it again before deleting.',
  );
  expect(ui.warn).toHaveBeenCalledWith('Could not force-delete local branch "locked".');
  expect(ui.info).toHaveBeenCalledWith("No branches were deleted.");
});

test("declining force deletion leaves the unmerged branch untouched", async () => {
  const git = createGitMock({
    getBranches: async () => ({ all: ["work"], current: "main" }),
    getLog: async () => [{ hash: "a".repeat(40), message: "work" }],
    deleteLocalBranch: mock().mockRejectedValue(new Error("branch is not fully merged")),
  });
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => options.map(({ value }) => value),
    askConfirm: mock(async () => false),
  });
  await new BranchCleaner(git, ui).run();
  expect(ui.askConfirm).toHaveBeenCalledTimes(1);
  expect(git.deleteLocalBranchForce).not.toHaveBeenCalled();
});

test("reports a failed remote operation without counting it as a deletion", async () => {
  const target = branch("review", "topic");
  const git = createGitMock({
    getTrackingBranches: async () => [target],
    previewRemoteBranchDeletion: async () => ({
      target,
      destination: "refs/heads/topic",
      urls: ["https://example.test/review"],
    }),
    deleteRemoteBranch: mock().mockRejectedValue("remote failed"),
  });
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => options.map(({ value }) => value),
    askConfirm: mock(async () => true),
  });
  await new BranchCleaner(git, ui).run();
  expect(git.deleteRemoteBranch).toHaveBeenCalledTimes(1);
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("remote failed"));
  expect(ui.info).toHaveBeenCalledWith("No branches were deleted.");
});

test("cancelling the first remote deletion leaves every selected branch unmodified", async () => {
  const git = createGitMock({ getTrackingBranches: async () => [branch("review", "topic")] });
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => options.map(({ value }) => value),
    askConfirm: mock().mockRejectedValue(new GoBackSignal()),
  });
  await expect(new BranchCleaner(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(git.deleteRemoteBranch).not.toHaveBeenCalled();
  expect(ui.warn).not.toHaveBeenCalledWith(expect.stringContaining("Deleted"));
});

test("a confirmed protected alias reports remote errors with the reviewed destination", async () => {
  const target = branch("review", "archived");
  const plan = { target, destination: "refs/heads/main", urls: ["https://example.test/review"] };
  const git = createGitMock({
    getTrackingBranches: async () => [target],
    previewRemoteBranchDeletion: async () => plan,
    deleteRemoteBranch: mock().mockRejectedValue(new Error("lease rejected")),
  });
  const ui = createUIMock({
    askSearchMultiSelect: async (_, options) => options.map(({ value }) => value),
    askConfirm: mock().mockResolvedValue(true),
  });
  await new BranchCleaner(git, ui).run();
  expect(ui.askConfirm).toHaveBeenCalledWith("Delete protected remote branch review/main?", false);
  expect(ui.askConfirm).toHaveBeenCalledWith("Delete refs/heads/main from review?", false);
  expect(git.deleteRemoteBranch).toHaveBeenCalledWith(plan);
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("lease rejected"));
  expect(ui.success).not.toHaveBeenCalled();
});
