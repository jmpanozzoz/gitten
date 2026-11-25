import { expect, mock, test } from "bun:test";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { PullFlow } from "../../src/core/pull-flow";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const WITH_REMOTE = [{ name: "origin", url: "https://github.com/user/repo.git" }];

test("cancelling Pull at strategy selection leaves both integration commands uncalled", async () => {
  const git = createGitMock({ getRemotes: async () => WITH_REMOTE });
  const ui = createUIMock({
    askSelect: mock().mockRejectedValue(new GoBackSignal()),
  });
  await expect(new PullFlow(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(git.pull).not.toHaveBeenCalled();
  expect(git.pullRebase).not.toHaveBeenCalled();
  expect(ui.success).not.toHaveBeenCalled();
});

test("resumes a pending rebase through the correct operation without starting another pull", async () => {
  const git = createGitMock({ getInProgressOperation: async () => "rebase" });
  const ui = createUIMock({ waitForConflictResolution: async () => true });
  await new PullFlow(git, ui).run();
  expect(git.rebaseContinue).toHaveBeenCalledTimes(1);
  expect(git.mergeContinue).not.toHaveBeenCalled();
  expect(git.pull).not.toHaveBeenCalled();
  expect(git.pullRebase).not.toHaveBeenCalled();
});

test("an explicit abort stops a pending rebase and leaves Merge untouched", async () => {
  const git = createGitMock({ getInProgressOperation: async () => "rebase" });
  const ui = createUIMock({ waitForConflictResolution: async () => false });
  await new PullFlow(git, ui).run();
  expect(git.rebaseAbort).toHaveBeenCalledTimes(1);
  expect(git.mergeAbort).not.toHaveBeenCalled();
  expect(git.rebaseContinue).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("Rebase aborted."));
});

test("Pull propagates a non-Error transport failure without starting recovery", async () => {
  const git = createGitMock({
    getRemotes: async () => WITH_REMOTE,
    pull: () => Promise.reject("connection closed"),
  });
  const ui = createUIMock();
  await expect(new PullFlow(git, ui).run()).rejects.toBe("connection closed");
  expect(git.mergeAbort).not.toHaveBeenCalled();
  expect(ui.waitForConflictResolution).not.toHaveBeenCalled();
  expect(ui.success).not.toHaveBeenCalled();
});

test("blocks Pull during a different pending operation and explains a no-tracking error", async () => {
  const ui = createUIMock();
  const busy = createGitMock({ getInProgressOperation: async () => "revert" });
  await new PullFlow(busy, ui).run();
  expect(ui.warn).toHaveBeenCalledWith("Finish the pending revert before pulling.");
  expect(busy.getRemotes).not.toHaveBeenCalled();

  const git = createGitMock({
    getRemotes: async () => WITH_REMOTE,
    pull: async () => {
      throw new Error("no tracking information");
    },
  });
  await new PullFlow(git, ui).run();
  expect(ui.error).toHaveBeenCalledWith("This branch has no upstream. Push it first with Sync.");
  expect(git.mergeAbort).not.toHaveBeenCalled();
});

test("keeps a successful Pull result when summary input is missing, declined, empty, or offline", async () => {
  const aiSummarizer = mock().mockResolvedValueOnce("").mockRejectedValueOnce(new Error("offline"));
  const commits = [{ hash: "abc", message: "first upstream commit" }];
  const git = createGitMock({
    getRemotes: async () => WITH_REMOTE,
    getLastCommit: mock()
      .mockRejectedValueOnce(new Error("unborn"))
      .mockResolvedValue({ hash: "old", message: "old" }),
    getLogSince: mock().mockResolvedValueOnce([]).mockResolvedValue(commits),
    pull: async () => ({ filesChanged: 1, headChanged: true }),
  });
  const askConfirm = mock().mockResolvedValueOnce(false).mockResolvedValue(true);
  const ui = createUIMock({ askConfirm });
  const flow = new PullFlow(git, ui, { aiSummarizer });
  for (let attempt = 0; attempt < 5; attempt++) await flow.run();
  expect(ui.success).toHaveBeenCalledTimes(5);
  expect(askConfirm).toHaveBeenCalledTimes(3);
  expect(aiSummarizer).toHaveBeenCalledTimes(2);
  expect(aiSummarizer).toHaveBeenCalledWith(["first upstream commit"]);
  expect(ui.error).not.toHaveBeenCalled();
  expect(ui.info).not.toHaveBeenCalledWith(expect.stringContaining("What changed"));
});

test("shows info and returns when no remotes configured", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock();

  await new PullFlow(git, ui).run();

  expect(git.pull).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalled();
});

test("shows info when already up to date", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.resolve({ filesChanged: 0 })),
  });
  const ui = createUIMock();

  await new PullFlow(git, ui).run();

  expect(git.pull).toHaveBeenCalledTimes(1);
  expect(ui.info).toHaveBeenCalled();
  expect(ui.success).not.toHaveBeenCalled();
});

test("shows success with file count when new commits pulled", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.resolve({ filesChanged: 3 })),
  });
  const ui = createUIMock();

  await new PullFlow(git, ui).run();

  expect(git.pull).toHaveBeenCalledTimes(1);
  expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("3"));
});

test("shows error when branch has no upstream", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("has no upstream branch"))),
  });
  const ui = createUIMock();

  await new PullFlow(git, ui).run();

  expect(ui.error).toHaveBeenCalled();
  expect(git.mergeAbort).not.toHaveBeenCalled();
});

test("on conflict + ENTER: continues merge without staging unrelated files", async () => {
  const git = createGitMock({
    getInProgressOperation: mock().mockResolvedValueOnce(null).mockResolvedValue("merge"),
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("conflict in src/app.ts"))),
    addAll: mock(() => Promise.resolve()),
    mergeContinue: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({ askSelect: async () => "merge" });
  const waitForResolution = mock(() => Promise.resolve(true));

  await new PullFlow(git, ui, { waitForResolution }).run();

  expect(git.addAll).not.toHaveBeenCalled();
  expect(git.mergeContinue).toHaveBeenCalledTimes(1);
  expect(git.mergeAbort).not.toHaveBeenCalled();
  expect(ui.success).toHaveBeenCalled();
});

test("on conflict + ESC: aborts merge and shows info", async () => {
  const git = createGitMock({
    getInProgressOperation: mock().mockResolvedValueOnce(null).mockResolvedValue("merge"),
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("automatic merge failed; fix conflicts"))),
    mergeAbort: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({ askSelect: async () => "merge" });
  const waitForResolution = mock(() => Promise.resolve(false));

  await new PullFlow(git, ui, { waitForResolution }).run();

  expect(git.mergeAbort).toHaveBeenCalledTimes(1);
  expect(git.addAll).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalled();
});

// ─── conflict file list ───────────────────────────────────────────────────────

test("lists conflicted files by name on merge conflict", async () => {
  const git = createGitMock({
    getInProgressOperation: mock().mockResolvedValueOnce(null).mockResolvedValue("merge"),
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("conflict"))),
    getConflictedFiles: mock(() => Promise.resolve(["src/auth.ts", "src/routes.ts"])),
    mergeAbort: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({ askSelect: async () => "merge" });
  const waitForResolution = mock(() => Promise.resolve(false));

  await new PullFlow(git, ui, { waitForResolution }).run();

  const warnCalls = (ui.warn as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(warnCalls.some((m) => m.includes("2 file(s)"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("src/auth.ts"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("src/routes.ts"))).toBe(true);
});

test("shows generic conflict message when no files reported by git", async () => {
  const git = createGitMock({
    getInProgressOperation: mock().mockResolvedValueOnce(null).mockResolvedValue("merge"),
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("conflict"))),
    getConflictedFiles: mock(() => Promise.resolve([])),
    mergeAbort: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({ askSelect: async () => "merge" });
  const waitForResolution = mock(() => Promise.resolve(false));

  await new PullFlow(git, ui, { waitForResolution }).run();

  const warnCalls = (ui.warn as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(warnCalls.some((m) => m.includes("detected"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("•"))).toBe(false);
});

test("rethrows unexpected pull errors", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.reject(new Error("repository not found"))),
  });
  const ui = createUIMock();

  await expect(new PullFlow(git, ui).run()).rejects.toThrow("repository not found");
});

// ─── rebase strategy ─────────────────────────────────────────────────────────

test("calls pullRebase when user selects rebase strategy", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pullRebase: mock(() => Promise.resolve({ filesChanged: 2 })),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("rebase" as never)),
  });

  await new PullFlow(git, ui).run();

  expect(git.pullRebase).toHaveBeenCalledTimes(1);
  expect(git.pull).not.toHaveBeenCalled();
  expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("2"));
});

test("calls pull (merge) when user selects merge strategy", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(WITH_REMOTE)),
    pull: mock(() => Promise.resolve({ filesChanged: 1 })),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("merge" as never)),
  });

  await new PullFlow(git, ui).run();

  expect(git.pull).toHaveBeenCalledTimes(1);
  expect(git.pullRebase).not.toHaveBeenCalled();
});

// ─── AI pull summary ───────────────────────────────────────────────────────────

test("summarizes incoming commits with AI after successful pull", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve([{ name: "origin", url: "https://github.com/x/y" }])),
    getLastCommit: mock(() => Promise.resolve({ hash: "before123", message: "chore: old" })),
    pull: mock(() => Promise.resolve({ filesChanged: 3 })),
    getLogSince: mock(() =>
      Promise.resolve([
        { hash: "abc", message: "feat: add login" },
        { hash: "def", message: "fix: typo" },
      ]),
    ),
  });
  const aiSummarizer = mock(() => Promise.resolve("• Added login feature\n• Fixed typo in header"));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("merge")),
    askConfirm: async () => true,
  });

  await new PullFlow(git, ui, { aiSummarizer }).run();

  expect(aiSummarizer).toHaveBeenCalledWith(["feat: add login", "fix: typo"]);
  const infoCalls = (ui.info as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(infoCalls.some((m) => m.includes("What changed"))).toBe(true);
});

test("skips AI summary when already up to date", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve([{ name: "origin", url: "https://github.com/x/y" }])),
    getLastCommit: mock(() => Promise.resolve({ hash: "before123", message: "chore: old" })),
    pull: mock(() => Promise.resolve({ filesChanged: 0 })),
  });
  const aiSummarizer = mock(() => Promise.resolve("• something"));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("merge")),
  });

  await new PullFlow(git, ui, { aiSummarizer }).run();

  expect(aiSummarizer).not.toHaveBeenCalled();
});

test("proceeds normally when no aiSummarizer provided", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve([{ name: "origin", url: "https://github.com/x/y" }])),
    pull: mock(() => Promise.resolve({ filesChanged: 2 })),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("merge")),
  });

  await new PullFlow(git, ui).run();

  expect(ui.success).toHaveBeenCalled();
});
