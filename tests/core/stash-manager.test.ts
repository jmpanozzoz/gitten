import { test, expect, mock } from "bun:test";
import { StashManager } from "../../src/core/stash-manager";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const STASHES = [
  { index: 0, message: "WIP on feat/login: abc1234 feat: add form", date: "2 hours ago" },
  { index: 1, message: "WIP on main: def5678 chore: update deps", date: "yesterday" },
];

function selectAction(action: "apply" | "drop" | "push" | "back") {
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
    askMultiSelect: mock(() => Promise.resolve([0, 1])),
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
    askMultiSelect: mock(() => Promise.resolve([0, 1])),
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
    askMultiSelect: mock(() => Promise.resolve([0])),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new StashManager(git, ui).run();

  expect(git.stashDrop).not.toHaveBeenCalled();
});

// ─── push (stash current changes) ────────────────────────────────────────────

test("stashes current changes with optional message", async () => {
  const git = createGitMock({
    getStatus: mock(() =>
      Promise.resolve({ files: [{ path: "src/app.ts", status: "M" }], isClean: () => false })
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
    getStatus: mock(() => Promise.resolve({ files: [], isClean: () => true })),
    stashWithMessage: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({ ...selectAction("push") });

  await new StashManager(git, ui).run();

  expect(git.stashWithMessage).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalled();
});

// ─── back ─────────────────────────────────────────────────────────────────────

test("returns immediately when user selects back", async () => {
  const git = createGitMock();
  const ui = createUIMock({ ...selectAction("back") });

  await new StashManager(git, ui).run();

  expect(git.getStashes).not.toHaveBeenCalled();
});
