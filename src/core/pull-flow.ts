import { confirmAISend } from "./ai-consent";
import { resolveConflict } from "./conflict-resolver";
import type { AICommitSummarizer, AIConflictExplainer } from "./ports/ai.port";
import type { IGitClient, PullResult } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type PullStrategy = "merge" | "rebase";

interface PullFlowOptions {
  waitForResolution?: () => Promise<boolean>;
  aiSummarizer?: AICommitSummarizer;
  aiConflictExplainer?: AIConflictExplainer;
}

export class PullFlow {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly options: PullFlowOptions = {},
  ) {}

  async run(): Promise<void> {
    const currentOperation = await this.git.getInProgressOperation();
    if (currentOperation === "merge" || currentOperation === "rebase") {
      await this.handleConflict(currentOperation);
      return;
    }
    if (currentOperation) {
      this.ui.warn(`Finish the pending ${currentOperation} before pulling.`);
      return;
    }

    const remotes = await this.git.getRemotes();
    if (remotes.length === 0) {
      this.ui.info("No remote configured. Add one via Manage Remotes.");
      return;
    }

    const strategy = await this.ui.askSelect<PullStrategy>("Pull strategy:", [
      { value: "merge", label: "Merge (default)" },
      { value: "rebase", label: "Rebase — keeps history linear, avoids merge commits" },
    ]);

    const beforeHash = await this.headForSummary();
    try {
      const result = await this.ui.spin("Pulling latest changes...", () =>
        strategy === "rebase" ? this.git.pullRebase() : this.git.pull(),
      );
      await this.reportPull(result, beforeHash);
    } catch (error) {
      await this.handleFailure(strategy, error);
    }
  }

  private async headForSummary(): Promise<string | null> {
    if (!this.options.aiSummarizer) return null;
    const previous = await this.git.getLastCommit().catch(() => null);
    return previous?.hash ?? null;
  }

  private async reportPull(
    { filesChanged, headChanged }: PullResult,
    beforeHash: string | null,
  ): Promise<void> {
    if (filesChanged === 0 && !headChanged) {
      this.ui.info("Already up to date.");
      return;
    }
    this.ui.success(
      filesChanged > 0
        ? `Pulled successfully. ${filesChanged} file(s) changed.`
        : "Pulled successfully. HEAD moved without tracked file changes.",
    );
    const summarize = this.options.aiSummarizer;
    if (!summarize || !beforeHash) return;

    try {
      const commits = await this.git.getLogSince(beforeHash);
      if (commits.length === 0) return;
      if (!(await confirmAISend(this.ui, "the new commit messages for a pull summary", summarize)))
        return;
      const summary = await this.ui.spin("Summarizing changes...", () =>
        summarize(commits.map((commit) => commit.message)),
      );
      if (summary) this.ui.info(`✨ What changed:\n${summary}`);
    } catch {
      // The pull has already completed.
    }
  }

  private async handleFailure(strategy: PullStrategy, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("no tracking") || message.includes("no upstream")) {
      this.ui.error("This branch has no upstream. Push it first with Sync.");
      return;
    }
    if ((await this.git.getInProgressOperation()) === strategy) {
      await this.handleConflict(strategy);
      return;
    }
    throw error;
  }

  private async handleConflict(strategy: PullStrategy): Promise<void> {
    const rebase = strategy === "rebase";
    await resolveConflict(
      this.git,
      this.ui,
      {
        operation: strategy,
        label: rebase ? "Rebase" : "Merge",
        onContinue: () => (rebase ? this.git.rebaseContinue() : this.git.mergeContinue()),
        onAbort: () => (rebase ? this.git.rebaseAbort() : this.git.mergeAbort()),
        explain: this.options.aiConflictExplainer,
      },
      this.options.waitForResolution,
    );
  }
}
