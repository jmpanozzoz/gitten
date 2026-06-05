import { renderDiff } from "../ui/diff-renderer";
import type { AICommitExplainer } from "./ports/ai.port";
import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

const LOG_LIMIT = 30;

/**
 * Read-only history browser: list recent commits of the current branch, inspect
 * any commit's diff, and (optionally) get an AI explanation. The picker is the
 * exit point — cancelling it (ESC) raises GoBackSignal, which the menu loop
 * catches to return to the main menu.
 */
export class LogBrowser {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly aiExplainer?: AICommitExplainer,
  ) {}

  async run(): Promise<void> {
    const branch = await this.git.getCurrentBranch();
    const commits = await this.ui.spin("Loading history...", () =>
      this.git.getLog(branch, LOG_LIMIT),
    );

    if (commits.length === 0) {
      this.ui.info("No commits to show.");
      return;
    }

    const options = commits.map((c) => ({
      value: c.hash,
      label: `${c.hash} — ${c.message}`,
    }));

    // Browse loop: keep picking commits to inspect until the user cancels.
    while (true) {
      const hash = await this.ui.askSearchSelect(
        "Browse history — pick a commit to inspect:",
        options,
      );
      await this.inspect(hash);
    }
  }

  private async inspect(hash: string): Promise<void> {
    const diff = await this.ui.spin("Loading commit...", () => this.git.getCommitDiff(hash));

    if (!diff) {
      this.ui.info("No changes in this commit.");
      return;
    }

    this.ui.info(renderDiff(diff));

    if (!this.aiExplainer) return;

    const explain = await this.ui.askConfirm("✨ Explain this commit with AI?");
    if (!explain) return;

    try {
      const explanation = await this.ui.spin("Analyzing...", () => this.aiExplainer!(diff));
      if (explanation) this.ui.info(`✨ ${explanation}`);
    } catch {
      // AI is optional — never block browsing on it.
    }
  }
}
