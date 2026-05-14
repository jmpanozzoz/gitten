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

export interface IGitClient {
  checkIsRepo(): Promise<boolean>;
  hasIndexLock(): Promise<boolean>;
  getCurrentBranch(): Promise<string>;
  getBranches(): Promise<BranchSummary>;
  branchExists(name: string): Promise<boolean>;
  checkoutNewBranch(name: string): Promise<void>;
  deleteLocalBranch(name: string): Promise<void>;
  deleteRemoteBranch(name: string): Promise<void>;
  getLog(branch: string, limit: number): Promise<CommitSummary[]>;
  cherryPick(hash: string): Promise<void>;
  cherryPickContinue(): Promise<void>;
  cherryPickAbort(): Promise<void>;
  getStatus(): Promise<StatusSummary>;
  addAll(): Promise<void>;
  commit(message: string): Promise<void>;
  push(setUpstream?: boolean): Promise<void>;
}
