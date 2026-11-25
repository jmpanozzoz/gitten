import { confirmAISend } from "./ai-consent";
import { describeHistoryRange, editableHistory, selectHistoryRange } from "./history-range";
import type { AICommitSummarizer } from "./ports/ai.port";
import type { HistoryCommit, HistoryRewritePort } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

const SQUASH_LIMIT = 20;

export class SquashFlow {
  constructor(
    private readonly git: HistoryRewritePort,
    private readonly ui: IUI,
    private readonly aiSummarizer?: AICommitSummarizer,
  ) {}

  async run(): Promise<void> {
    const history = await editableHistory(this.git, this.ui, SQUASH_LIMIT);
    if (!history) return;
    if (!(await this.git.getStatus()).isClean()) {
      this.ui.warn("Working tree has uncommitted changes. Commit or stash them before squashing.");
      return;
    }
    if (history.commits.length < 2) {
      this.ui.info("Need at least 2 commits to squash.");
      return;
    }
    const range = await selectHistoryRange(
      this.ui,
      history,
      "Squash from HEAD through this first-parent commit:",
    );
    if (!range || range.count < 2) {
      this.ui.info("Pick a commit below HEAD so at least 2 commits are squashed.");
      return;
    }
    const fallback = await this.suggestMessage(history.commits.slice(0, range.count));
    const message = await this.ui.askText("Squashed commit message:", undefined, fallback);
    this.ui.warn(`${describeHistoryRange(range)} → 1 commit. Published history would diverge.`);
    if (!(await this.ui.askConfirm(`Squash ${range.count} commits into one?`, false))) return;

    const backup = await this.ui.spin("Squashing...", () =>
      this.git.squashRange(range, message.trim() || fallback),
    );
    this.ui.success(`Squashed ${range.count} commits into one. Recovery ref ${backup}.`);
  }

  private async suggestMessage(commits: HistoryCommit[]): Promise<string> {
    const fallback = commits.at(-1)!.subject.trim() || "chore: squash commits";
    const summarize = this.aiSummarizer;
    if (
      !summarize ||
      !(await confirmAISend(this.ui, "the commit messages for a squash summary", summarize))
    ) {
      return fallback;
    }
    try {
      return (
        (await this.ui.spin("Summarizing...", () =>
          summarize(commits.map(({ subject }) => subject)),
        )) || fallback
      );
    } catch {
      return fallback;
    }
  }
}
