import { expect, mock, test } from "bun:test";
import { GoBackSignal } from "../../src/core/domain/navigation";
import type { IGitClient } from "../../src/core/ports/git-client.port";
import { SyncFlow } from "../../src/core/sync-flow";
import { createGitMock, makeCommitSelection } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const FILES = [
  { path: "src/app.ts", status: "M" },
  { path: ".env", status: "?" },
];
const DIRTY_STATUS = {
  files: FILES,
  isClean: () => false,
  commitsAhead: 0,
  commitsBehind: 0,
};
const CLEAN_STATUS = {
  files: [],
  isClean: () => true,
  commitsAhead: 0,
  commitsBehind: 0,
};
const CLEAN_STATUS_AHEAD = {
  files: [],
  isClean: () => true,
  commitsAhead: 3,
  commitsBehind: 0,
};
const CONFIRM_YES = { askConfirm: mock(() => Promise.resolve(true)) };
const CONFIRM_NO = { askConfirm: mock(() => Promise.resolve(false)) };
const SELECT_ALL = { askMultiSelect: mock(() => Promise.resolve(["src/app.ts", ".env"])) };
const SELECT_NONE = { askMultiSelect: mock(() => Promise.resolve([])) };

const existingUpstream = {
  branch: "feature",
  head: "a".repeat(40),
  remote: "review",
  ref: "refs/remotes/review/feature",
  commit: "b".repeat(40),
};

function syncGit(overrides: Partial<IGitClient> = {}) {
  return createGitMock({
    getRemotes: async () => [{ name: "review", url: "https://example.test/repo" }],
    getRemoteResetTarget: async () => existingUpstream,
    ...overrides,
  });
}

test("Sync blocks an active Git operation before reading counts or preparing a commit", async () => {
  const git = syncGit({ getInProgressOperation: async () => "merge" });
  const ui = createUIMock();
  await new SyncFlow(git, ui).run();
  expect(ui.warn).toHaveBeenCalledWith("Finish the pending merge before using Sync.");
  expect(git.getStatus).not.toHaveBeenCalled();
  expect(git.previewSelectedCommit).not.toHaveBeenCalled();
});

test("Sync reports a verified clean branch behind upstream and offers Pull", async () => {
  const git = syncGit({ getStatus: async () => ({ ...CLEAN_STATUS, commitsBehind: 2 }) });
  const ui = createUIMock();
  await new SyncFlow(git, ui).run();
  expect(git.fetchRemote).toHaveBeenCalledWith("review");
  expect(ui.info).toHaveBeenCalledWith("Behind upstream by 2 commit(s). Use Pull to update.");
  expect(git.previewBranchPush).not.toHaveBeenCalled();
});

test("Sync warns about a moved upstream after fetch instead of claiming the branch is up to date", async () => {
  const git = syncGit({
    getStatus: async () => CLEAN_STATUS,
    getRemoteResetTarget: mock()
      .mockResolvedValueOnce(existingUpstream)
      .mockResolvedValue({
        ...existingUpstream,
        head: "c".repeat(40),
      }),
  });
  const ui = createUIMock();
  await new SyncFlow(git, ui).run();
  expect(ui.warn).toHaveBeenCalledWith(
    "The branch or upstream changed during fetch. Commit counts may be stale.",
  );
  expect(ui.info).not.toHaveBeenCalledWith(expect.stringContaining("Already up to date"));
  expect(git.pushBranch).not.toHaveBeenCalled();
});

test("Sync warns about a failed fetch and requires separate push confirmation", async () => {
  const git = syncGit({
    getStatus: async () => CLEAN_STATUS,
    fetchRemote: mock().mockRejectedValue(new Error("offline")),
  });
  const ui = createUIMock();
  await new SyncFlow(git, ui).run();
  expect(ui.warn).toHaveBeenCalledWith(
    "Could not refresh the upstream. Commit counts may be stale.",
  );
  expect(ui.info).not.toHaveBeenCalledWith(expect.stringContaining("Already up to date"));
  expect(ui.askConfirm).toHaveBeenCalled();
  expect(git.pushBranch).not.toHaveBeenCalled();
});

test("Sync reports both Git errors and unexpected commit failures without pushing", async () => {
  for (const [error, expected] of [
    [new Error("index locked"), "index locked"],
    ["unexpected failure", "Could not commit the selection."],
  ] as const) {
    const git = syncGit({
      getStatus: async () => DIRTY_STATUS,
      commitSelection: () => Promise.reject(error),
    });
    const ui = createUIMock({ ...SELECT_ALL });
    await new SyncFlow(git, ui).run();
    expect(ui.error).toHaveBeenCalledWith(expected);
    expect(git.pushBranch).not.toHaveBeenCalled();
  }
});

test("Sync stops on cancellation of AI review or suggestion before committing", async () => {
  const cancel = () => Promise.reject(new GoBackSignal());
  for (const stage of ["review", "suggestion"]) {
    const git = syncGit({ getStatus: async () => DIRTY_STATUS });
    const ui = createUIMock({ ...SELECT_ALL, askConfirm: async () => true });
    const flow = new SyncFlow(
      git,
      ui,
      stage === "suggestion" ? cancel : undefined,
      stage === "review" ? cancel : undefined,
    );
    await expect(flow.run()).rejects.toBeInstanceOf(GoBackSignal);
    expect(git.commitSelection).not.toHaveBeenCalled();
    expect(ui.askText).not.toHaveBeenCalled();
  }
});

test("Sync uses the ordinary commit placeholder and warns when optional AI fails with text", async () => {
  const git = syncGit({ getStatus: async () => DIRTY_STATUS });
  const ui = createUIMock({
    ...SELECT_ALL,
    askConfirm: mock()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false),
  });
  await new SyncFlow(
    git,
    ui,
    () => Promise.reject("offline"),
    () => Promise.reject("offline"),
  ).run();
  expect(ui.warn).toHaveBeenCalledWith("AI review failed: unknown error");
  expect(ui.warn).toHaveBeenCalledWith("AI failed: unknown error");
  expect(ui.askText).toHaveBeenCalledWith("Commit message:", undefined, "chore: update");
  expect(ui.success).not.toHaveBeenCalledWith(expect.stringContaining("No issues found"));
});

test("Sync reports an AI suggestion Error and keeps manual commit editing available", async () => {
  const git = syncGit({ getStatus: async () => DIRTY_STATUS });
  const ui = createUIMock({
    ...SELECT_ALL,
    askConfirm: mock().mockResolvedValueOnce(true).mockResolvedValue(false),
    askText: mock(async () => "fix: local edit"),
  });
  await new SyncFlow(git, ui, () => Promise.reject(new Error("provider unavailable"))).run();
  expect(ui.warn).toHaveBeenCalledWith("AI failed: provider unavailable");
  expect(ui.askText).toHaveBeenCalledWith("Commit message:", undefined, "chore: update");
  expect(git.commitSelection).toHaveBeenCalledWith(expect.any(Object), "fix: local edit");
});

// ─── dirty working tree ───────────────────────────────────────────────────────

test("stages, commits and pushes selected files when user confirms push", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    pushBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    ...CONFIRM_YES,
    askText: mock(() => Promise.resolve("feat: my commit")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.previewSelectedCommit).toHaveBeenCalledWith(["src/app.ts", ".env"]);
  expect(git.commitSelection).toHaveBeenCalledWith(
    expect.objectContaining({ paths: expect.any(Array) }),
    "feat: my commit",
  );
  expect(git.pushBranch).toHaveBeenCalledTimes(1);
});

test("commits without pushing when user declines push", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    pushBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    ...CONFIRM_NO,
    askText: mock(() => Promise.resolve("feat: local only")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.commitSelection).toHaveBeenCalledTimes(1);
  expect(git.pushBranch).not.toHaveBeenCalled();
});

test("stages only the files the user selects", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    pushBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askMultiSelect: mock(() => Promise.resolve(["src/app.ts"])),
    askConfirm: mock(() => Promise.resolve(true)),
    askText: mock(() => Promise.resolve("fix: partial stage")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.previewSelectedCommit).toHaveBeenCalledWith(["src/app.ts"]);
  expect(git.commitSelection).toHaveBeenCalledTimes(1);
});

test("aborts without staging when user selects no files", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
  });
  const ui = createUIMock({ ...SELECT_NONE });

  await new SyncFlow(git, ui).run();

  expect(git.previewSelectedCommit).not.toHaveBeenCalled();
  expect(git.commitSelection).not.toHaveBeenCalled();
  expect(git.pushBranch).not.toHaveBeenCalled();
});

test("shows file paths with their status in the multiselect", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    pushBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    askText: mock(() => Promise.resolve("chore: update")),
  });

  await new SyncFlow(git, ui).run();

  const options = (ui.askMultiSelect as ReturnType<typeof mock>).mock.calls[0]![1] as {
    value: string;
    label: string;
  }[];
  expect(options.some((o) => o.label.includes("M") && o.label.includes("src/app.ts"))).toBe(true);
  expect(options.some((o) => o.label.includes("?") && o.label.includes(".env"))).toBe(true);
});

test("uses default commit message when input is empty", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    pushBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    ...CONFIRM_YES,
    askText: mock(() => Promise.resolve("")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.commitSelection).toHaveBeenCalledWith(
    expect.objectContaining({ paths: expect.any(Array) }),
    "chore: update",
  );
});

test("shows diff stat summary after staging", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    previewSelectedCommit: mock(async (paths) =>
      makeCommitSelection(paths, { stat: { insertions: 42, deletions: 7 } }),
    ),
    pushBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    ...CONFIRM_YES,
    askText: mock(() => Promise.resolve("feat: stats")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.previewSelectedCommit).toHaveBeenCalledTimes(1);
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("42"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("7"));
});

test("displays the selected diff before asking for the commit message", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    previewSelectedCommit: mock(async (paths) =>
      makeCommitSelection(paths, { diff: "+const x = 1;\n-const x = 0;\n context line" }),
    ),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    ...CONFIRM_NO,
    askText: mock(() => Promise.resolve("feat: preview")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.previewSelectedCommit).toHaveBeenCalledTimes(1);
  expect(ui.showDiff).toHaveBeenCalledWith(expect.stringContaining("+const x = 1;"));
});

test("does not commit or push when the selected diff is empty", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    previewSelectedCommit: mock(async (paths) => makeCommitSelection(paths, { diff: "" })),
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    ...CONFIRM_NO,
    askText: mock(() => Promise.resolve("feat: no preview")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.previewSelectedCommit).toHaveBeenCalledTimes(1);
  expect(ui.askText).not.toHaveBeenCalled();
  expect(git.commitSelection).not.toHaveBeenCalled();
  expect(git.pushBranch).not.toHaveBeenCalled();
});

// ─── clean working tree ───────────────────────────────────────────────────────

test("skips staging and commit when working tree is clean but has commits ahead", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS_AHEAD)),
    pushBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({ ...CONFIRM_YES });

  await new SyncFlow(git, ui).run();

  expect(git.previewSelectedCommit).not.toHaveBeenCalled();
  expect(git.commitSelection).not.toHaveBeenCalled();
  expect(git.pushBranch).toHaveBeenCalledTimes(1);
});

test("returns early without pushing when user declines on clean tree with commits ahead", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS_AHEAD)),
  });
  const ui = createUIMock({
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new SyncFlow(git, ui).run();

  expect(git.pushBranch).not.toHaveBeenCalled();
});

// ─── push error handling ──────────────────────────────────────────────────────

test("asks before setting upstream and publishes once to the chosen remote", async () => {
  const git = syncGit({
    getStatus: async () => CLEAN_STATUS,
    getRemoteResetTarget: async () => null,
  });
  const ui = createUIMock({ ...CONFIRM_YES });
  await new SyncFlow(git, ui).run();
  expect(ui.askConfirm).toHaveBeenCalledWith(
    expect.stringContaining("and set its upstream"),
    false,
  );
  expect(git.pushBranch).toHaveBeenCalledTimes(1);
  expect(git.pushBranch).toHaveBeenCalledWith(expect.objectContaining({ remote: "review" }), true);
});

test("shows error and aborts when push is rejected due to remote changes", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS_AHEAD)),
    pushBranch: mock(() => Promise.reject(new Error("rejected — fetch first"))),
  });
  const ui = createUIMock({ ...CONFIRM_YES });

  await new SyncFlow(git, ui).run();

  expect(ui.error).toHaveBeenCalled();
  expect(git.pushBranch).toHaveBeenCalledTimes(1);
});

test("shows clean error message and local commit hint when push fails unexpectedly", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS_AHEAD)),
    pushBranch: mock(() => Promise.reject(new Error("permission denied (publickey)"))),
  });
  const ui = createUIMock({ ...CONFIRM_YES });

  await new SyncFlow(git, ui).run();

  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("saved locally"));
});

// ─── already up to date ───────────────────────────────────────────────────────

test("shows info and returns when working tree is clean and branch is up to date", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS)),
  });
  const ui = createUIMock();

  await new SyncFlow(git, ui).run();

  expect(ui.info).toHaveBeenCalledWith("Already up to date — nothing to commit or push.");
  expect(ui.askConfirm).not.toHaveBeenCalled();
  expect(git.pushBranch).not.toHaveBeenCalled();
});

test("asks to push when working tree is clean but branch has commits ahead", async () => {
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(CLEAN_STATUS_AHEAD)),
    pushBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({ ...CONFIRM_YES });

  await new SyncFlow(git, ui).run();

  expect(ui.askConfirm).toHaveBeenCalledWith(
    expect.stringContaining("Push this commit to review:"),
    false,
  );
  expect(git.pushBranch).toHaveBeenCalledTimes(1);
});

// ─── protected branch warning ─────────────────────────────────────────────────

test("warns before committing when on main and aborts if user declines", async () => {
  const git = syncGit({
    getCurrentBranch: mock(() => Promise.resolve("main")),
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
  });
  const ui = createUIMock({ askConfirm: mock(() => Promise.resolve(false)) });

  await new SyncFlow(git, ui).run();

  expect(ui.askConfirm).toHaveBeenCalledWith(expect.stringContaining("main"), false);
  expect(git.previewSelectedCommit).not.toHaveBeenCalled();
});

test("continues when user confirms commit to main", async () => {
  const git = syncGit({
    getCurrentBranch: mock(() => Promise.resolve("main")),
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    pushBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askConfirm: mock(() => Promise.resolve(true)),
    ...SELECT_ALL,
    askText: mock(() => Promise.resolve("fix: hotfix")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.previewSelectedCommit).toHaveBeenCalledTimes(1);
  expect(git.commitSelection).toHaveBeenCalledTimes(1);
});

// ─── behind warning ───────────────────────────────────────────────────────────

test("warns and aborts when branch is behind remote and user chooses to pull first", async () => {
  const BEHIND_STATUS = {
    files: FILES,
    isClean: () => false,
    commitsAhead: 0,
    commitsBehind: 3,
  };
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(BEHIND_STATUS)),
  });
  const ui = createUIMock({ askConfirm: mock(() => Promise.resolve(true)) });

  await new SyncFlow(git, ui).run();

  expect(ui.askConfirm).toHaveBeenCalledWith(expect.stringContaining("3 new commit(s)"));
  expect(git.previewSelectedCommit).not.toHaveBeenCalled();
});

test("proceeds with commit when branch is behind but user continues anyway", async () => {
  const BEHIND_STATUS = {
    files: FILES,
    isClean: () => false,
    commitsAhead: 0,
    commitsBehind: 2,
  };
  const git = syncGit({
    getStatus: mock(() => Promise.resolve(BEHIND_STATUS)),
    pushBranch: mock(() => Promise.resolve()),
  });
  // First confirm = behind warning (no = continue), second = push confirm
  const ui = createUIMock({
    askConfirm: mock(() => Promise.resolve(false)),
    ...SELECT_ALL,
    askText: mock(() => Promise.resolve("feat: proceed anyway")),
  });

  await new SyncFlow(git, ui).run();

  expect(git.previewSelectedCommit).toHaveBeenCalledTimes(1);
});
