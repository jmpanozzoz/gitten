import { test, expect, mock } from "bun:test";
import { GoBackSignal } from "../../src/ui/go-back";
import { GitignoreManager } from "../../src/core/gitignore-manager";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

// ─── helpers ────────────────────────────────────────────────────────────────

const EMPTY_GITIGNORE: string[] = [];
const EXISTING_GITIGNORE = ["node_modules/", "dist/", ".DS_Store"];
const NO_TRACKED = { getTrackedFiles: mock(() => Promise.resolve([])) };

function selectAction(action: "add" | "template" | "view") {
  return { askSelect: mock(() => Promise.resolve(action)) };
}

// ─── addPattern ─────────────────────────────────────────────────────────────

test("addPattern: appends new pattern to empty gitignore", async () => {
  const git = createGitMock({
    readGitignore: mock(() => Promise.resolve(EMPTY_GITIGNORE)),
    writeGitignore: mock(() => Promise.resolve()),
    ...NO_TRACKED,
  });
  const ui = createUIMock({
    ...selectAction("add"),
    askText: mock(() => Promise.resolve(".env")),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new GitignoreManager(git, ui).run();

  expect(git.writeGitignore).toHaveBeenCalledTimes(1);
  const written = (git.writeGitignore as ReturnType<typeof mock>).mock.calls[0][0] as string[];
  expect(written).toContain(".env");
});

test("addPattern: skips if pattern already exists in gitignore", async () => {
  const git = createGitMock({
    readGitignore: mock(() => Promise.resolve(["node_modules/", ".env"])),
    writeGitignore: mock(() => Promise.resolve()),
    ...NO_TRACKED,
  });
  const ui = createUIMock({
    ...selectAction("add"),
    askText: mock(() => Promise.resolve(".env")),
  });

  await new GitignoreManager(git, ui).run();

  expect(git.writeGitignore).not.toHaveBeenCalled();
  expect(ui.warn).toHaveBeenCalled();
});

test("addPattern: untracks matching tracked files when user confirms", async () => {
  const git = createGitMock({
    readGitignore: mock(() => Promise.resolve(EMPTY_GITIGNORE)),
    writeGitignore: mock(() => Promise.resolve()),
    getTrackedFiles: mock(() => Promise.resolve([".env", ".env.local", "src/app.ts"])),
    untrackFiles: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...selectAction("add"),
    askText: mock(() => Promise.resolve(".env*")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new GitignoreManager(git, ui).run();

  expect(git.untrackFiles).toHaveBeenCalledTimes(1);
  const untracked = (git.untrackFiles as ReturnType<typeof mock>).mock.calls[0][0] as string[];
  expect(untracked).toContain(".env");
  expect(untracked).toContain(".env.local");
  expect(untracked).not.toContain("src/app.ts");
});

test("addPattern: skips untracking when user declines", async () => {
  const git = createGitMock({
    readGitignore: mock(() => Promise.resolve(EMPTY_GITIGNORE)),
    writeGitignore: mock(() => Promise.resolve()),
    getTrackedFiles: mock(() => Promise.resolve([".env"])),
    untrackFiles: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...selectAction("add"),
    askText: mock(() => Promise.resolve(".env")),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new GitignoreManager(git, ui).run();

  expect(git.writeGitignore).toHaveBeenCalledTimes(1);
  expect(git.untrackFiles).not.toHaveBeenCalled();
});

test("addPattern: skips untrack prompt when no tracked files match", async () => {
  const git = createGitMock({
    readGitignore: mock(() => Promise.resolve(EMPTY_GITIGNORE)),
    writeGitignore: mock(() => Promise.resolve()),
    getTrackedFiles: mock(() => Promise.resolve(["src/app.ts", "README.md"])),
    untrackFiles: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...selectAction("add"),
    askText: mock(() => Promise.resolve(".env")),
  });

  await new GitignoreManager(git, ui).run();

  expect(git.untrackFiles).not.toHaveBeenCalled();
  expect(ui.askConfirm).not.toHaveBeenCalled();
});

// ─── applyTemplate ───────────────────────────────────────────────────────────

test("applyTemplate: writes template lines merged with existing gitignore", async () => {
  const git = createGitMock({
    readGitignore: mock(() => Promise.resolve(["node_modules/"])),
    writeGitignore: mock(() => Promise.resolve()),
    ...NO_TRACKED,
  });
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("template")
      .mockResolvedValueOnce("node"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new GitignoreManager(git, ui).run();

  expect(git.writeGitignore).toHaveBeenCalledTimes(1);
  const written = (git.writeGitignore as ReturnType<typeof mock>).mock.calls[0][0] as string[];
  expect(written).toContain("node_modules/");
  expect(written.length).toBeGreaterThan(1);
});

test("applyTemplate: deduplicates lines already present in gitignore", async () => {
  const git = createGitMock({
    readGitignore: mock(() => Promise.resolve(["node_modules/", "dist/"])),
    writeGitignore: mock(() => Promise.resolve()),
    ...NO_TRACKED,
  });
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("template")
      .mockResolvedValueOnce("node"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new GitignoreManager(git, ui).run();

  const written = (git.writeGitignore as ReturnType<typeof mock>).mock.calls[0][0] as string[];
  const nodeModulesOccurrences = written.filter((l) => l === "node_modules/").length;
  expect(nodeModulesOccurrences).toBe(1);
});

// ─── viewCurrent ─────────────────────────────────────────────────────────────

test("viewCurrent: shows line count when gitignore has entries", async () => {
  const git = createGitMock({
    readGitignore: mock(() => Promise.resolve(EXISTING_GITIGNORE)),
  });
  const ui = createUIMock({ ...selectAction("view") });

  await new GitignoreManager(git, ui).run();

  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("3"));
});

test("viewCurrent: warns when gitignore is empty or missing", async () => {
  const git = createGitMock({
    readGitignore: mock(() => Promise.resolve(EMPTY_GITIGNORE)),
  });
  const ui = createUIMock({ ...selectAction("view") });

  await new GitignoreManager(git, ui).run();

  expect(ui.warn).toHaveBeenCalled();
});

// ─── esc / go-back ────────────────────────────────────────────────────────────

test("propagates GoBackSignal when user presses ESC on action menu", async () => {
  const git = createGitMock();
  const ui = createUIMock({
    askSelect: mock(() => Promise.reject(new GoBackSignal())),
  });

  await expect(new GitignoreManager(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(git.readGitignore).not.toHaveBeenCalled();
});
