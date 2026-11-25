import { expect, mock, test } from "bun:test";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { StashManager } from "../../src/core/stash-manager";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const STASHES = [
  {
    index: 0,
    oid: "a".repeat(40),
    message: "WIP on feat/login: abc1234 feat: add form",
    date: "2 hours ago",
  },
  {
    index: 1,
    oid: "b".repeat(40),
    message: "WIP on main: def5678 chore: update deps",
    date: "yesterday",
  },
];

const first = STASHES[0]!;
const second = STASHES[1]!;

function selectAction(action: "apply" | "drop" | "push") {
  return { askSelect: mock(() => Promise.resolve(action)) };
}

// ─── empty stash list ─────────────────────────────────────────────────────────

test("shows info when stash list is empty (apply action)", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({ ...selectAction("apply") });

  await new StashManager(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(ui.askSelect).toHaveBeenCalledTimes(1);
});

test("shows info when stash list is empty (drop action)", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({ ...selectAction("drop") });

  await new StashManager(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(ui.askSearchMultiSelect).not.toHaveBeenCalled();
});

// ─── apply / pop ──────────────────────────────────────────────────────────────

test("applies selected stash with pop when user chooses pop mode", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    stashPop: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("apply").mockResolvedValueOnce("pop"),
    askSearchSelect: async () => first,
  });

  await new StashManager(git, ui).run();

  expect(git.stashPop).toHaveBeenCalledWith({ oid: first.oid, index: first.index });
});

test("applies selected stash without dropping when user chooses apply mode", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    stashApply: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("apply").mockResolvedValueOnce("apply"),
    askSearchSelect: async () => first,
  });

  await new StashManager(git, ui).run();

  expect(git.stashApply).toHaveBeenCalledWith({ oid: first.oid, index: first.index });
  expect(git.stashPop).not.toHaveBeenCalled();
});

// ─── drop ─────────────────────────────────────────────────────────────────────

test("drops selected stashes", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    stashDrop: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("drop")),
    askSearchMultiSelect: async () => STASHES,
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new StashManager(git, ui).run();

  expect(git.stashDrop).toHaveBeenCalledTimes(2);
});

test("drops in reverse index order to preserve stash indices", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    stashDrop: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("drop")),
    askSearchMultiSelect: async () => STASHES,
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new StashManager(git, ui).run();

  const calls = (git.stashDrop as ReturnType<typeof mock>).mock.calls.map((c) => c[0]);
  expect(calls).toEqual([
    { oid: second.oid, index: second.index },
    { oid: first.oid, index: first.index },
  ]);
});

test("aborts drop when user declines confirmation", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    stashDrop: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("drop")),
    askSearchMultiSelect: async () => [first],
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new StashManager(git, ui).run();

  expect(git.stashDrop).not.toHaveBeenCalled();
});

// ─── push (stash current changes) ────────────────────────────────────────────

test("stashes current changes with optional message", async () => {
  const git = createGitMock({
    describeStatus: async () => ({
      branch: "feature",
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: ["src/app.ts"],
      untracked: [],
    }),
    stashWithMessage: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...selectAction("push"),
    askText: mock(() => Promise.resolve("WIP: half-done feature")),
  });

  await new StashManager(git, ui).run();

  expect(git.stashWithMessage).toHaveBeenCalledWith("WIP: half-done feature", false);
});

test("aborts stash push when working tree is clean", async () => {
  const git = createGitMock({
    stashWithMessage: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({ ...selectAction("push") });

  await new StashManager(git, ui).run();

  expect(git.stashWithMessage).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalled();
});

// ─── diff preview before apply ───────────────────────────────────────────────

test("shows stash diff when user requests preview before applying", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    getStashDiff: mock(() => Promise.resolve("+const x = 1;\n-const x = 0;")),
    stashPop: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("apply").mockResolvedValueOnce("pop"),
    askSearchSelect: async () => first,
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new StashManager(git, ui).run();

  expect(git.getStashDiff).toHaveBeenCalledWith(first.oid);
  expect(ui.showDiff).toHaveBeenCalledWith(expect.stringContaining("+const x = 1;"));
  expect(git.stashPop).toHaveBeenCalledWith({ oid: first.oid, index: first.index });
});

test("skips preview and applies directly when user declines preview", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    getStashDiff: mock(() => Promise.resolve("+const x = 1;")),
    stashPop: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("apply").mockResolvedValueOnce("pop"),
    askSearchSelect: async () => first,
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new StashManager(git, ui).run();

  expect(git.getStashDiff).not.toHaveBeenCalled();
  expect(git.stashPop).toHaveBeenCalledWith({ oid: first.oid, index: first.index });
});

// ─── stash stat display ───────────────────────────────────────────────────────

test("shows file count and insertion/deletion stat before preview prompt", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    getStashStat: mock(() => Promise.resolve({ filesChanged: 3, insertions: 12, deletions: 4 })),
    stashPop: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("apply").mockResolvedValueOnce("pop"),
    askSearchSelect: async () => first,
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new StashManager(git, ui).run();

  expect(git.getStashStat).toHaveBeenCalledWith(first.oid);
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("3 file(s)"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("+12"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("−4"));
});

// ─── esc / go-back ────────────────────────────────────────────────────────────

test("propagates GoBackSignal when user presses ESC on action menu", async () => {
  const git = createGitMock();
  const ui = createUIMock({
    askSelect: mock(() => Promise.reject(new GoBackSignal())),
  });

  await expect(new StashManager(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(git.getStashes).not.toHaveBeenCalled();
});

test("a partial stash drop reports the count and stops on an outdated selection", async () => {
  const git = createGitMock({
    getStashes: async () => STASHES,
    stashDrop: mock()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("stale selection")),
  });
  const ui = createUIMock({
    ...selectAction("drop"),
    askSearchMultiSelect: async () => STASHES,
    askConfirm: async () => true,
  });
  await new StashManager(git, ui).run();
  expect(ui.warn).toHaveBeenCalledWith(
    expect.stringContaining("Dropped 1 of 2 selected stash(es)"),
  );
  expect(ui.success).not.toHaveBeenCalled();
});

test("an untracked-only working tree is stashed only after explicit opt-in", async () => {
  const git = createGitMock({
    describeStatus: async () => ({
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: ["new.txt"],
    }),
  });
  const ui = createUIMock({
    ...selectAction("push"),
    askConfirm: mock().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
  });
  const flow = new StashManager(git, ui);
  await flow.run();
  expect(git.stashWithMessage).not.toHaveBeenCalled();
  await flow.run();
  expect(git.stashWithMessage).toHaveBeenCalledWith("", true);
});

test("Stash keeps the list intact on an empty drop selection or a non-Error failure", async () => {
  const git = createGitMock({
    getStashes: async () => STASHES,
    stashDrop: mock().mockRejectedValue("stash list unavailable"),
  });
  const ui = createUIMock({
    ...selectAction("drop"),
    askSearchMultiSelect: mock().mockResolvedValueOnce([]).mockResolvedValue(STASHES),
    askConfirm: async () => true,
  });
  const flow = new StashManager(git, ui);
  await flow.run();
  expect(git.stashDrop).not.toHaveBeenCalled();
  await flow.run();
  expect(git.stashDrop).toHaveBeenCalledTimes(1);
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("stash list unavailable"));
});

test("a textual stash apply failure reports the selected identity without success", async () => {
  const git = createGitMock({
    getStashes: async () => STASHES,
    stashApply: mock().mockRejectedValue("working tree locked"),
  });
  const ui = createUIMock({
    ...selectAction("apply"),
    askSearchSelect: async () => first,
    askConfirm: async () => true,
  });
  await new StashManager(git, ui).run();
  expect(ui.info).toHaveBeenCalledWith("No diff available for this stash.");
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("working tree locked"));
  expect(ui.success).not.toHaveBeenCalled();
});

test("Stash stops before writing if a Git operation became pending", async () => {
  const git = createGitMock({
    describeStatus: async () => ({
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: ["readme.txt"],
      untracked: [],
    }),
    getInProgressOperation: async () => "rebase",
  });
  const ui = createUIMock({ ...selectAction("push") });
  await new StashManager(git, ui).run();
  expect(git.stashWithMessage).not.toHaveBeenCalled();
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Git operation changed"));
});
