import type { BranchType } from "./ui.port";

export type AICommitSuggester = (diff: string) => Promise<string | null>;
export type AICommitExplainer = (diff: string) => Promise<string | null>;
export type AIConflictExplainer = (conflictDiff: string) => Promise<string | null>;
export type AICommitReviewer = (diff: string) => Promise<string[]>;
export type AICommitSummarizer = (messages: string[]) => Promise<string | null>;
export type AIMessageImprover = (message: string) => Promise<string | null>;
export type AIBranchSuggester = (type: BranchType, description: string) => Promise<string | null>;
export type AIGitignoreSuggester = (files: string[], existing: string[]) => Promise<string[]>;
