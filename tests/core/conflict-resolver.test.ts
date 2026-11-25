import { expect, mock, test } from "bun:test";
import { resolveConflict } from "../../src/core/conflict-resolver";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

test("warns with file list when conflicted files exist", async () => {
  const git = createGitMock({
    getInProgressOperation: async () => "cherry-pick",
    getConflictedFiles: mock(() => Promise.resolve(["src/app.ts", "src/utils.ts"])),
  });
  const ui = createUIMock();
  const actions = {
    operation: "cherry-pick" as const,
    label: "Cherry-pick",
    onContinue: mock(() => Promise.resolve()),
    onAbort: mock(() => Promise.resolve()),
  };

  await resolveConflict(git, ui, actions, () => Promise.resolve(true));

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("src/app.ts"));
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Resolve and stage"));
});

test("warns with generic conflict message when no conflicted files reported", async () => {
  const git = createGitMock({
    getInProgressOperation: async () => "cherry-pick",
    getConflictedFiles: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();
  const actions = {
    operation: "cherry-pick" as const,
    label: "Cherry-pick",
    onContinue: mock(() => Promise.resolve()),
    onAbort: mock(() => Promise.resolve()),
  };

  await resolveConflict(git, ui, actions, () => Promise.resolve(true));

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("conflict detected"));
});

test("calls onContinue and shows success when user presses ENTER", async () => {
  const git = createGitMock({
    getInProgressOperation: async () => "cherry-pick",
    getConflictedFiles: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();
  const onContinue = mock(() => Promise.resolve());
  const onAbort = mock(() => Promise.resolve());
  const actions = { operation: "cherry-pick" as const, label: "Cherry-pick", onContinue, onAbort };

  const result = await resolveConflict(git, ui, actions, () => Promise.resolve(true));

  expect(result).toBe(true);
  expect(onContinue).toHaveBeenCalledTimes(1);
  expect(onAbort).not.toHaveBeenCalled();
  expect(ui.success).toHaveBeenCalled();
});

test("calls onAbort and shows info message when the user explicitly chooses to abort", async () => {
  const git = createGitMock({
    getInProgressOperation: async () => "cherry-pick",
    getConflictedFiles: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();
  const onContinue = mock(() => Promise.resolve());
  const onAbort = mock(() => Promise.resolve());
  const actions = { operation: "cherry-pick" as const, label: "Cherry-pick", onContinue, onAbort };

  const result = await resolveConflict(git, ui, actions, () => Promise.resolve(false));

  expect(result).toBe(false);
  expect(onAbort).toHaveBeenCalledTimes(1);
  expect(onContinue).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("aborted"));
});

test("calls ui.error and does not propagate when onContinue throws", async () => {
  const git = createGitMock({
    getInProgressOperation: async () => "cherry-pick",
    getConflictedFiles: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();
  const onContinue = mock(() => Promise.reject(new Error("continue failed")));
  const onAbort = mock(() => Promise.resolve());
  const actions = { operation: "cherry-pick" as const, label: "Cherry-pick", onContinue, onAbort };

  // Continue failed → resolves to false (does not reject/propagate).
  await expect(resolveConflict(git, ui, actions, () => Promise.resolve(true))).resolves.toBe(false);

  expect(ui.error).toHaveBeenCalled();
});

// ─── AI conflict explanation ──────────────────────────────────────────────────

test("offers an AI explanation of the conflict when an explainer is provided", async () => {
  const conflictDiff = "<<<<<<< HEAD\na\n=======\nb\n>>>>>>>";
  const explain = mock(() => Promise.resolve("auth.ts: both sides changed the login guard"));
  const git = createGitMock({
    getInProgressOperation: async () => "merge",
    getConflictedFiles: mock(() => Promise.resolve(["src/auth.ts"])),
    getConflictDiff: mock(() => Promise.resolve(conflictDiff)),
  });
  const ui = createUIMock({ askConfirm: mock(() => Promise.resolve(true)) });
  const actions = {
    operation: "merge" as const,
    label: "Merge",
    onContinue: mock(() => Promise.resolve()),
    onAbort: mock(() => Promise.resolve()),
    explain,
  };

  await resolveConflict(git, ui, actions, () => Promise.resolve(true));

  expect(explain).toHaveBeenCalledWith(conflictDiff);
  const infoCalls = (ui.info as ReturnType<typeof mock>).mock.calls.map((c) => String(c[0]));
  expect(infoCalls.some((m) => m.includes("both sides changed"))).toBe(true);
});

test("does not call the AI explainer when the user declines", async () => {
  const explain = mock(() => Promise.resolve("should not run"));
  const git = createGitMock({
    getInProgressOperation: async () => "merge",
    getConflictedFiles: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({ askConfirm: mock(() => Promise.resolve(false)) });
  const actions = {
    operation: "merge" as const,
    label: "Merge",
    onContinue: mock(() => Promise.resolve()),
    onAbort: mock(() => Promise.resolve()),
    explain,
  };

  await resolveConflict(git, ui, actions, () => Promise.resolve(true));

  expect(explain).not.toHaveBeenCalled();
});

test("leaves the operation pending when the recovery prompt is dismissed", async () => {
  const git = createGitMock({ getInProgressOperation: async () => "merge" });
  const ui = createUIMock();
  const onContinue = mock(async () => {});
  const onAbort = mock(async () => {});
  const actions = { operation: "merge" as const, label: "Merge", onContinue, onAbort };
  await expect(resolveConflict(git, ui, actions, async () => null)).resolves.toBe(false);
  expect(onContinue).not.toHaveBeenCalled();
  expect(onAbort).not.toHaveBeenCalled();
});

test("reports a non-Error failure from a conflict continuation and leaves the operation pending", async () => {
  const git = createGitMock({ getInProgressOperation: async () => "merge" });
  const ui = createUIMock();
  const abort = mock(async () => {});
  const resumed = await resolveConflict(
    git,
    ui,
    {
      operation: "merge" as const,
      label: "Merge",
      onContinue: () => Promise.reject("editor exited"),
      onAbort: abort,
    },
    async () => true,
  );
  expect(resumed).toBe(false);
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("editor exited"));
  expect(abort).not.toHaveBeenCalled();
  expect(ui.success).not.toHaveBeenCalled();
});

test.each([
  true,
  false,
])("does not act on a changed Git operation after confirmation (%s)", async (confirmed) => {
  let active: "merge" | "rebase" = "merge";
  const git = createGitMock({ getInProgressOperation: async () => active });
  const ui = createUIMock();
  const onContinue = mock(async () => {});
  const onAbort = mock(async () => {});
  const result = await resolveConflict(
    git,
    ui,
    { operation: "merge", label: "Merge", onContinue, onAbort },
    async () => {
      active = "rebase";
      return confirmed;
    },
  );
  expect(result).toBe(false);
  expect(onContinue).not.toHaveBeenCalled();
  expect(onAbort).not.toHaveBeenCalled();
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("operation changed"));
});

test("does not approve a conflict that finished before its prompt was opened", async () => {
  const git = createGitMock({
    getConflictIdentity: mock().mockResolvedValueOnce(null).mockResolvedValue("new merge"),
    getInProgressOperation: async () => "merge",
  });
  const ui = createUIMock();
  const onContinue = mock(async () => {});
  expect(
    await resolveConflict(
      git,
      ui,
      { operation: "merge", label: "Merge", onContinue, onAbort: async () => {} },
      async () => true,
    ),
  ).toBe(false);
  expect(onContinue).not.toHaveBeenCalled();
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("operation changed"));
});
