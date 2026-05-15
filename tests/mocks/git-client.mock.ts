import { mock } from "bun:test";
import type { IGitClient, BranchSummary, CommitSummary, StatusSummary, Remote, PullResult, DiffStat, StashEntry } from "../../src/core/ports/git-client.port";

export function createGitMock(overrides: Partial<IGitClient> = {}): IGitClient {
  return {
    checkIsRepo: mock(() => Promise.resolve(true)),
    hasIndexLock: mock(() => Promise.resolve(false)),
    initRepo: mock(() => Promise.resolve()),
    getRemotes: mock(() => Promise.resolve([] satisfies Remote[])),
    addRemote: mock(() => Promise.resolve()),
    removeRemote: mock(() => Promise.resolve()),
    setRemoteUrl: mock(() => Promise.resolve()),
    getCurrentBranch: mock(() => Promise.resolve("main")),
    getRepoContext: mock(() =>
      Promise.resolve({ branch: "main", modifiedCount: 0, commitsAhead: 0, commitsBehind: 0, insertions: 0, deletions: 0 } satisfies RepoContext)
    ),
    getBranches: mock(() => Promise.resolve({ all: [], current: "main" } satisfies BranchSummary)),
    getBranchLastActivity: mock(() => Promise.resolve("2 days ago")),
    branchExists: mock(() => Promise.resolve(false)),
    checkoutNewBranch: mock(() => Promise.resolve()),
    checkoutBranch: mock(() => Promise.resolve()),
    stash: mock(() => Promise.resolve()),
    deleteLocalBranch: mock(() => Promise.resolve()),
    deleteRemoteBranch: mock(() => Promise.resolve()),
    getLog: mock(() => Promise.resolve([] satisfies CommitSummary[])),
    cherryPick: mock(() => Promise.resolve()),
    cherryPickContinue: mock(() => Promise.resolve()),
    cherryPickAbort: mock(() => Promise.resolve()),
    pull: mock(() => Promise.resolve({ filesChanged: 0 } satisfies PullResult)),
    mergeAbort: mock(() => Promise.resolve()),
    mergeContinue: mock(() => Promise.resolve()),
    getStatus: mock(() =>
      Promise.resolve({ files: [], isClean: () => true } satisfies StatusSummary)
    ),
    addAll: mock(() => Promise.resolve()),
    addFiles: mock(() => Promise.resolve()),
    getDiffStat: mock(() => Promise.resolve({ insertions: 0, deletions: 0 } satisfies DiffStat)),
    getStagedDiff: mock(() => Promise.resolve("")),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
    readGitignore: mock(() => Promise.resolve([] as string[])),
    writeGitignore: mock(() => Promise.resolve()),
    getTrackedFiles: mock(() => Promise.resolve([] as string[])),
    untrackFiles: mock(() => Promise.resolve()),
    getLastCommit: mock(() => Promise.resolve({ hash: "abc1234", message: "chore: update" })),
    resetSoft: mock(() => Promise.resolve()),
    resetMixed: mock(() => Promise.resolve()),
    filterRepoAvailable: mock(() => Promise.resolve(true)),
    purgeFromHistory: mock(() => Promise.resolve()),
    getStashes: mock(() => Promise.resolve([] as StashEntry[])),
    stashWithMessage: mock(() => Promise.resolve()),
    stashApply: mock(() => Promise.resolve()),
    stashPop: mock(() => Promise.resolve()),
    stashDrop: mock(() => Promise.resolve()),
    ...overrides,
  };
}
