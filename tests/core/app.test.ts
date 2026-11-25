import { expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../../src/app";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const noAI = () => Promise.resolve(null);
const noUpdate = () => Promise.resolve(null);

const EXIT_MENU = { askSearchSelect: mock(() => Promise.resolve("exit" as never)) };

test("shows outro and returns when not a repo and user declines init", async () => {
  const git = createGitMock({ checkIsRepo: mock(() => Promise.resolve(false)) });
  const ui = createUIMock({ askConfirm: mock(() => Promise.resolve(false)) });

  await app(git, ui, noAI, noUpdate);

  expect(ui.outro).toHaveBeenCalledTimes(1);
  expect(ui.outro).toHaveBeenCalledWith("Repository initialization cancelled.");
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

  await app(git, ui, noAI, noUpdate);

  expect(git.initRepo).toHaveBeenCalledTimes(1);
  expect(ui.outro).toHaveBeenCalledTimes(1);
});

test("reports an index lock without deleting it or opening the menu", async () => {
  const git = createGitMock({ hasIndexLock: mock(() => Promise.resolve(true)) });
  const ui = createUIMock();
  await expect(app(git, ui, noAI, noUpdate)).resolves.toBe(1);
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("locked index"));
  expect(ui.askSearchSelect).not.toHaveBeenCalled();
});

test("renders menu and exits cleanly when user picks Exit", async () => {
  const git = createGitMock();
  const ui = createUIMock({ ...EXIT_MENU });

  await app(git, ui, noAI, noUpdate);

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

  await app(git, ui, noAI, noUpdate);

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

  await app(git, ui, noAI, noUpdate);

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
    askSelect: mock().mockResolvedValueOnce("remotes").mockResolvedValueOnce("add"),
    askConfirm: mock(() => Promise.resolve(false)),
    askText: mock(() => Promise.resolve("origin")),
  });

  await app(git, ui, noAI, noUpdate);

  expect(git.getRemotes).toHaveBeenCalled();
});

test("dispatches to settings handler from more submenu", async () => {
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("more" as never)
      .mockResolvedValueOnce("exit" as never),
    askSelect: mock().mockResolvedValueOnce("settings").mockResolvedValueOnce("disable"),
  });

  await app(createGitMock(), ui, noAI, noUpdate);

  expect(ui.askSelect).toHaveBeenCalledTimes(2);
  expect(ui.askSearchSelect).toHaveBeenCalledTimes(2);
});

test("Repository Status resumes Bisect through the configured CLI action", async () => {
  const git = createGitMock({ getInProgressOperation: async () => "bisect" });
  const readAI = mock(async () => ({
    provider: "custom",
    baseUrl: "https://example.invalid/v1",
    model: "fixture",
    apiKey: "fixture-key",
    enabled: true,
  }));
  const ui = createUIMock({
    askSearchSelect: mock().mockResolvedValueOnce("status").mockResolvedValue("exit"),
    askSelect: mock().mockResolvedValueOnce("recover").mockResolvedValue("stop"),
  });
  await app(git, ui, readAI, noUpdate);
  expect(readAI).toHaveBeenCalledTimes(1);
  expect(git.bisectStart).not.toHaveBeenCalled();
  expect(git.bisectReset).toHaveBeenCalledTimes(1);
  expect(ui.info).toHaveBeenCalledWith("Bisect cancelled.");
});

test("the CLI reads project preferences from the Git root for Effective Settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "gitten-effective-root-"));
  try {
    writeFileSync(join(root, ".gittenrc"), '{"limits":{"undoCommitLimit":47}}');
    const git = createGitMock({ getRepositoryRoot: async () => root });
    const ui = createUIMock({
      askSearchSelect: mock().mockResolvedValueOnce("more").mockResolvedValue("exit"),
      askSelect: mock().mockResolvedValueOnce("settings").mockResolvedValue("effective"),
    });
    await app(git, ui, noAI, noUpdate);
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("Undo history: 47 (.gittenrc)"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dispatches to amend handler from more submenu", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve({ hash: "abc1234", message: "chore: update" })),
    getStatus: mock(() =>
      Promise.resolve({
        files: [],
        isClean: () => true,
        commitsAhead: 0,
        commitsBehind: 0,
      }),
    ),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("more" as never)
      .mockResolvedValueOnce("exit" as never),
    askSelect: mock().mockResolvedValueOnce("amend").mockResolvedValueOnce("message"),
    askText: mock(() => Promise.resolve("fix: amended")),
  });

  await app(git, ui, noAI, noUpdate);

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

  await app(git, ui, noAI, noUpdate);

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

  await app(git, ui, noAI, noUpdate);

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
    askSelect: mock().mockResolvedValueOnce("worktree").mockResolvedValueOnce("list"),
  });

  await app(git, ui, noAI, noUpdate);

  expect(git.getWorktrees).toHaveBeenCalled();
});

test("returns to main menu when ESC pressed in more submenu", async () => {
  const { GoBackSignal } = await import("../../src/core/domain/navigation");
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("more" as never)
      .mockResolvedValueOnce("exit" as never),
    askSelect: mock().mockRejectedValueOnce(new GoBackSignal()),
  });

  await app(createGitMock(), ui, noAI, noUpdate);

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
      }),
    ),
  });
  const ui = createUIMock({ askSearchSelect: mock(() => Promise.resolve("exit" as never)) });

  await app(git, ui, noAI, noUpdate);

  const contextCall = (ui.context as ReturnType<typeof mock>).mock.calls[0]?.[0] as string;
  expect(contextCall).toContain("+47");
  expect(contextCall).toContain("−12");
  expect(contextCall).toContain("3 files");
});

test("omits diff stats in context header when working tree is clean", async () => {
  const ui = createUIMock({ askSearchSelect: mock(() => Promise.resolve("exit" as never)) });

  await app(createGitMock(), ui, noAI, noUpdate);

  const contextCall = (ui.context as ReturnType<typeof mock>).mock.calls[0]?.[0] as string;
  expect(contextCall).toBeDefined();
  expect(contextCall).not.toMatch(/\+\d/);
  expect(contextCall).not.toMatch(/−\d/);
});

test("reports a failed command and returns to the menu", async () => {
  const git = createGitMock({
    getRemotes: async () => {
      throw new Error("remote unavailable");
    },
  });
  const ui = createUIMock({
    askSearchSelect: mock().mockResolvedValueOnce("remotes").mockResolvedValueOnce("exit"),
  });
  await expect(app(git, ui, noAI, noUpdate)).resolves.toBe(0);
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("remote unavailable"));
  expect(ui.askSearchSelect).toHaveBeenCalledTimes(2);
});

test("reports an available update and exits normally", async () => {
  const ui = createUIMock({ askSearchSelect: async () => "exit" });
  await expect(app(createGitMock(), ui, noAI, async () => "2.0.0")).resolves.toBe(0);
  expect(ui.info).toHaveBeenCalledWith(
    "Update available: v2.0.0. Get the release for your platform at https://github.com/jmpanozzoz/gitten/releases/latest",
  );
});

test("returns normally when the user cancels linking a remote after initialization", async () => {
  const git = createGitMock({ checkIsRepo: async () => false });
  const ui = createUIMock({
    askConfirm: mock().mockResolvedValueOnce(true).mockRejectedValueOnce(new GoBackSignal()),
  });
  await expect(app(git, ui, noAI, noUpdate)).resolves.toBe(0);
  expect(git.initRepo).toHaveBeenCalledTimes(1);
  expect(git.addRemote).not.toHaveBeenCalled();
  expect(ui.outro).toHaveBeenCalledWith(expect.stringContaining("Repository ready locally"));
});

test("reports both the completed initialization and a non-Error remote setup failure", async () => {
  const git = createGitMock({
    checkIsRepo: async () => false,
    addRemote: () => Promise.reject("remote setup refused"),
  });
  const ui = createUIMock({ askConfirm: async () => true, askText: async () => "origin" });
  await expect(app(git, ui, noAI, noUpdate)).resolves.toBe(1);
  expect(git.initRepo).toHaveBeenCalledTimes(1);
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("remote setup refused"));
  expect(ui.outro).not.toHaveBeenCalled();
});

test("an unexpected initialization prompt failure reaches the CLI error boundary", async () => {
  const git = createGitMock({ checkIsRepo: async () => false });
  const ui = createUIMock({ askConfirm: () => Promise.reject(new Error("prompt failed")) });
  await expect(app(git, ui, noAI, noUpdate)).rejects.toThrow("prompt failed");
  expect(git.initRepo).not.toHaveBeenCalled();
});

test("reports a genuine initialization failure instead of announcing completion", async () => {
  const git = createGitMock({
    checkIsRepo: async () => false,
    initRepo: async () => {
      throw new Error("read-only checkout");
    },
  });
  const ui = createUIMock({ askConfirm: async () => true });
  await expect(app(git, ui, noAI, noUpdate)).rejects.toThrow("read-only checkout");
  expect(ui.outro).not.toHaveBeenCalled();
});

test.each([
  ["switch", "getTrackingBranches", ""],
  ["cherry", "getBranches", ""],
  ["pull", "getRemotes", ""],
  ["sync", "getStatus", ""],
  ["push", "getRemotes", ""],
  ["stash", "getStashes", "apply"],
  ["status", "describeStatus", ""],
  ["undo", "readRewriteHistory", ""],
  ["purge", "filterRepoAvailable", ""],
  ["reset", "getStatus", "discard"],
  ["revert", "getLog", ""],
  ["diff", "readDiff", "working"],
  ["log", "readLogPage", ""],
  ["squash", "readRewriteHistory", ""],
] as const)("routes the searchable %s menu choice to its Git operation", async (choice, operation, selection) => {
  const git = createGitMock();
  const ui = createUIMock({
    askSearchSelect: mock().mockResolvedValueOnce(choice).mockResolvedValueOnce("exit"),
    askSelect: mock().mockResolvedValue(selection),
  });

  await expect(app(git, ui, noAI, noUpdate)).resolves.toBe(0);
  expect(git[operation]).toHaveBeenCalled();
  expect(ui.error).not.toHaveBeenCalled();
});

test("Escape on the gitignore action returns to a menu that shows ahead and behind counts", async () => {
  const git = createGitMock({
    getRepoContext: async () => ({
      branch: "feat/sync",
      commitsAhead: 2,
      commitsBehind: 3,
      insertions: 0,
      deletions: 0,
      modifiedCount: 0,
    }),
  });
  const ui = createUIMock({
    askSearchSelect: mock()
      .mockResolvedValueOnce("gitignore")
      .mockRejectedValueOnce(new GoBackSignal()),
    askSelect: mock().mockRejectedValueOnce(new GoBackSignal()),
  });

  await expect(app(git, ui, noAI, noUpdate)).resolves.toBe(0);
  expect(ui.askSelect).toHaveBeenCalledWith("Manage .gitignore:", expect.any(Array));
  expect(ui.context).toHaveBeenCalledWith(
    expect.stringContaining("feat/sync · 2 ahead · 3 behind"),
  );
  expect(ui.error).not.toHaveBeenCalled();
});

test("keeps menu selection failures visible and reports non-Error action failures", async () => {
  const ui = createUIMock({
    askSearchSelect: async () => {
      throw new Error("terminal disconnected");
    },
  });
  await expect(app(createGitMock(), ui, noAI, noUpdate)).rejects.toThrow("terminal disconnected");
  const recovering = createUIMock({
    askSearchSelect: mock().mockResolvedValueOnce("remotes").mockResolvedValueOnce("exit"),
  });
  const git = createGitMock({ getRemotes: mock().mockRejectedValueOnce("remote connection lost") });
  await expect(app(git, recovering, noAI, noUpdate)).resolves.toBe(0);
  expect(recovering.error).toHaveBeenCalledWith(expect.stringContaining("remote connection lost"));
});
