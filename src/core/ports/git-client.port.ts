export interface BranchSummary {
  all: string[];
  current: string;
}

export interface CommitSummary {
  hash: string;
  message: string;
}

export interface StatusSummary {
  files: { path: string }[];
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
  branchExists(name: string): Promise<boolean>;
  checkoutNewBranch(name: string): Promise<void>;
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
  getDiffStat(): Promise<DiffStat>;
  commit(message: string): Promise<void>;
  push(setUpstream?: boolean): Promise<void>;
}
