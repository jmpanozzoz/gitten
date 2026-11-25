import type { RemoteResetTarget } from "../domain/reset-target";

export type { RemoteResetTarget } from "../domain/reset-target";

export interface RepoContext {
  branch: string;
  modifiedCount: number;
  commitsAhead: number;
  commitsBehind: number;
  insertions: number;
  deletions: number;
}

export interface BranchSummary {
  all: string[];
  current: string;
}

export interface CommitSummary {
  hash: string;
  message: string;
  body?: string;
}

export interface LogPage {
  head: string | null;
  commits: CommitSummary[];
  hasNext: boolean;
}

export interface StatusSummary {
  files: { path: string; status: string; previousPath?: string }[];
  isClean(): boolean;
  hasStagedChanges(): boolean;
  commitsAhead: number;
  commitsBehind: number;
}

export interface TrackingBranch {
  remote: string;
  name: string;
  ref: string;
  head: string;
}

export interface RemoteBranchDeletion {
  target: TrackingBranch;
  destination: string;
  urls: string[];
}

export interface Remote {
  name: string;
  url: string;
}

export interface PullResult {
  filesChanged: number;
  headChanged?: boolean;
}

export type DiffRequest =
  | { scope: "working" | "staged" }
  | { scope: "refs" | "merge-base"; base: string; target: string };

export interface DiffStat {
  insertions: number;
  deletions: number;
}

export interface CommitSelection {
  paths: readonly string[];
  head: string | null;
  branchRef: string;
  tree: string;
  diff: string;
  stat: DiffStat;
}

export type GitOperation = "rebase" | "merge" | "cherry-pick" | "revert" | "bisect";
export type ConflictOperation = Exclude<GitOperation, "bisect">;

export interface IndexEntry {
  path: string;
  previousPath?: string;
}

export interface RepositoryStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: IndexEntry[];
  unstaged: string[];
  untracked: string[];
}

export interface ConflictPort {
  getInProgressOperation(): Promise<GitOperation | null>;
  getConflictIdentity(operation: ConflictOperation): Promise<string | null>;
  getConflictedFiles(): Promise<string[]>;
  getConflictDiff(): Promise<string>;
  hasStagedConflictMarkers(): Promise<boolean>;
}

export interface RepositoryStatusPort extends ConflictPort {
  describeStatus(): Promise<RepositoryStatus>;
  getStagedPathDiff(paths: string[]): Promise<string>;
  unstagePaths(paths: string[]): Promise<void>;
  mergeContinue(): Promise<void>;
  mergeAbort(): Promise<void>;
  rebaseContinue(): Promise<void>;
  rebaseAbort(): Promise<void>;
  cherryPickContinue(): Promise<void>;
  cherryPickAbort(): Promise<void>;
  revertContinue(): Promise<void>;
  revertAbort(): Promise<void>;
}

export interface PurgeScope {
  refs: string[];
  absent: string[];
}

export interface TagPushPlan {
  name: string;
  oid: string;
  remote: string;
  urls: string[];
}

export interface BranchPushPlan {
  branch: string;
  head: string;
  remote: string;
  destination: string;
  urls: string[];
  upstreamRemote: string | null;
}

export interface BranchPushPort {
  getRemotes(): Promise<Remote[]>;
  previewBranchPush(remote: string): Promise<BranchPushPlan>;
  pushBranch(plan: BranchPushPlan, setUpstream?: boolean): Promise<void>;
}

export interface HistoryCommit {
  oid: string;
  firstParent: string | null;
  subject: string;
}

export interface RewriteHistory {
  branchRef: string;
  commits: HistoryCommit[];
}

export interface HistoryRange {
  branchRef: string;
  head: string;
  oldest: string;
  base: string | null;
  count: number;
}

export type UndoMode = "soft" | "mixed";

export interface HistoryRewritePort {
  getStatus(): Promise<StatusSummary>;
  getInProgressOperation(): Promise<GitOperation | null>;
  readRewriteHistory(limit: number): Promise<RewriteHistory>;
  undoRange(range: HistoryRange, mode: UndoMode): Promise<string>;
  squashRange(range: HistoryRange, message: string): Promise<string>;
}

export interface ResetPort {
  getStatus(): Promise<StatusSummary>;
  getInProgressOperation(): Promise<GitOperation | null>;
  discardLocalChanges(): Promise<void>;
  fetchRemote(remote?: string): Promise<void>;
  getRemoteResetTarget(): Promise<RemoteResetTarget | null>;
  resetToRemote(target: RemoteResetTarget): Promise<string>;
  getLogSince(ref: string, head?: string): Promise<CommitSummary[]>;
}

export interface IGitClient
  extends RepositoryStatusPort,
    BranchPushPort,
    HistoryRewritePort,
    ResetPort {
  checkIsRepo(): Promise<boolean>;
  getRepositoryRoot(): Promise<string>;
  hasIndexLock(): Promise<boolean>;
  initRepo(): Promise<void>;
  addRemote(name: string, url: string): Promise<void>;
  removeRemote(name: string): Promise<void>;
  setRemoteUrl(name: string, url: string): Promise<void>;
  getCurrentBranch(): Promise<string>;
  getRepoContext(): Promise<RepoContext>;
  getBranches(): Promise<BranchSummary>;
  getTrackingBranches(): Promise<TrackingBranch[]>;
  checkoutTrackingBranch(target: TrackingBranch, local: string): Promise<void>;
  getBranchLastActivity(branch: string): Promise<string>;
  isValidBranchName(name: string): Promise<boolean>;
  branchExists(name: string): Promise<boolean>;
  checkoutNewBranch(name: string): Promise<void>;
  checkoutBranch(name: string): Promise<void>;
  stash(): Promise<void>;
  deleteLocalBranch(name: string): Promise<void>;
  deleteLocalBranchForce(name: string): Promise<void>;
  previewRemoteBranchDeletion(target: TrackingBranch): Promise<RemoteBranchDeletion>;
  deleteRemoteBranch(plan: RemoteBranchDeletion): Promise<void>;
  getLog(ref: string, limit: number, offset?: number): Promise<CommitSummary[]>;
  readLogPage(request: { head?: string; limit: number; offset: number }): Promise<LogPage>;
  cherryPick(hash: string): Promise<void>;
  revertCommit(hash: string): Promise<void>;
  pull(): Promise<PullResult>;
  addAll(): Promise<void>;
  addFiles(paths: string[]): Promise<void>;
  getDiffStat(): Promise<DiffStat>;
  getStagedDiff(): Promise<string>;
  readDiff(request: DiffRequest): Promise<string>;
  commit(message: string): Promise<void>;
  previewSelectedCommit(paths: readonly string[]): Promise<CommitSelection>;
  commitSelection(selection: CommitSelection, message: string): Promise<string>;
  readGitignore(): Promise<string[]>;
  writeGitignore(lines: string[], expected?: readonly string[]): Promise<void>;
  getTrackedFiles(): Promise<string[]>;
  getIgnoredTrackedFiles(): Promise<string[]>;
  untrackFiles(paths: string[]): Promise<void>;
  getLastCommit(): Promise<CommitSummary>;
  amendCommit(message: string, messageOnly?: boolean): Promise<void>;
  amendNoEdit(): Promise<void>;
  getPackageVersion(): Promise<string | null>;
  getLastTag(head?: string): Promise<string | null>;
  createAnnotatedTag(name: string, message: string, commit?: string): Promise<void>;
  previewTagPush(name: string, remote: string): Promise<TagPushPlan>;
  pushTag(plan: TagPushPlan): Promise<void>;
  bisectStart(): Promise<void>;
  bisectBad(ref?: string): Promise<BisectResult>;
  bisectGood(ref?: string): Promise<BisectResult>;
  bisectSkip(): Promise<BisectResult>;
  bisectReset(): Promise<void>;
  getWorktrees(): Promise<WorktreeEntry[]>;
  addWorktree(path: string, branch: string, newBranch: boolean): Promise<void>;
  removeWorktree(path: string): Promise<void>;
  filterRepoAvailable(): Promise<boolean>;
  describePurge(paths: string[]): Promise<PurgeScope>;
  purgeFromHistory(paths: string[], expectedRefs: string[]): Promise<string>;
  getStashes(): Promise<StashEntry[]>;
  stashWithMessage(message: string, includeUntracked?: boolean): Promise<void>;
  stashApply(selection: StashIdentity): Promise<void>;
  stashPop(selection: StashIdentity): Promise<void>;
  stashDrop(selection: StashIdentity): Promise<void>;
  getCommitDiff(hash: string): Promise<string>;
  getStashDiff(oid: string): Promise<string>;
  getStashStat(
    oid: string,
  ): Promise<{ filesChanged: number; insertions: number; deletions: number }>;
  pullRebase(): Promise<PullResult>;
}

export interface BisectResult {
  done: boolean;
  badCommit?: CommitSummary;
}

export interface WorktreeEntry {
  path: string;
  branch: string;
  isMain: boolean;
  isLocked: boolean;
}

export interface StashIdentity {
  oid: string;
  index: number;
}

export interface StashEntry extends StashIdentity {
  message: string;
  date: string;
}
