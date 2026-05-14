import { mock } from "bun:test";
import type { IGitClient, BranchSummary, CommitSummary, StatusSummary } from "../../src/core/ports/git-client.port";

export function createGitMock(overrides: Partial<IGitClient> = {}): IGitClient {
  return {
    checkIsRepo: mock(() => Promise.resolve(true)),
    hasIndexLock: mock(() => Promise.resolve(false)),
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
    getStatus: mock(() =>
      Promise.resolve({ files: [], isClean: () => true } satisfies StatusSummary)
    ),
    addAll: mock(() => Promise.resolve()),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
    ...overrides,
  };
}
