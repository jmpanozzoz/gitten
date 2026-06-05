import { expect, mock, test } from "bun:test";
import type { WorktreeEntry } from "../../src/core/ports/git-client.port";
import { WorktreeManager } from "../../src/core/worktree-manager";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const WORKTREES: WorktreeEntry[] = [
  { path: "/repo", branch: "main", isMain: true, isLocked: false },
  { path: "/repo-feat", branch: "feat/login", isMain: false, isLocked: false },
];

// ─── list ─────────────────────────────────────────────────────────────────────

test("shows list of worktrees on list action", async () => {
  const git = createGitMock({
    getWorktrees: mock(() => Promise.resolve(WORKTREES)),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("list")),
  });

  await new WorktreeManager(git, ui).run();

  expect(git.getWorktrees).toHaveBeenCalledTimes(1);
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("feat/login"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("main"));
});

// ─── add worktree ─────────────────────────────────────────────────────────────

test("adds worktree with existing branch when user selects existing", async () => {
  const git = createGitMock({
    getWorktrees: mock(() => Promise.resolve(WORKTREES)),
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/login", "feat/other"], current: "main" }),
    ),
    addWorktree: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("add").mockResolvedValueOnce("existing"),
    askText: mock(() => Promise.resolve("../repo-other")),
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
  });

  await new WorktreeManager(git, ui).run();

  expect(git.addWorktree).toHaveBeenCalledWith("../repo-other", "feat/other", false);
  expect(ui.success).toHaveBeenCalled();
});

test("adds worktree with new branch when user selects new", async () => {
  const git = createGitMock({
    getWorktrees: mock(() => Promise.resolve(WORKTREES)),
    addWorktree: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("add").mockResolvedValueOnce("new"),
    askText: mock().mockResolvedValueOnce("../repo-hotfix").mockResolvedValueOnce("hotfix/payment"),
  });

  await new WorktreeManager(git, ui).run();

  expect(git.addWorktree).toHaveBeenCalledWith("../repo-hotfix", "hotfix/payment", true);
});

// ─── remove worktree ──────────────────────────────────────────────────────────

test("removes selected non-main worktree after confirmation", async () => {
  const git = createGitMock({
    getWorktrees: mock(() => Promise.resolve(WORKTREES)),
    removeWorktree: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remove")),
    askSearchSelect: mock(() => Promise.resolve("/repo-feat")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new WorktreeManager(git, ui).run();

  expect(git.removeWorktree).toHaveBeenCalledWith("/repo-feat");
  expect(ui.success).toHaveBeenCalled();
});

test("skips removal when user declines confirmation", async () => {
  const git = createGitMock({
    getWorktrees: mock(() => Promise.resolve(WORKTREES)),
    removeWorktree: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remove")),
    askSearchSelect: mock(() => Promise.resolve("/repo-feat")),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new WorktreeManager(git, ui).run();

  expect(git.removeWorktree).not.toHaveBeenCalled();
});

test("warns when no non-main worktrees exist for removal", async () => {
  const git = createGitMock({
    getWorktrees: mock(() => Promise.resolve([WORKTREES[0]!])),
    removeWorktree: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remove")),
  });

  await new WorktreeManager(git, ui).run();

  expect(ui.warn).toHaveBeenCalled();
  expect(git.removeWorktree).not.toHaveBeenCalled();
});

// ─── error handling ───────────────────────────────────────────────────────────

test("shows error and returns when addWorktree fails", async () => {
  const git = createGitMock({
    getWorktrees: mock(() =>
      Promise.resolve([{ path: "/repo", branch: "main", isMain: true, isLocked: false }]),
    ),
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "main" })),
    addWorktree: mock(() => Promise.reject(new Error("destination path already exists"))),
  });
  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("add").mockResolvedValueOnce("existing"),
    askText: mock(() => Promise.resolve("../repo-other")),
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
  });

  await new WorktreeManager(git, ui).run();

  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("destination path already exists"));
  expect(ui.success).not.toHaveBeenCalled();
});

test("shows error and returns when removeWorktree fails", async () => {
  const WORKTREES_WITH_EXTRA = [
    { path: "/repo", branch: "main", isMain: true, isLocked: false },
    { path: "/repo-feat", branch: "feat/login", isMain: false, isLocked: false },
  ];
  const git = createGitMock({
    getWorktrees: mock(() => Promise.resolve(WORKTREES_WITH_EXTRA)),
    removeWorktree: mock(() => Promise.reject(new Error("worktree is locked"))),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remove")),
    askSearchSelect: mock(() => Promise.resolve("/repo-feat")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new WorktreeManager(git, ui).run();

  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("worktree is locked"));
  expect(ui.success).not.toHaveBeenCalled();
});
