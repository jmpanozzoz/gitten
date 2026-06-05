import { expect, mock, test } from "bun:test";
import { StashManager } from "../../src/core/stash-manager";
import { GoBackSignal } from "../../src/ui/go-back";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const STASHES = [
  { index: 0, message: "WIP on feat/login: abc1234 feat: add form", date: "2 hours ago" },
  { index: 1, message: "WIP on main: def5678 chore: update deps", date: "yesterday" },
];

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
  expect(ui.askMultiSelect).not.toHaveBeenCalled();
});

// ─── apply / pop ──────────────────────────────────────────────────────────────

test("applies selected stash with pop when user chooses pop mode", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    stashPop: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("apply")
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce("pop"),
  });

  await new StashManager(git, ui).run();

  expect(git.stashPop).toHaveBeenCalledWith(0);
});

test("applies selected stash without dropping when user chooses apply mode", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    stashApply: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("apply")
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce("apply"),
  });

  await new StashManager(git, ui).run();

  expect(git.stashApply).toHaveBeenCalledWith(0);
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
    askMultiSelect: mock(() => Promise.resolve(["0", "1"])),
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
    askMultiSelect: mock(() => Promise.resolve(["0", "1"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new StashManager(git, ui).run();

  const calls = (git.stashDrop as ReturnType<typeof mock>).mock.calls.map((c) => c[0]);
  expect(calls[0]).toBeGreaterThan(calls[1]);
});

test("aborts drop when user declines confirmation", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    stashDrop: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("drop")),
    askMultiSelect: mock(() => Promise.resolve(["0"])),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new StashManager(git, ui).run();

  expect(git.stashDrop).not.toHaveBeenCalled();
});

// ─── push (stash current changes) ────────────────────────────────────────────

test("stashes current changes with optional message", async () => {
  const git = createGitMock({
    getStatus: mock(() =>
      Promise.resolve({
        files: [{ path: "src/app.ts", status: "M" }],
        isClean: () => false,
        hasStagedChanges: () => false,
        commitsAhead: 0,
        commitsBehind: 0,
      }),
    ),
    stashWithMessage: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...selectAction("push"),
    askText: mock(() => Promise.resolve("WIP: half-done feature")),
  });

  await new StashManager(git, ui).run();

  expect(git.stashWithMessage).toHaveBeenCalledWith("WIP: half-done feature");
});

test("aborts stash push when working tree is clean", async () => {
  const git = createGitMock({
    getStatus: mock(() =>
      Promise.resolve({
        files: [],
        isClean: () => true,
        hasStagedChanges: () => false,
        commitsAhead: 0,
        commitsBehind: 0,
      }),
    ),
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
    askSelect: mock()
      .mockResolvedValueOnce("apply")
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce("pop"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new StashManager(git, ui).run();

  expect(git.getStashDiff).toHaveBeenCalledWith(0);
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("+const x = 1;"));
  expect(git.stashPop).toHaveBeenCalledWith(0);
});

test("skips preview and applies directly when user declines preview", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    getStashDiff: mock(() => Promise.resolve("+const x = 1;")),
    stashPop: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("apply")
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce("pop"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new StashManager(git, ui).run();

  expect(git.getStashDiff).not.toHaveBeenCalled();
  expect(git.stashPop).toHaveBeenCalledWith(0);
});

// ─── stash stat display ───────────────────────────────────────────────────────

test("shows file count and insertion/deletion stat before preview prompt", async () => {
  const git = createGitMock({
    getStashes: mock(() => Promise.resolve(STASHES)),
    getStashStat: mock(() => Promise.resolve({ filesChanged: 3, insertions: 12, deletions: 4 })),
    stashPop: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("apply")
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce("pop"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new StashManager(git, ui).run();

  expect(git.getStashStat).toHaveBeenCalledWith(0);
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
