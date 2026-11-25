import type { AIConfig } from "../core/domain/preferences";
import type { BranchType } from "../core/ports/ui.port";
import {
  explainCommitDiff,
  explainConflict,
  reviewStagedDiff,
  suggestAmendMessage,
  suggestBranchName,
  suggestCommitMessage,
  suggestGitignorePatterns,
  summarizeCommits,
} from "./suggester";

export function bindAI(config: AIConfig) {
  const connection = { ...config };
  const atDestination = <T extends object>(fn: T) =>
    Object.assign(fn, { destination: connection.baseUrl });
  return {
    amend: atDestination((message: string) => suggestAmendMessage(message, connection)),
    branch: atDestination((type: BranchType, description: string) =>
      suggestBranchName(type, description, connection),
    ),
    commit: atDestination((diff: string) => suggestCommitMessage(diff, connection)),
    conflict: atDestination((diff: string) => explainConflict(diff, connection)),
    explain: atDestination((diff: string) => explainCommitDiff(diff, connection)),
    gitignore: atDestination((files: string[], patterns: string[]) =>
      suggestGitignorePatterns(files, patterns, connection),
    ),
    review: atDestination((diff: string) => reviewStagedDiff(diff, connection)),
    summarize: atDestination((messages: string[]) => summarizeCommits(messages, connection)),
  };
}
