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
}

export interface StatusSummary {
  files: { path: string; status: string }[];
  isClean(): boolean;
}

export interface Remote {
  name: string;
  url: string;
}

export interface PullResult {
  filesChanged: number;
}

export interface DiffStat {
  insertions: number;
  deletions: number;
}

export interface IGitClient {
  checkIsRepo(): Promise<boolean>;
  hasIndexLock(): Promise<boolean>;
  initRepo(): Promise<void>;
  getRemotes(): Promise<Remote[]>;
  addRemote(name: string, url: string): Promise<void>;
  removeRemote(name: string): Promise<void>;
  setRemoteUrl(name: string, url: string): Promise<void>;
  getCurrentBranch(): Promise<string>;
  getRepoContext(): Promise<RepoContext>;
  getBranches(): Promise<BranchSummary>;
  getBranchLastActivity(branch: string): Promise<string>;
  branchExists(name: string): Promise<boolean>;
  checkoutNewBranch(name: string): Promise<void>;
  checkoutBranch(name: string): Promise<void>;
  stash(): Promise<void>;
  deleteLocalBranch(name: string): Promise<void>;
  deleteRemoteBranch(name: string): Promise<void>;
  getLog(branch: string, limit: number): Promise<CommitSummary[]>;
  cherryPick(hash: string): Promise<void>;
  cherryPickContinue(): Promise<void>;
  cherryPickAbort(): Promise<void>;
  pull(): Promise<PullResult>;
  mergeAbort(): Promise<void>;
  mergeContinue(): Promise<void>;
  getStatus(): Promise<StatusSummary>;
  addAll(): Promise<void>;
  addFiles(paths: string[]): Promise<void>;
  getDiffStat(): Promise<DiffStat>;
  getStagedDiff(): Promise<string>;
  commit(message: string): Promise<void>;
  push(setUpstream?: boolean): Promise<void>;
  readGitignore(): Promise<string[]>;
  writeGitignore(lines: string[]): Promise<void>;
  getTrackedFiles(): Promise<string[]>;
  untrackFiles(paths: string[]): Promise<void>;
  getLastCommit(): Promise<CommitSummary>;
  resetSoft(): Promise<void>;
  resetMixed(): Promise<void>;
  filterRepoAvailable(): Promise<boolean>;
  purgeFromHistory(paths: string[]): Promise<void>;
  getStashes(): Promise<StashEntry[]>;
  stashWithMessage(message: string): Promise<void>;
  stashApply(index: number): Promise<void>;
  stashPop(index: number): Promise<void>;
  stashDrop(index: number): Promise<void>;
  discardLocalChanges(): Promise<void>;
  fetchRemote(): Promise<void>;
  resetHardToRemote(branch: string): Promise<void>;
}

export interface StashEntry {
  index: number;
  message: string;
  date: string;
}
