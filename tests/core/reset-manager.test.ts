import { expect, mock, test } from "bun:test";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { ResetManager } from "../../src/core/reset-manager";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const TARGET = {
  branch: "feat/local",
  head: "a".repeat(40),
  remote: "team",
  ref: "refs/remotes/team/release",
  commit: "b".repeat(40),
};

test("discarding changes stops if a Git operation starts during confirmation", async () => {
  const git = createGitMock({
    getInProgressOperation: mock().mockResolvedValueOnce(null).mockResolvedValue("revert"),
    getStatus: async () => ({
      files: [{ path: "keep.txt", status: "M" }],
      isClean: () => false,
      commitsAhead: 0,
      commitsBehind: 0,
    }),
  });
  const ui = createUIMock({ askSelect: async () => "discard", askConfirm: async () => true });
  await new ResetManager(git, ui).run();
  expect(git.discardLocalChanges).not.toHaveBeenCalled();
  expect(ui.warn).toHaveBeenCalledWith("A Git operation started. Local changes were kept.");
});

test("Reset blocks an existing operation before fetching or discarding", async () => {
  const git = createGitMock({ getInProgressOperation: async () => "merge" });
  const ui = createUIMock({ askSelect: async () => "remote" });
  await new ResetManager(git, ui).run();
  expect(ui.warn).toHaveBeenCalledWith("Finish the pending merge before resetting.");
  expect(git.getRemoteResetTarget).not.toHaveBeenCalled();
  expect(git.resetToRemote).not.toHaveBeenCalled();
});

test("Reset leaves the branch alone when upstream is missing or changes during fetch", async () => {
  const missing = createGitMock({ getRemoteResetTarget: async () => null });
  const moved = createGitMock({
    getRemoteResetTarget: mock()
      .mockResolvedValueOnce(TARGET)
      .mockResolvedValue({ ...TARGET, branch: "feat/other" }),
  });
  const ui = createUIMock({ askSelect: async () => "remote" });
  await new ResetManager(missing, ui).run();
  await new ResetManager(moved, ui).run();
  expect(ui.error).toHaveBeenCalledWith("The current branch has no verified remote upstream.");
  expect(ui.error).toHaveBeenCalledWith("The current branch or upstream changed while fetching.");
  expect(ui.askConfirm).not.toHaveBeenCalled();
  expect(missing.fetchRemote).not.toHaveBeenCalled();
  expect(moved.resetToRemote).not.toHaveBeenCalled();
});

test("Reset keeps its verification and confirmation when the optional AI summary fails", async () => {
  const git = createGitMock({
    getRemoteResetTarget: async () => TARGET,
    getLogSince: async () => [{ hash: "local", message: "unpublished" }],
  });
  const summarize = mock(async () => {
    throw new Error("offline");
  });
  const ui = createUIMock({
    askSelect: async () => "remote",
    askConfirm: mock().mockResolvedValueOnce(true).mockResolvedValue(false),
  });
  await new ResetManager(git, ui, summarize).run();
  expect(summarize).toHaveBeenCalledWith(["unpublished"]);
  expect(ui.warn).toHaveBeenCalledWith("AI summary failed. Review the commits above.");
  expect(ui.askConfirm).toHaveBeenCalledTimes(2);
  expect(git.resetToRemote).not.toHaveBeenCalled();
});

test("an empty AI summary does not obscure the reset preview or a late mutation failure", async () => {
  const git = createGitMock({
    getRemoteResetTarget: async () => TARGET,
    getLogSince: async () => [{ hash: "local", message: "unpublished" }],
    resetToRemote: () => Promise.reject("index changed"),
  });
  const summarize = mock(async () => "");
  const ui = createUIMock({ askSelect: async () => "remote", askConfirm: async () => true });
  await new ResetManager(git, ui, summarize).run();
  expect(summarize).toHaveBeenCalledWith(["unpublished"]);
  expect(ui.info).not.toHaveBeenCalledWith(expect.stringContaining("What will be lost"));
  expect(ui.error).toHaveBeenCalledWith("Reset did not complete.\nindex changed");
  expect(ui.success).not.toHaveBeenCalled();
});

// ── discard local changes ──────────────────────────────────────────────────────

test("shows info and returns when working tree is clean (discard action)", async () => {
  const git = createGitMock({
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
    askSelect: mock(() => Promise.resolve("discard" as never)),
  });

  await new ResetManager(git, ui).run();

  expect(ui.info).toHaveBeenCalledWith("Working tree is already clean.");
  expect(git.discardLocalChanges).not.toHaveBeenCalled();
});

test("asks confirmation before discarding changes", async () => {
  const git = createGitMock({
    getStatus: mock(() =>
      Promise.resolve({
        files: [{ path: "file.ts", status: "M" }],
        isClean: () => false,
        commitsAhead: 0,
        commitsBehind: 0,
      }),
    ),
    discardLocalChanges: mock(() => Promise.resolve()),
  });
  const askConfirm = mock(() => Promise.resolve(false));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("discard" as never)),
    askConfirm,
  });

  await new ResetManager(git, ui).run();

  expect(askConfirm).toHaveBeenCalledWith(
    "Permanently discard tracked changes and ordinary untracked files? Ignored files and nested repositories are kept.",
    false,
  );
});

test("discards local changes when user confirms", async () => {
  const dirty = {
    files: [{ path: "file.ts", status: "M" }],
    isClean: () => false,
    commitsAhead: 0,
    commitsBehind: 0,
  };
  const git = createGitMock({
    getStatus: mock()
      .mockResolvedValueOnce(dirty)
      .mockResolvedValueOnce({
        ...dirty,
        files: [],
        isClean: () => true,
      }),
    discardLocalChanges: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("discard" as never)),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new ResetManager(git, ui).run();

  expect(git.discardLocalChanges).toHaveBeenCalledTimes(1);
  expect(ui.success).toHaveBeenCalledWith("Working tree is clean.");
});

test("does not discard when user declines confirmation", async () => {
  const git = createGitMock({
    getStatus: mock(() =>
      Promise.resolve({
        files: [{ path: "file.ts", status: "M" }],
        isClean: () => false,
        commitsAhead: 0,
        commitsBehind: 0,
      }),
    ),
    discardLocalChanges: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("discard" as never)),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new ResetManager(git, ui).run();

  expect(git.discardLocalChanges).not.toHaveBeenCalled();
});

test("discard reports a failed status check without announcing a clean working tree", async () => {
  const git = createGitMock({
    getStatus: mock()
      .mockResolvedValueOnce({
        files: [{ path: "file.ts", status: "M" }],
        isClean: () => false,
        commitsAhead: 0,
        commitsBehind: 0,
      })
      .mockRejectedValueOnce("status unavailable"),
  });
  const ui = createUIMock({ askSelect: async () => "discard", askConfirm: async () => true });
  await new ResetManager(git, ui).run();
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("status unavailable"));
  expect(ui.success).not.toHaveBeenCalled();
});

// ── reset to remote ────────────────────────────────────────────────────────────

test("asks confirmation before resetting to remote", async () => {
  const git = createGitMock({
    getRemoteResetTarget: mock(async () => TARGET),
    fetchRemote: mock(() => Promise.resolve()),
    resetToRemote: mock(async () => "refs/gitten/recovery/original"),
  });
  const askConfirm = mock(() => Promise.resolve(false));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remote" as never)),
    askConfirm,
  });

  await new ResetManager(git, ui).run();

  expect(askConfirm).toHaveBeenCalledWith(
    expect.stringContaining("Reset 'feat/local' to team/release"),
    false,
  );
});

test("fetches and resets to remote when user confirms", async () => {
  const git = createGitMock({
    getRemoteResetTarget: mock(async () => TARGET),
    fetchRemote: mock(() => Promise.resolve()),
    resetToRemote: mock(async () => "refs/gitten/recovery/original"),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remote" as never)),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new ResetManager(git, ui).run();

  expect(git.fetchRemote).toHaveBeenCalledWith("team");
  expect(git.resetToRemote).toHaveBeenCalledWith(TARGET);
  expect(ui.success).toHaveBeenCalledWith("Branch reset to team/release.");
});

test("does not reset when user declines confirmation", async () => {
  const git = createGitMock({
    getRemoteResetTarget: mock(async () => TARGET),
    fetchRemote: mock(() => Promise.resolve()),
    resetToRemote: mock(async () => "refs/gitten/recovery/original"),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remote" as never)),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new ResetManager(git, ui).run();

  // fetchRemote is called before confirm to show commits at risk
  expect(git.fetchRemote).toHaveBeenCalledTimes(1);
  expect(git.resetToRemote).not.toHaveBeenCalled();
});

test("shows local commits that would be lost before asking confirmation", async () => {
  const git = createGitMock({
    getRemoteResetTarget: mock(async () => TARGET),
    fetchRemote: mock(() => Promise.resolve()),
    getLogSince: mock(() =>
      Promise.resolve([
        { hash: "abc1234", message: "feat: unpushed change" },
        { hash: "def5678", message: "fix: also unpushed" },
      ]),
    ),
    resetToRemote: mock(async () => "refs/gitten/recovery/original"),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remote" as never)),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new ResetManager(git, ui).run();

  const warnCalls = (ui.warn as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(warnCalls.some((m) => m.includes("2 local commit(s)"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("abc1234"))).toBe(true);
  expect(warnCalls.some((m) => m.includes("def5678"))).toBe(true);
});

// ── ESC navigation ─────────────────────────────────────────────────────────────

test("propagates GoBackSignal when user presses ESC on action menu", async () => {
  const git = createGitMock();
  const ui = createUIMock({
    askSelect: mock(() => {
      throw new GoBackSignal();
    }),
  });

  await expect(new ResetManager(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
});

// ─── AI lost commits summary ───────────────────────────────────────────────────

test("summarizes commits to be lost with AI before confirmation", async () => {
  const git = createGitMock({
    getRemoteResetTarget: mock(async () => TARGET),
    getLogSince: mock(() =>
      Promise.resolve([
        { hash: "abc", message: "feat: add feature" },
        { hash: "def", message: "fix: patch bug" },
      ]),
    ),
    resetToRemote: mock(async () => "refs/gitten/recovery/original"),
  });
  const aiSummarizer = mock(() => Promise.resolve("• Added new feature\n• Patched a bug"));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remote")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new ResetManager(git, ui, aiSummarizer).run();

  expect(aiSummarizer).toHaveBeenCalledWith(["feat: add feature", "fix: patch bug"]);
  const infoCalls = (ui.info as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(infoCalls.some((m) => m.includes("What will be lost"))).toBe(true);
});

test("skips AI summary when no local commits to lose", async () => {
  const git = createGitMock({
    getRemoteResetTarget: mock(async () => TARGET),
    getLogSince: mock(() => Promise.resolve([])),
    resetToRemote: mock(async () => "refs/gitten/recovery/original"),
  });
  const aiSummarizer = mock(() => Promise.resolve("• something"));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remote")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new ResetManager(git, ui, aiSummarizer).run();

  expect(aiSummarizer).not.toHaveBeenCalled();
});

test("does not offer a destructive reset when the fetch fails", async () => {
  const git = createGitMock({
    getRemoteResetTarget: mock(async () => TARGET),
    fetchRemote: mock(async () => {
      throw new Error("remote unavailable");
    }),
  });
  const ui = createUIMock({ askSelect: async () => "remote" });

  await new ResetManager(git, ui).run();

  expect(ui.askConfirm).not.toHaveBeenCalled();
  expect(git.resetToRemote).not.toHaveBeenCalled();
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("No changes were made"));
});

test("refuses to reset when the target changes after confirmation", async () => {
  const git = createGitMock({
    getRemoteResetTarget: mock()
      .mockResolvedValueOnce(TARGET)
      .mockResolvedValueOnce(TARGET)
      .mockResolvedValueOnce({ ...TARGET, commit: "c".repeat(40) }),
  });
  const ui = createUIMock({ askSelect: async () => "remote", askConfirm: async () => true });

  await new ResetManager(git, ui).run();

  expect(git.resetToRemote).not.toHaveBeenCalled();
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("changed after the preview"));
});
