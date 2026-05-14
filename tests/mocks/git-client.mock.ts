import { mock } from "bun:test";
import type { IGitClient, BranchSummary, CommitSummary, StatusSummary, Remote } from "../../src/core/ports/git-client.port";

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
    getBranches: mock(() => Promise.resolve({ all: [], current: "main" } satisfies BranchSummary)),
    branchExists: mock(() => Promise.resolve(false)),
    checkoutNewBranch: mock(() => Promise.resolve()),
    deleteLocalBranch: mock(() => Promise.resolve()),
    deleteRemoteBranch: mock(() => Promise.resolve()),
    getLog: mock(() => Promise.resolve([] satisfies CommitSummary[])),
    cherryPick: mock(() => Promise.resolve()),
    cherryPickContinue: mock(() => Promise.resolve()),
    cherryPickAbort: mock(() => Promise.resolve()),
    pull: mock(() => Promise.resolve()),
    mergeAbort: mock(() => Promise.resolve()),
    mergeContinue: mock(() => Promise.resolve()),
    getStatus: mock(() =>
      Promise.resolve({ files: [], isClean: () => true } satisfies StatusSummary)
    ),
    addAll: mock(() => Promise.resolve()),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
    ...overrides,
  };
}
