import { test, expect, mock } from "bun:test";
import { CherryPicker } from "../../src/core/cherry-picker";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const COMMITS = [
  { hash: "abc1234", message: "feat: add login" },
  { hash: "def5678", message: "fix: typo in header" },
];

test("shows info when there are no other branches", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main"], current: "main" })),
  });
  const ui = createUIMock();

  await new CherryPicker(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(git.cherryPick).not.toHaveBeenCalled();
});

test("shows info when selected branch has no commits", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/other"], current: "main" })
    ),
    getLog: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other" as never)),
  });

  await new CherryPicker(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(git.cherryPick).not.toHaveBeenCalled();
});

test("excludes current branch from source branch list", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/a", "feat/b"], current: "feat/a" })
    ),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });

  const askSearchSelect = mock()
    .mockResolvedValueOnce("main")
    .mockResolvedValueOnce("abc1234");
  const ui = createUIMock({ askSearchSelect });

  await new CherryPicker(git, ui).run();

  const firstCallOptions = (askSearchSelect.mock.calls[0] as unknown[])[1] as { value: string }[];
  expect(firstCallOptions.map((o) => o.value)).not.toContain("feat/a");
  expect(firstCallOptions.map((o) => o.value)).toContain("main");
  expect(firstCallOptions.map((o) => o.value)).toContain("feat/b");
});

test("calls cherryPick with the selected commit hash", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/other"], current: "main" })
    ),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });
  const askSearchSelect = mock()
    .mockResolvedValueOnce("feat/other")
    .mockResolvedValueOnce("def5678");
  const ui = createUIMock({ askSearchSelect });

  await new CherryPicker(git, ui).run();

  expect(git.cherryPick).toHaveBeenCalledTimes(1);
  expect(git.cherryPick).toHaveBeenCalledWith("def5678");
});

test("on conflict + ENTER: calls cherryPickContinue", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/other"], current: "main" })
    ),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.reject(new Error("conflict"))),
    cherryPickContinue: mock(() => Promise.resolve()),
  });
  const askSearchSelect = mock()
    .mockResolvedValueOnce("feat/other")
    .mockResolvedValueOnce("abc1234");
  const ui = createUIMock({ askSearchSelect });
  const waitForResolution = mock(() => Promise.resolve(true));

  await new CherryPicker(git, ui, waitForResolution).run();

  expect(git.cherryPickContinue).toHaveBeenCalledTimes(1);
  expect(git.cherryPickAbort).not.toHaveBeenCalled();
});

test("on conflict + ESC: calls cherryPickAbort", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/other"], current: "main" })
    ),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.reject(new Error("conflict"))),
    cherryPickAbort: mock(() => Promise.resolve()),
  });
  const askSearchSelect = mock()
    .mockResolvedValueOnce("feat/other")
    .mockResolvedValueOnce("abc1234");
  const ui = createUIMock({ askSearchSelect });
  const waitForResolution = mock(() => Promise.resolve(false));

  await new CherryPicker(git, ui, waitForResolution).run();

  expect(git.cherryPickAbort).toHaveBeenCalledTimes(1);
  expect(git.cherryPickContinue).not.toHaveBeenCalled();
});

// ─── remote branches ─────────────────────────────────────────────────────────

test("includes remote-only branches in source branch list", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main"], current: "main" })),
    getRemoteBranches: mock(() => Promise.resolve(["feat/remote-only"])),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });
  const askSearchSelect = mock()
    .mockResolvedValueOnce("origin/feat/remote-only")
    .mockResolvedValueOnce("abc1234");
  const ui = createUIMock({ askSearchSelect });

  await new CherryPicker(git, ui).run();

  const branchOptions = (askSearchSelect.mock.calls[0] as unknown[])[1] as { value: string; label: string }[];
  expect(branchOptions.some((o) => o.value === "origin/feat/remote-only")).toBe(true);
  expect(branchOptions.some((o) => o.label.includes("remote only"))).toBe(true);
});

test("deduplicates branches already available locally", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/local"], current: "main" })),
    getRemoteBranches: mock(() => Promise.resolve(["feat/local", "feat/remote-only"])),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });
  const askSearchSelect = mock()
    .mockResolvedValueOnce("feat/local")
    .mockResolvedValueOnce("abc1234");
  const ui = createUIMock({ askSearchSelect });

  await new CherryPicker(git, ui).run();

  const branchOptions = (askSearchSelect.mock.calls[0] as unknown[])[1] as { value: string }[];
  const values = branchOptions.map((o) => o.value);
  expect(values.filter((v) => v.includes("feat/local")).length).toBe(1);
  expect(values.some((v) => v === "origin/feat/remote-only")).toBe(true);
});

// ─── diff preview ─────────────────────────────────────────────────────────────

test("shows diff preview and aborts when user declines to apply after preview", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "main" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    getCommitDiff: mock(() => Promise.resolve("+const x = 1;\n-const x = 0;")),
    cherryPick: mock(() => Promise.resolve()),
  });
  const askSearchSelect = mock()
    .mockResolvedValueOnce("feat/other")
    .mockResolvedValueOnce("abc1234");
  const ui = createUIMock({
    askSearchSelect,
    askConfirm: mock()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false),
  });

  await new CherryPicker(git, ui).run();

  expect(git.getCommitDiff).toHaveBeenCalledWith("abc1234");
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("+const x = 1;"));
  expect(git.cherryPick).not.toHaveBeenCalled();
});

test("applies commit when user confirms after preview", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "main" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    getCommitDiff: mock(() => Promise.resolve("+const x = 1;")),
    cherryPick: mock(() => Promise.resolve()),
  });
  const askSearchSelect = mock()
    .mockResolvedValueOnce("feat/other")
    .mockResolvedValueOnce("abc1234");
  const ui = createUIMock({
    askSearchSelect,
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new CherryPicker(git, ui).run();

  expect(git.cherryPick).toHaveBeenCalledWith("abc1234");
});

// ─── conflict file list ───────────────────────────────────────────────────────

test("lists conflicted files by name on cherry-pick conflict", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/other"], current: "main" })
    ),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.reject(new Error("conflict"))),
    getConflictedFiles: mock(() => Promise.resolve(["src/auth.ts", "src/utils.ts"])),
    cherryPickAbort: mock(() => Promise.resolve()),
  });
  const askSearchSelect = mock()
    .mockResolvedValueOnce("feat/other")
    .mockResolvedValueOnce("abc1234");
  const ui = createUIMock({ askSearchSelect });
  const waitForResolution = mock(() => Promise.resolve(false));

  await new CherryPicker(git, ui, waitForResolution).run();

  const warnCalls = (ui.warn as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(warnCalls.some((m) => m.includes("2 file(s)"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("src/auth.ts"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("src/utils.ts"))).toBe(true);
});

test("shows generic conflict message when git reports no conflicted files", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/other"], current: "main" })
    ),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.reject(new Error("conflict"))),
    getConflictedFiles: mock(() => Promise.resolve([])),
    cherryPickAbort: mock(() => Promise.resolve()),
  });
  const askSearchSelect = mock()
    .mockResolvedValueOnce("feat/other")
    .mockResolvedValueOnce("abc1234");
  const ui = createUIMock({ askSearchSelect });
  const waitForResolution = mock(() => Promise.resolve(false));

  await new CherryPicker(git, ui, waitForResolution).run();

  const warnCalls = (ui.warn as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(warnCalls.some((m) => m.includes("detected"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("•"))).toBe(false);
});
