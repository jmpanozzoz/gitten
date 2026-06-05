import type { AICommitSummarizer } from "./ports/ai.port";
import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { PROTECTED_BRANCHES } from "./protected-branches";

const SQUASH_LIMIT = 20;

/**
 * Collapse the most recent N commits on the current branch into one. The user
 * picks the boundary commit (everything from HEAD down to and including it is
 * folded); the squash is a soft reset + single recommit. Rewrites history, so
 * it guards protected branches and requires a clean working tree.
 */
export class SquashFlow {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly aiSummarizer?: AICommitSummarizer,
  ) {}

  async run(): Promise<void> {
    const branch = await this.git.getCurrentBranch();

    if (PROTECTED_BRANCHES.has(branch)) {
      const proceed = await this.ui.askConfirm(
        `⚠️  You are on '${branch}'. Rewrite history on this branch?`,
      );
      if (!proceed) return;
    }

    // A soft reset keeps staged changes, so squashing on a dirty tree would fold
    // uncommitted work into the new commit. Require a clean tree first.
    const status = await this.git.getStatus();
    if (!status.isClean()) {
      this.ui.warn("Working tree has uncommitted changes — commit or stash them before squashing.");
      return;
    }

    const commits = await this.git.getLog(branch, SQUASH_LIMIT);
    if (commits.length < 2) {
      this.ui.info("Need at least 2 commits to squash.");
      return;
    }

    const boundary = await this.ui.askSearchSelect(
      "Squash all commits from HEAD down to (and including):",
      commits.map((c) => ({ value: c.hash, label: `${c.hash} — ${c.message}` })),
    );

    const count = commits.findIndex((c) => c.hash === boundary) + 1;
    if (count < 2) {
      this.ui.info("Pick a commit below HEAD so at least 2 commits are squashed.");
      return;
    }

    const toSquash = commits.slice(0, count);
    let placeholder = toSquash[toSquash.length - 1]!.message;

    if (this.aiSummarizer) {
      const useAi = await this.ui.askConfirm("✨ Generate the squashed commit message with AI?");
      if (useAi) {
        try {
          const summary = await this.ui.spin("Summarizing...", () =>
            this.aiSummarizer!(toSquash.map((c) => c.message)),
          );
          if (summary) placeholder = summary;
        } catch {
          // AI is optional — fall back to the base commit message.
        }
      }
    }

    const message = await this.ui.askText("Squashed commit message:", undefined, placeholder);
    const finalMessage = message.trim() || placeholder;

    this.ui.warn(
      `This rewrites history: ${count} commits → 1. If they were already pushed, you'll need a force-push.`,
    );
    const proceed = await this.ui.askConfirm(`Squash ${count} commits into one?`);
    if (!proceed) return;

    await this.ui.spin("Squashing...", async () => {
      await this.git.resetSoft(count);
      await this.git.commit(finalMessage);
    });
    this.ui.success(`Squashed ${count} commits into one.`);
  }
}
