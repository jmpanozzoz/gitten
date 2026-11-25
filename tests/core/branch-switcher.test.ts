import { expect, mock, test } from "bun:test";
import { BranchSwitcher } from "../../src/core/branch-switcher";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const BRANCHES = { all: ["main", "dev", "feat/login", "fix/bug-42"], current: "feat/login" };
const UPSTREAM = {
  branch: "main",
  head: "a".repeat(40),
  remote: "publish",
  ref: "refs/remotes/publish/main",
  commit: "b".repeat(40),
};
const CLEAN = {
  files: [],
  isClean: () => true,
  commitsAhead: 0,
  commitsBehind: 0,
};
const DIRTY = {
  files: [{ path: "src/app.ts", status: "M" }],
  isClean: () => false,
  commitsAhead: 0,
  commitsBehind: 0,
};

// ─── no branches ─────────────────────────────────────────────────────────────

test("shows info and returns when no other branches exist", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main"], current: "main" })),
  });
  const ui = createUIMock();

  await new BranchSwitcher(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(ui.askSearchSelect).not.toHaveBeenCalled();
});

// ─── clean working tree ───────────────────────────────────────────────────────

test("checks out selected branch directly when working tree is clean", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(CLEAN)),
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("main" as never)),
  });

  await new BranchSwitcher(git, ui).run();

  expect(git.checkoutBranch).toHaveBeenCalledWith("main");
  expect(git.stash).not.toHaveBeenCalled();
  expect(git.fetchRemote).not.toHaveBeenCalled();
});

test("excludes current branch from the list", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(CLEAN)),
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("main" as never)),
  });

  await new BranchSwitcher(git, ui).run();

  const options = (ui.askSearchSelect as ReturnType<typeof mock>).mock.calls[0]![1] as {
    value: string;
  }[];
  expect(options.some((o) => o.value === "feat/login")).toBe(false);
  expect(options.some((o) => o.value === "main")).toBe(true);
  expect(options.some((o) => o.value === "dev")).toBe(true);
});

test("shows last activity date alongside each branch name", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(CLEAN)),
    getBranchLastActivity: mock(() => Promise.resolve("3 hours ago")),
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("main" as never)),
  });

  await new BranchSwitcher(git, ui).run();

  const options = (ui.askSearchSelect as ReturnType<typeof mock>).mock.calls[0]![1] as {
    label: string;
  }[];
  expect(options.every((o) => o.label.includes("3 hours ago"))).toBe(true);
});

// ─── dirty working tree ───────────────────────────────────────────────────────

test("stashes changes and switches when user confirms on dirty tree", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(DIRTY)),
    stash: mock(() => Promise.resolve()),
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("main" as never)),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchSwitcher(git, ui).run();

  expect(git.stash).toHaveBeenCalledTimes(1);
  expect(git.checkoutBranch).toHaveBeenCalledWith("main");
});

test("aborts without switching when user declines stash on dirty tree", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(DIRTY)),
    stash: mock(() => Promise.resolve()),
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("main" as never)),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new BranchSwitcher(git, ui).run();

  expect(git.stash).not.toHaveBeenCalled();
  expect(git.checkoutBranch).not.toHaveBeenCalled();
});

test("shows stash hint after switching from dirty tree", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(DIRTY)),
    stash: mock(() => Promise.resolve()),
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("main" as never)),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchSwitcher(git, ui).run();

  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("stash"));
});

// ─── behind warning after switch ──────────────────────────────────────────────

test("warns and offers pull when branch is behind origin after switching", async () => {
  const BEHIND = {
    files: [],
    isClean: () => true,
    commitsAhead: 0,
    commitsBehind: 5,
  };
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(BEHIND)),
    getRemoteResetTarget: async () => UPSTREAM,
    checkoutBranch: mock(() => Promise.resolve()),
    pull: mock(() => Promise.resolve({ filesChanged: 3 })),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("main" as never)),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchSwitcher(git, ui).run();

  expect(ui.askConfirm).toHaveBeenCalledWith(expect.stringContaining("5 commit(s) behind"));
  expect(git.fetchRemote).toHaveBeenCalledWith("publish");
  expect(git.pull).toHaveBeenCalledTimes(1);
  expect(ui.success).toHaveBeenCalledWith("Up to date.");
});

test("skips pull when user declines the behind warning", async () => {
  const BEHIND = {
    files: [],
    isClean: () => true,
    commitsAhead: 0,
    commitsBehind: 2,
  };
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(BEHIND)),
    getRemoteResetTarget: async () => UPSTREAM,
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("main" as never)),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new BranchSwitcher(git, ui).run();

  expect(git.pull).not.toHaveBeenCalled();
});

test("does not warn when branch is up to date after switching", async () => {
  const UP_TO_DATE = {
    files: [],
    isClean: () => true,
    commitsAhead: 0,
    commitsBehind: 0,
  };
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve(BRANCHES)),
    getStatus: mock(() => Promise.resolve(UP_TO_DATE)),
    getRemoteResetTarget: async () => UPSTREAM,
    checkoutBranch: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSearchSelect: mock(() => Promise.resolve("main" as never)),
  });

  await new BranchSwitcher(git, ui).run();

  expect(ui.askConfirm).not.toHaveBeenCalled();
  expect(git.pull).not.toHaveBeenCalled();
});

test("checks tracking aliases before touching local changes", async () => {
  const git = createGitMock({
    getBranches: async () => BRANCHES,
    getTrackingBranches: async () => [
      {
        remote: "review",
        name: "main",
        ref: "refs/remotes/review/main",
        head: UPSTREAM.commit,
      },
    ],
  });
  const ui = createUIMock({
    askSearchSelect: mock().mockResolvedValue("\0refs/remotes/review/main"),
    askText: mock().mockResolvedValue("main"),
  });
  await new BranchSwitcher(git, ui).run();
  expect(ui.askText).toHaveBeenCalledWith(
    "Create local tracking branch:",
    undefined,
    "review/main",
  );
  expect(ui.warn).toHaveBeenCalledWith("Choose a new local branch name.");
  expect(git.getStatus).not.toHaveBeenCalled();
  expect(git.checkoutTrackingBranch).not.toHaveBeenCalled();
});

test("does not pull when the upstream changes during fetch or after confirmation", async () => {
  const changed = { ...UPSTREAM, remote: "other" };
  for (const observations of [
    [UPSTREAM, null],
    [UPSTREAM, changed],
    [UPSTREAM, UPSTREAM, changed],
  ]) {
    const upstream = mock().mockResolvedValue(observations.at(-1));
    for (const target of observations) upstream.mockResolvedValueOnce(target);
    const git = createGitMock({
      getBranches: async () => BRANCHES,
      getStatus: async () => ({ ...CLEAN, commitsBehind: 2 }),
      getRemoteResetTarget: upstream,
    });
    const ui = createUIMock({
      askSearchSelect: mock().mockResolvedValue("main"),
      askConfirm: mock().mockResolvedValue(true),
    });
    await new BranchSwitcher(git, ui).run();
    expect(git.fetchRemote).toHaveBeenCalledWith("publish");
    expect(git.pull).not.toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("Use Pull to review"));
  }
});

test("does not fetch if another branch takes over before the upstream lookup", async () => {
  const git = createGitMock({
    getBranches: async () => BRANCHES,
    getRemoteResetTarget: async () => ({ ...UPSTREAM, branch: "dev" }),
  });
  const ui = createUIMock({ askSearchSelect: mock().mockResolvedValue("main") });
  await new BranchSwitcher(git, ui).run();
  expect(git.checkoutBranch).toHaveBeenCalledWith("main");
  expect(git.fetchRemote).not.toHaveBeenCalled();
});

test("reports a failed refresh and preserves cancellation after a successful switch", async () => {
  for (const reason of [new Error("offline"), new GoBackSignal()]) {
    const git = createGitMock({
      getBranches: async () => BRANCHES,
      getRemoteResetTarget: async () => UPSTREAM,
      fetchRemote: mock().mockRejectedValue(reason),
    });
    const ui = createUIMock({ askSearchSelect: mock().mockResolvedValue("main") });
    const result = new BranchSwitcher(git, ui).run();
    if (reason instanceof GoBackSignal) {
      await expect(result).rejects.toBe(reason);
    } else {
      await result;
      expect(ui.info).toHaveBeenCalledWith("Branch switched. Use Pull to refresh its upstream.");
    }
    expect(ui.success).toHaveBeenCalledWith("Switched to main.");
    expect(git.pull).not.toHaveBeenCalled();
  }
});
