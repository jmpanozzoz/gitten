import { test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { app } from "../../src/app";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const EXIT_MENU = { askSearchSelect: mock(() => Promise.resolve("exit" as never)) };

beforeEach(() => {
  mock.module("../../src/config/config", () => ({
    readConfig: mock(() => Promise.resolve({})),
    writeConfig: mock(() => Promise.resolve()),
    getActiveAIConfig: mock(() => Promise.resolve(null)),
  }));
  mock.module("../../src/utils/update-checker", () => ({
    checkForUpdate: mock(() => Promise.resolve(null)),
  }));
});

afterEach(() => {
  mock.restore();
});

test("shows outro and returns when not a repo and user declines init", async () => {
  const git = createGitMock({ checkIsRepo: mock(() => Promise.resolve(false)) });
  const ui = createUIMock({ askConfirm: mock(() => Promise.resolve(false)) });

  await app(git, ui);

  expect(ui.outro).toHaveBeenCalledTimes(1);
  expect(git.initRepo).not.toHaveBeenCalled();
});

test("calls initRepo and shows outro when not a repo and user confirms init", async () => {
  const git = createGitMock({
    checkIsRepo: mock(() => Promise.resolve(false)),
    initRepo: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askConfirm: mock(() => Promise.resolve(true)),
    askText: mock(() => Promise.resolve("origin")),
  });

  await app(git, ui);

  expect(git.initRepo).toHaveBeenCalledTimes(1);
  expect(ui.outro).toHaveBeenCalledTimes(1);
});

test("warns and calls process.exit(1) when index lock is present", async () => {
  const git = createGitMock({ hasIndexLock: mock(() => Promise.resolve(true)) });
  const ui = createUIMock();
  const exitSpy = spyOn(process, "exit").mockImplementation((() => {
    throw new Error("EXIT");
  }) as never);

  await expect(app(git, ui)).rejects.toThrow("EXIT");

  expect(ui.warn).toHaveBeenCalledTimes(1);
  expect(exitSpy).toHaveBeenCalledWith(1);
  exitSpy.mockRestore();
});

test("renders menu and exits cleanly when user picks Exit", async () => {
  const git = createGitMock();
  const ui = createUIMock({ ...EXIT_MENU });

  await app(git, ui);

  expect(ui.intro).toHaveBeenCalledTimes(1);
  expect(ui.outro).toHaveBeenCalledTimes(1);
  expect(ui.askSearchSelect).toHaveBeenCalledTimes(1);
});

test("loops back to menu after each action before exit", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: [], current: "main" })),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("clean" as never)
      .mockResolvedValueOnce("exit" as never),
  });

  await app(git, ui);

  expect(ui.askSearchSelect).toHaveBeenCalledTimes(2);
  expect(ui.outro).toHaveBeenCalledTimes(1);
});

test("dispatches 'branch' choice to BranchCreator", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: [], current: "main" })),
    branchExists: mock(() => Promise.resolve(false)),
    checkoutNewBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("branch" as never)
      .mockResolvedValueOnce("exit" as never),
    askSelect: mock().mockResolvedValueOnce("feat"),
    askText: mock(() => Promise.resolve("my feature")),
  });

  await app(git, ui);

  expect(git.checkoutNewBranch).toHaveBeenCalledWith("feat/my-feature");
});

// ─── more submenu ─────────────────────────────────────────────────────────────

test("dispatches to remotes handler from more submenu", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("more" as never)
      .mockResolvedValueOnce("exit" as never),
    askSelect: mock()
      .mockResolvedValueOnce("remotes")
      .mockResolvedValueOnce("add"),
    askConfirm: mock(() => Promise.resolve(false)),
    askText: mock(() => Promise.resolve("origin")),
  });

  await app(git, ui);

  expect(git.getRemotes).toHaveBeenCalled();
});

test("dispatches to settings handler from more submenu", async () => {
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("more" as never)
      .mockResolvedValueOnce("exit" as never),
    askSelect: mock()
      .mockResolvedValueOnce("settings")
      .mockResolvedValueOnce("disable"),
  });

  await app(createGitMock(), ui);

  expect(ui.askSelect).toHaveBeenCalledTimes(2);
  expect(ui.askSearchSelect).toHaveBeenCalledTimes(2);
});

test("dispatches to amend handler from more submenu", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve({ hash: "abc1234", message: "chore: update" })),
    getStatus: mock(() => Promise.resolve({ files: [], isClean: () => true, hasStagedChanges: () => false, commitsAhead: 0, commitsBehind: 0 })),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("more" as never)
      .mockResolvedValueOnce("exit" as never),
    askSelect: mock()
      .mockResolvedValueOnce("amend")
      .mockResolvedValueOnce("message"),
    askText: mock(() => Promise.resolve("fix: amended")),
  });

  await app(git, ui);

  expect(git.getLastCommit).toHaveBeenCalled();
});

test("dispatches to tag handler from more submenu", async () => {
  const git = createGitMock({
    getLastTag: mock(() => Promise.resolve("v1.0.0")),
    getLogSince: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("more" as never)
      .mockResolvedValueOnce("exit" as never),
    askSelect: mock().mockResolvedValueOnce("tag"),
  });

  await app(git, ui);

  expect(git.getLastTag).toHaveBeenCalled();
});

test("dispatches to bisect handler from more submenu", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("main")),
    getLog: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("more" as never)
      .mockResolvedValueOnce("exit" as never),
    askSelect: mock().mockResolvedValueOnce("bisect"),
  });

  await app(git, ui);

  expect(git.getLog).toHaveBeenCalled();
});

test("dispatches to worktree handler from more submenu", async () => {
  const git = createGitMock({
    getWorktrees: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("more" as never)
      .mockResolvedValueOnce("exit" as never),
    askSelect: mock()
      .mockResolvedValueOnce("worktree")
      .mockResolvedValueOnce("list"),
  });

  await app(git, ui);

  expect(git.getWorktrees).toHaveBeenCalled();
});

test("returns to main menu when ESC pressed in more submenu", async () => {
  const { GoBackSignal } = await import("../../src/ui/go-back");
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("more" as never)
      .mockResolvedValueOnce("exit" as never),
    askSelect: mock().mockRejectedValueOnce(new GoBackSignal()),
  });

  await app(createGitMock(), ui);

  expect(ui.outro).toHaveBeenCalledTimes(1);
  expect(ui.askSearchSelect).toHaveBeenCalledTimes(2);
  expect(ui.askSelect).toHaveBeenCalledTimes(1);
});

// ─── diff stats in header ─────────────────────────────────────────────────────

test("shows diff stats in context header when files are modified", async () => {
  const git = createGitMock({
    getRepoContext: mock(() =>
      Promise.resolve({
        branch: "feat/test",
        modifiedCount: 3,
        commitsAhead: 0,
        commitsBehind: 0,
        insertions: 47,
        deletions: 12,
      })
    ),
  });
  const ui = createUIMock({ askSearchSelect: mock(() => Promise.resolve("exit" as never)) });

  await app(git, ui);

  const contextCall = (ui.context as ReturnType<typeof mock>).mock.calls[0]?.[0] as string;
  expect(contextCall).toContain("+47");
  expect(contextCall).toContain("−12");
  expect(contextCall).toContain("3 files");
});

test("omits diff stats in context header when working tree is clean", async () => {
  const ui = createUIMock({ askSearchSelect: mock(() => Promise.resolve("exit" as never)) });

  await app(createGitMock(), ui);

  const contextCall = (ui.context as ReturnType<typeof mock>).mock.calls[0]?.[0] as string;
  expect(contextCall).toBeDefined();
  expect(contextCall).not.toMatch(/\+\d/);
  expect(contextCall).not.toMatch(/−\d/);
});
