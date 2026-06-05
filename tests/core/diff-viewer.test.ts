import { expect, mock, test } from "bun:test";
import { DiffViewer } from "../../src/core/diff-viewer";
import { GoBackSignal } from "../../src/ui/go-back";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

// ─── happy path ───────────────────────────────────────────────────────────────

test("shows diff when differences exist between branches", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/test"], current: "feat/test" })),
    getRemoteBranches: mock(() => Promise.resolve([])),
    getBranchDiff: mock(() => Promise.resolve("diff --git a/src/app.ts b/src/app.ts\n+new line")),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("main")),
  });

  await new DiffViewer(git, ui).run();

  expect(git.getBranchDiff).toHaveBeenCalledWith("main");
  expect(ui.info).toHaveBeenCalled();
});

test("shows info message when there are no differences", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/test"], current: "feat/test" })),
    getRemoteBranches: mock(() => Promise.resolve([])),
    getBranchDiff: mock(() => Promise.resolve("")),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("main")),
  });

  await new DiffViewer(git, ui).run();

  const infoCalls = (ui.info as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(infoCalls.some((m) => m.includes("No differences"))).toBe(true);
});

// ─── includes remote branches ─────────────────────────────────────────────────

test("includes remote-only branches in the selection list", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main"], current: "main" })),
    getRemoteBranches: mock(() => Promise.resolve(["origin/feature/remote-only"])),
    getBranchDiff: mock(() => Promise.resolve("diff content")),
  });
  const ui = createUIMock({
    askSearchSelect: mock((_: string, options: { value: string; label: string }[]) => {
      expect(options.some((o) => o.value === "origin/feature/remote-only")).toBe(true);
      return Promise.resolve("origin/feature/remote-only");
    }),
  });

  await new DiffViewer(git, ui).run();

  expect(git.getBranchDiff).toHaveBeenCalledWith("origin/feature/remote-only");
});

// ─── no other branches ───────────────────────────────────────────────────────

test("shows info and returns when no other branches exist", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main"], current: "main" })),
    getRemoteBranches: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();

  await new DiffViewer(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(git.getBranchDiff).not.toHaveBeenCalled();
});

// ─── cancellation ─────────────────────────────────────────────────────────────

test("propagates GoBackSignal when user presses ESC on branch select", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main", "feat/test"], current: "feat/test" })),
    getRemoteBranches: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.reject(new GoBackSignal())),
  });

  await expect(new DiffViewer(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
});
