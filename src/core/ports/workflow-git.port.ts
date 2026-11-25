import type { ConflictPort, IGitClient } from "./git-client.port";

export type BisectPort = Pick<
  IGitClient,
  | "bisectBad"
  | "bisectGood"
  | "bisectReset"
  | "bisectSkip"
  | "bisectStart"
  | "getCommitDiff"
  | "getCurrentBranch"
  | "getInProgressOperation"
  | "getLastCommit"
  | "getLog"
>;

export type BranchCleanupPort = Pick<
  IGitClient,
  | "deleteLocalBranch"
  | "deleteLocalBranchForce"
  | "deleteRemoteBranch"
  | "getBranchLastActivity"
  | "getBranches"
  | "getLog"
  | "getTrackingBranches"
  | "previewRemoteBranchDeletion"
>;

export type CreateBranchPort = Pick<
  IGitClient,
  "branchExists" | "checkoutNewBranch" | "isValidBranchName"
>;

export type SwitchBranchPort = Pick<
  IGitClient,
  | "checkoutBranch"
  | "checkoutTrackingBranch"
  | "fetchRemote"
  | "getBranchLastActivity"
  | "getBranches"
  | "getRemoteResetTarget"
  | "getStatus"
  | "getTrackingBranches"
  | "pull"
  | "stash"
>;

export type CherryPickPort = ConflictPort &
  Pick<
    IGitClient,
    | "cherryPick"
    | "cherryPickAbort"
    | "cherryPickContinue"
    | "getBranches"
    | "getCommitDiff"
    | "getLog"
    | "getTrackingBranches"
  >;

export type DiffPort = Pick<IGitClient, "getBranches" | "getTrackingBranches" | "readDiff">;

export type GitignorePort = Pick<
  IGitClient,
  | "getIgnoredTrackedFiles"
  | "getInProgressOperation"
  | "getStagedPathDiff"
  | "getTrackedFiles"
  | "readGitignore"
  | "untrackFiles"
  | "writeGitignore"
>;

export type PurgePort = Pick<
  IGitClient,
  "describePurge" | "filterRepoAvailable" | "getStatus" | "getTrackedFiles" | "purgeFromHistory"
>;

export type LogPort = Pick<IGitClient, "getCommitDiff" | "readLogPage">;

export type ManageRemotesPort = Pick<
  IGitClient,
  "addRemote" | "getRemotes" | "initRepo" | "removeRemote" | "setRemoteUrl"
>;

export type RevertPort = ConflictPort &
  Pick<
    IGitClient,
    "getCurrentBranch" | "getLog" | "revertAbort" | "revertCommit" | "revertContinue"
  >;

export type StashPort = Pick<
  IGitClient,
  | "describeStatus"
  | "getInProgressOperation"
  | "getStashDiff"
  | "getStashStat"
  | "getStashes"
  | "stashApply"
  | "stashDrop"
  | "stashPop"
  | "stashWithMessage"
>;

export type TagPort = Pick<
  IGitClient,
  | "createAnnotatedTag"
  | "getLastCommit"
  | "getLastTag"
  | "getLog"
  | "getLogSince"
  | "getPackageVersion"
  | "getRemotes"
  | "previewTagPush"
  | "pushTag"
>;

export type WorktreePort = Pick<
  IGitClient,
  "addWorktree" | "getBranches" | "getWorktrees" | "removeWorktree"
>;
