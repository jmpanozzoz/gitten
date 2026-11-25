import { resolveConflict } from "./conflict-resolver";
import { DEFAULT_LIMITS } from "./domain/preferences";
import type { AIConflictExplainer } from "./ports/ai.port";
import type { IUI } from "./ports/ui.port";
import type { RevertPort } from "./ports/workflow-git.port";
import { PROTECTED_BRANCHES } from "./protected-branches";

interface RevertCommitOptions {
  waitForResolution?: () => Promise<boolean>;
  aiConflictExplainer?: AIConflictExplainer;
  logLimit?: number;
}

export class RevertCommit {
  constructor(
    private readonly git: RevertPort,
    private readonly ui: IUI,
    private readonly options: RevertCommitOptions = {},
  ) {}

  async run(): Promise<void> {
    const pending = await this.git.getInProgressOperation();
    if (pending === "revert") {
      await this.handleConflict();
      return;
    }
    if (pending) {
      this.ui.warn(`Finish the pending ${pending} before reverting.`);
      return;
    }

    const branch = await this.git.getCurrentBranch();

    if (PROTECTED_BRANCHES.has(branch)) {
      const proceed = await this.ui.askConfirm(
        `⚠️  You are on '${branch}'. Revert a commit on this branch?`,
      );
      if (!proceed) return;
    }

    const commits = await this.git.getLog(
      branch,
      this.options.logLimit ?? DEFAULT_LIMITS.revertLogLimit,
    );

    if (commits.length === 0) {
      this.ui.info("No commits to revert.");
      return;
    }

    const hash = await this.ui.askSearchSelect(
      "Select a commit to revert:",
      commits.map((c) => ({ value: c.hash, label: `${c.hash} — ${c.message}` })),
    );

    const commit = commits.find((c) => c.hash === hash)!;

    const confirmed = await this.ui.askConfirm(
      `Revert "${commit.message}"? This creates a new commit that undoes those changes.`,
    );
    if (!confirmed) return;

    try {
      await this.ui.spin(`Reverting ${hash}...`, () => this.git.revertCommit(hash));
      this.ui.success(`Reverted: a new commit undoing "${commit.message}" was created.`);
    } catch (error) {
      if ((await this.git.getInProgressOperation()) !== "revert") throw error;
      await this.handleConflict();
    }
  }

  private handleConflict(): Promise<boolean> {
    return resolveConflict(
      this.git,
      this.ui,
      {
        operation: "revert",
        label: "Revert",
        onContinue: () => this.git.revertContinue(),
        onAbort: () => this.git.revertAbort(),
        explain: this.options.aiConflictExplainer,
      },
      this.options.waitForResolution,
    );
  }
}
