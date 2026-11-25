import type { BranchType } from "./ui.port";

export interface AIDestination {
  readonly destination?: string;
}

type AIAction<Arguments extends unknown[], Result> = ((...args: Arguments) => Promise<Result>) &
  AIDestination;

export type AICommitSuggester = AIAction<[diff: string], string | null>;
export type AICommitExplainer = AIAction<[diff: string], string | null>;
export type AIConflictExplainer = AIAction<[conflictDiff: string], string | null>;
export type AICommitReviewer = AIAction<[diff: string], string[]>;
export type AICommitSummarizer = AIAction<[messages: string[]], string | null>;
export type AIMessageImprover = AIAction<[message: string], string | null>;
export type AIBranchSuggester = AIAction<[type: BranchType, description: string], string | null>;
export type AIGitignoreSuggester = AIAction<[files: string[], existing: string[]], string[]>;
