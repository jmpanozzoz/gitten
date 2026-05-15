import { test, expect, mock, spyOn, afterEach } from "bun:test";
import { app } from "../../src/app";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const EXIT_MENU = { askSelect: mock(() => Promise.resolve("exit")) };

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
  expect(ui.askSelect).toHaveBeenCalledTimes(1);
});

test("loops back to menu after each action before exit", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: [], current: "main" })),
  });
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("clean")
      .mockResolvedValueOnce("exit"),
  });

  await app(git, ui);

  expect(ui.askSelect).toHaveBeenCalledTimes(2);
  expect(ui.outro).toHaveBeenCalledTimes(1);
});

test("dispatches 'branch' choice to BranchCreator", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: [], current: "main" })),
    branchExists: mock(() => Promise.resolve(false)),
    checkoutNewBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("branch")
      .mockResolvedValueOnce("feat")
      .mockResolvedValueOnce("exit"),
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
    askSelect: mock()
      .mockResolvedValueOnce("more")
      .mockResolvedValueOnce("remotes")
      .mockResolvedValueOnce("add")
      .mockResolvedValueOnce("exit"),
    askConfirm: mock(() => Promise.resolve(false)),
    askText: mock(() => Promise.resolve("origin")),
  });

  await app(git, ui);

  expect(git.getRemotes).toHaveBeenCalled();
});

test("dispatches to settings handler from more submenu", async () => {
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("more")
      .mockResolvedValueOnce("settings")
      .mockResolvedValueOnce("disable")
      .mockResolvedValueOnce("exit"),
  });

  mock.module("../../src/config/config", () => ({
    readConfig: mock(() => Promise.resolve({})),
    writeConfig: mock(() => Promise.resolve()),
    getActiveAIConfig: mock(() => Promise.resolve(null)),
  }));

  await app(createGitMock(), ui);

  expect(ui.askSelect).toHaveBeenCalledTimes(4);
});

test("returns to main menu when ESC pressed in more submenu", async () => {
  const { GoBackSignal } = await import("../../src/ui/go-back");
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("more")
      .mockRejectedValueOnce(new GoBackSignal())
      .mockResolvedValueOnce("exit"),
  });

  await app(createGitMock(), ui);

  expect(ui.outro).toHaveBeenCalledTimes(1);
  expect(ui.askSelect).toHaveBeenCalledTimes(3);
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
  const ui = createUIMock({ ...{ askSelect: mock(() => Promise.resolve("exit")) } });

  await app(git, ui);

  const contextCall = (ui.context as ReturnType<typeof mock>).mock.calls[0]?.[0] as string;
  expect(contextCall).toContain("+47");
  expect(contextCall).toContain("−12");
  expect(contextCall).toContain("3 files");
});

test("omits diff stats in context header when working tree is clean", async () => {
  const git = createGitMock({
    getRepoContext: mock(() =>
      Promise.resolve({
        branch: "main",
        modifiedCount: 0,
        commitsAhead: 0,
        commitsBehind: 0,
        insertions: 0,
        deletions: 0,
      })
    ),
  });
  const ui = createUIMock({ ...{ askSelect: mock(() => Promise.resolve("exit")) } });

  await app(git, ui);

  const contextCall = (ui.context as ReturnType<typeof mock>).mock.calls[0]?.[0] as string;
  expect(contextCall).not.toContain("+");
  expect(contextCall).not.toContain("−");
});
