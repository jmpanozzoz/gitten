import { expect, mock, test } from "bun:test";
import { CherryPicker } from "../../src/core/cherry-picker";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

// getLog is newest-first: abc1234 is newer than def5678.
const COMMITS = [
  { hash: "abc1234", message: "feat: add login" },
  { hash: "def5678", message: "fix: typo in header" },
];

// ─── early exits ────────────────────────────────────────────────────────────

test("shows info when there are no other branches", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main"], current: "feat/test" })),
  });
  const ui = createUIMock();

  await new CherryPicker(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(git.cherryPick).not.toHaveBeenCalled();
});

test("shows info when selected branch has no commits", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other" as never)),
  });

  await new CherryPicker(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(git.cherryPick).not.toHaveBeenCalled();
});

test("returns without applying when no commits are selected", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
    askSearchMultiSelect: mock(() => Promise.resolve([])),
  });

  await new CherryPicker(git, ui).run();

  expect(git.cherryPick).not.toHaveBeenCalled();
});

// ─── source branch list ──────────────────────────────────────────────────────

test("excludes current branch from source branch list", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/a", "feat/b"], current: "feat/a" }),
    ),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });
  const askSearchSelect = mock(() => Promise.resolve("main"));
  const ui = createUIMock({
    askSearchSelect,
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new CherryPicker(git, ui).run();

  const branchOptions = (askSearchSelect.mock.calls[0] as unknown[])[1] as { value: string }[];
  expect(branchOptions.map((o) => o.value)).not.toContain("feat/a");
  expect(branchOptions.map((o) => o.value)).toContain("main");
  expect(branchOptions.map((o) => o.value)).toContain("feat/b");
});

test("includes remote-only branches in source branch list", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main"], current: "feat/test" })),
    getRemoteBranches: mock(() => Promise.resolve(["feat/remote-only"])),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });
  const askSearchSelect = mock(() => Promise.resolve("origin/feat/remote-only"));
  const ui = createUIMock({
    askSearchSelect,
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new CherryPicker(git, ui).run();

  const branchOptions = (askSearchSelect.mock.calls[0] as unknown[])[1] as {
    value: string;
    label: string;
  }[];
  expect(branchOptions.some((o) => o.value === "origin/feat/remote-only")).toBe(true);
  expect(branchOptions.some((o) => o.label.includes("remote only"))).toBe(true);
});

test("deduplicates branches already available locally", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/local"], current: "feat/test" })),
    getRemoteBranches: mock(() => Promise.resolve(["feat/local", "feat/remote-only"])),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });
  const askSearchSelect = mock(() => Promise.resolve("feat/local"));
  const ui = createUIMock({
    askSearchSelect,
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new CherryPicker(git, ui).run();

  const branchOptions = (askSearchSelect.mock.calls[0] as unknown[])[1] as { value: string }[];
  const values = branchOptions.map((o) => o.value);
  expect(values.filter((v) => v.includes("feat/local")).length).toBe(1);
  expect(values.some((v) => v === "origin/feat/remote-only")).toBe(true);
});

// ─── applying commits ──────────────────────────────────────────────────────────

test("applies the single selected commit when the plan is confirmed", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
    askSearchMultiSelect: mock(() => Promise.resolve(["def5678"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new CherryPicker(git, ui).run();

  expect(git.cherryPick).toHaveBeenCalledTimes(1);
  expect(git.cherryPick).toHaveBeenCalledWith("def5678");
});

test("applies multiple commits oldest-first", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234", "def5678"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new CherryPicker(git, ui).run();

  expect(git.cherryPick).toHaveBeenCalledTimes(2);
  const order = (git.cherryPick as ReturnType<typeof mock>).mock.calls.map((c) => c[0]);
  expect(order).toEqual(["def5678", "abc1234"]); // older commit applied first
});

test("does not apply when the user declines the plan confirmation", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234"])),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new CherryPicker(git, ui).run();

  expect(git.cherryPick).not.toHaveBeenCalled();
});

// ─── conflict handling ──────────────────────────────────────────────────────────

test("on conflict + ENTER: calls cherryPickContinue", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.reject(new Error("conflict"))),
    cherryPickContinue: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });
  const waitForResolution = mock(() => Promise.resolve(true));

  await new CherryPicker(git, ui, waitForResolution).run();

  expect(git.cherryPickContinue).toHaveBeenCalledTimes(1);
  expect(git.cherryPickAbort).not.toHaveBeenCalled();
});

test("on conflict + ESC: calls cherryPickAbort", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.reject(new Error("conflict"))),
    cherryPickAbort: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });
  const waitForResolution = mock(() => Promise.resolve(false));

  await new CherryPicker(git, ui, waitForResolution).run();

  expect(git.cherryPickAbort).toHaveBeenCalledTimes(1);
  expect(git.cherryPickContinue).not.toHaveBeenCalled();
});

test("stops the sequence when a mid-sequence conflict is aborted", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock()
      .mockResolvedValueOnce(undefined) // def5678 applies (oldest first)
      .mockRejectedValueOnce(new Error("conflict")), // abc1234 conflicts
    cherryPickAbort: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234", "def5678"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });
  const waitForResolution = mock(() => Promise.resolve(false)); // ESC → abort

  await new CherryPicker(git, ui, waitForResolution).run();

  expect(git.cherryPick).toHaveBeenCalledTimes(2);
  expect(git.cherryPickAbort).toHaveBeenCalledTimes(1);
  const warnCalls = (ui.warn as ReturnType<typeof mock>).mock.calls.map((c) => String(c[0]));
  expect(warnCalls.some((m) => m.includes("Stopped after 1 of 2"))).toBe(true);
});

test("lists conflicted files by name on cherry-pick conflict", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.reject(new Error("conflict"))),
    getConflictedFiles: mock(() => Promise.resolve(["src/auth.ts", "src/utils.ts"])),
    cherryPickAbort: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });
  const waitForResolution = mock(() => Promise.resolve(false));

  await new CherryPicker(git, ui, waitForResolution).run();

  const warnCalls = (ui.warn as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(warnCalls.some((m) => m.includes("2 file(s)"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("src/auth.ts"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("src/utils.ts"))).toBe(true);
});

test("shows generic conflict message when git reports no conflicted files", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.reject(new Error("conflict"))),
    getConflictedFiles: mock(() => Promise.resolve([])),
    cherryPickAbort: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });
  const waitForResolution = mock(() => Promise.resolve(false));

  await new CherryPicker(git, ui, waitForResolution).run();

  const warnCalls = (ui.warn as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(warnCalls.some((m) => m.includes("detected"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("•"))).toBe(false);
});

// ─── protected branch warning ─────────────────────────────────────────────────

test("warns when cherry-picking onto a protected branch and aborts if user declines", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "main" })),
  });
  const ui = createUIMock({ askConfirm: mock(() => Promise.resolve(false)) });

  await new CherryPicker(git, ui).run();

  expect(ui.askConfirm).toHaveBeenCalledWith(expect.stringContaining("main"));
  expect(git.cherryPick).not.toHaveBeenCalled();
});

test("proceeds with cherry-pick when user confirms on protected branch", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/src"], current: "main" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/src")),
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234"])),
    askConfirm: mock(() => Promise.resolve(true)), // protected-branch guard + plan confirm
  });

  await new CherryPicker(git, ui).run();

  expect(git.cherryPick).toHaveBeenCalledWith("abc1234");
});

// ─── AI commit explanation (single-commit only) ─────────────────────────────────

test("explains a single selected commit with AI", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    getCommitDiff: mock(() => Promise.resolve("diff --git a/src/app.ts...")),
    cherryPick: mock(() => Promise.resolve()),
  });
  const aiExplainer = mock(() => Promise.resolve("Adds login feature with OAuth support"));
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234"])),
    askConfirm: mock(() => Promise.resolve(false)), // decline the apply plan
  });

  await new CherryPicker(git, ui, undefined, aiExplainer).run();

  expect(aiExplainer).toHaveBeenCalledTimes(1);
  expect(aiExplainer).toHaveBeenCalledWith("diff --git a/src/app.ts...");
  const infoCalls = (ui.info as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(infoCalls.some((m) => m.includes("Adds login feature"))).toBe(true);
});

test("skips AI explanation when multiple commits are selected", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });
  const aiExplainer = mock(() => Promise.resolve("should not run for multi-select"));
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234", "def5678"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new CherryPicker(git, ui, undefined, aiExplainer).run();

  expect(aiExplainer).not.toHaveBeenCalled();
});

test("proceeds normally when aiExplainer throws", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/other"], current: "feat/test" })),
    getLog: mock(() => Promise.resolve(COMMITS)),
    getCommitDiff: mock(() => Promise.resolve("diff...")),
    cherryPick: mock(() => Promise.resolve()),
  });
  const aiExplainer = mock(() => Promise.reject(new Error("network timeout")));
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("feat/other")),
    askSearchMultiSelect: mock(() => Promise.resolve(["abc1234"])),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new CherryPicker(git, ui, undefined, aiExplainer).run();

  expect(git.cherryPick).toHaveBeenCalledWith("abc1234");
});
