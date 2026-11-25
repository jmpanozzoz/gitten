import { expect, mock, test } from "bun:test";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { GitignoreManager } from "../../src/core/gitignore-manager";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

// ─── helpers ────────────────────────────────────────────────────────────────

const EMPTY_GITIGNORE: string[] = [];
const EXISTING_GITIGNORE = ["node_modules/", "dist/", ".DS_Store"];
const NO_TRACKED = { getTrackedFiles: mock(() => Promise.resolve([])) };

function selectAction(action: "add" | "template" | "view" | "ai") {
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
  const written = (git.writeGitignore as ReturnType<typeof mock>).mock.calls[0]![0] as string[];
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
    getIgnoredTrackedFiles: mock()
      .mockResolvedValueOnce(["previous.txt"])
      .mockResolvedValue([".env", ".env.local", "previous.txt"]),
    untrackFiles: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...selectAction("add"),
    askText: mock(() => Promise.resolve(".env*")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new GitignoreManager(git, ui).run();

  expect(git.untrackFiles).toHaveBeenCalledTimes(1);
  const untracked = (git.untrackFiles as ReturnType<typeof mock>).mock.calls[0]![0] as string[];
  expect(untracked).toContain(".env");
  expect(untracked).toContain(".env.local");
  expect(untracked).not.toContain("previous.txt");
});

test("addPattern: skips untracking when user declines", async () => {
  const git = createGitMock({
    readGitignore: mock(() => Promise.resolve(EMPTY_GITIGNORE)),
    writeGitignore: mock(() => Promise.resolve()),
    getIgnoredTrackedFiles: mock().mockResolvedValueOnce([]).mockResolvedValueOnce([".env"]),
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
    askSelect: mock().mockResolvedValueOnce("template").mockResolvedValueOnce("node"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new GitignoreManager(git, ui).run();

  expect(git.writeGitignore).toHaveBeenCalledTimes(1);
  const written = (git.writeGitignore as ReturnType<typeof mock>).mock.calls[0]![0] as string[];
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
    askSelect: mock().mockResolvedValueOnce("template").mockResolvedValueOnce("node"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new GitignoreManager(git, ui).run();

  const written = (git.writeGitignore as ReturnType<typeof mock>).mock.calls[0]![0] as string[];
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

test("ignores blank input and rejects comments or multiline patterns before writing", async () => {
  const git = createGitMock();
  const input = mock()
    .mockResolvedValueOnce(" ")
    .mockResolvedValueOnce("# comment")
    .mockResolvedValue("first\nsecond");
  const ui = createUIMock({ ...selectAction("add"), askText: input });
  for (let index = 0; index < 3; index++) await new GitignoreManager(git, ui).run();
  expect(git.readGitignore).not.toHaveBeenCalled();
  expect(git.writeGitignore).not.toHaveBeenCalled();
  expect(ui.warn).toHaveBeenCalledTimes(2);
});

test("template previews retain existing comments, report a single addition, and skip a repeated template", async () => {
  const git = createGitMock({
    readGitignore: mock()
      .mockResolvedValueOnce(["# Notes", ".env", "!.env.example"])
      .mockResolvedValue(["# Notes", ".env", ".env.*", "!.env.example"]),
  });
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("template")
      .mockResolvedValueOnce("dotenv")
      .mockResolvedValueOnce("template")
      .mockResolvedValue("dotenv"),
  });
  const manager = new GitignoreManager(git, ui);
  await manager.run();
  await manager.run();
  expect(git.writeGitignore).toHaveBeenCalledWith(
    ["# Notes", ".env", ".env.*", "!.env.example"],
    ["# Notes", ".env", "!.env.example"],
  );
  expect(git.writeGitignore).toHaveBeenCalledTimes(1);
  expect(ui.success).toHaveBeenCalledWith("Added 1 new entry from dotenv template.");
  expect(ui.info).toHaveBeenCalledWith("All template entries are already in .gitignore.");
});

test("AI suggestions require consent and save only selected unique valid patterns", async () => {
  const git = createGitMock({
    readGitignore: async () => ["dist/"],
    getTrackedFiles: async () => ["src.ts"],
  });
  const suggest = mock(async () => [
    "dist/",
    "cache/",
    "cache/",
    "",
    "#comment",
    "one\ntwo",
    "\\#literal",
  ]);
  const askMultiSelect = mock(async () => ["\\#literal"]);
  const ui = createUIMock({
    ...selectAction("ai"),
    askConfirm: mock().mockResolvedValueOnce(false).mockResolvedValue(true),
    askMultiSelect,
  });
  const manager = new GitignoreManager(git, ui, suggest);
  await manager.run();
  expect(suggest).not.toHaveBeenCalled();
  await manager.run();
  expect(suggest).toHaveBeenCalledWith(["src.ts"], ["dist/"]);
  expect(askMultiSelect).toHaveBeenCalledWith(expect.stringContaining("2 new pattern(s)"), [
    { value: "cache/", label: "cache/" },
    { value: "\\#literal", label: "\\#literal" },
  ]);
  expect(git.writeGitignore).toHaveBeenCalledWith(["dist/", "\\#literal"], ["dist/"]);
});

test("empty, already present, and deselected AI suggestions leave .gitignore alone", async () => {
  const git = createGitMock({ readGitignore: async () => ["dist/"] });
  const suggest = mock()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(["dist/"])
    .mockResolvedValue(["cache/"]);
  const ui = createUIMock({ ...selectAction("ai"), askConfirm: async () => true });
  const manager = new GitignoreManager(git, ui, suggest);
  for (let i = 0; i < 3; i++) await manager.run();
  expect(ui.askMultiSelect).toHaveBeenCalledTimes(1);
  expect(git.writeGitignore).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalledWith("AI found no additional patterns to suggest.");
  expect(ui.info).toHaveBeenCalledWith("No new valid AI patterns to add.");
});

test("view distinguishes a single literal pattern from comments", async () => {
  const git = createGitMock({ readGitignore: async () => ["# note", "", "\\#literal"] });
  const ui = createUIMock({ ...selectAction("view") });
  await new GitignoreManager(git, ui).run();
  expect(ui.info).toHaveBeenCalledWith(".gitignore — 1 entry:\n  \\#literal");
});

test("a changed match list or pending Git operation keeps the saved pattern and protects the index", async () => {
  for (const pending of [false, true]) {
    const git = createGitMock({
      getIgnoredTrackedFiles: mock()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([".env.local"])
        .mockResolvedValue([".env.other"]),
      getInProgressOperation: async () => (pending ? "merge" : null),
    });
    const ui = createUIMock({
      ...selectAction("add"),
      askText: async () => ".env.*",
      askConfirm: async () => true,
    });
    await new GitignoreManager(git, ui).run();
    expect(git.writeGitignore).toHaveBeenCalledWith([".env.*"], []);
    expect(git.untrackFiles).not.toHaveBeenCalled();
    expect(ui.warn).toHaveBeenCalledWith(
      expect.stringContaining("The ignore matches or Git index changed"),
    );
  }
});

test("Escape at untrack confirmation keeps the saved pattern without reporting a failure", async () => {
  const git = createGitMock({
    getIgnoredTrackedFiles: mock().mockResolvedValueOnce([]).mockResolvedValue([".env"]),
  });
  const ui = createUIMock({
    ...selectAction("add"),
    askText: async () => ".env",
    askConfirm: mock().mockRejectedValue(new GoBackSignal()),
  });
  await expect(new GitignoreManager(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(git.writeGitignore).toHaveBeenCalledWith([".env"], []);
  expect(git.untrackFiles).not.toHaveBeenCalled();
  expect(ui.error).not.toHaveBeenCalled();
});

test("Gitignore quotes path line breaks and reports a textual index failure separately", async () => {
  const path = "first\nsecond.tmp";
  const git = createGitMock({
    getIgnoredTrackedFiles: mock().mockResolvedValueOnce([]).mockResolvedValue([path]),
    untrackFiles: mock().mockRejectedValue("index unavailable"),
  });
  const ui = createUIMock({
    ...selectAction("add"),
    askText: async () => "*.tmp",
    askConfirm: async () => true,
  });
  await new GitignoreManager(git, ui).run();
  expect(ui.info).toHaveBeenCalledWith('Paths to remove from the index:\n  "first\\nsecond.tmp"');
  expect(git.untrackFiles).toHaveBeenCalledWith([path]);
  expect(ui.error).toHaveBeenCalledWith(
    "The pattern was saved, but removing files from the index did not complete.\nindex unavailable",
  );
});
