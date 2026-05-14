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
