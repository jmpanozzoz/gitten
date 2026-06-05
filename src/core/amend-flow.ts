import type { AIMessageImprover } from "./ports/ai.port";
import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { PROTECTED_BRANCHES } from "./protected-branches";

type AmendOption = "message" | "staged" | "both";

export class AmendFlow {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly aiSuggester?: AIMessageImprover,
  ) {}

  async run(): Promise<void> {
    const branch = await this.git.getCurrentBranch();
    if (PROTECTED_BRANCHES.has(branch)) {
      const proceed = await this.ui.askConfirm(
        `⚠️  You are on '${branch}'. Amend a commit on this branch?`,
      );
      if (!proceed) return;
    }

    let last: { hash: string; message: string };
    try {
      last = await this.git.getLastCommit();
    } catch {
      this.ui.error("No commits found — nothing to amend.");
      return;
    }
    this.ui.info(`Last commit: ${last.hash} — ${last.message}`);

    const choice = await this.ui.askSelect<AmendOption>("What do you want to amend?", [
      { value: "message", label: "✏️  Message only" },
      { value: "staged", label: "📁  Add staged files only" },
      { value: "both", label: "✏️  + 📁  Both" },
    ]);

    if (choice === "staged" || choice === "both") {
      const status = await this.git.getStatus();
      if (!status.hasStagedChanges()) {
        this.ui.warn("Nothing staged — stage your changes before amending.");
        return;
      }
    }

    if (choice === "message") {
      await this.amendMessage(last.message, false);
    } else if (choice === "staged") {
      await this.ui.spin("Amending with staged files...", () => this.git.amendNoEdit());
      this.ui.success("Commit amended with staged files.");
    } else {
      await this.amendMessage(last.message, true);
    }
  }

  private async amendMessage(current: string, withStagedFiles: boolean): Promise<void> {
    let placeholder = current;

    if (this.aiSuggester) {
      const improve = await this.ui.askConfirm("✨ Improve commit message with AI?");
      if (improve) {
        try {
          const suggestion = await this.ui.spin("Improving...", () => this.aiSuggester!(current));
          if (suggestion) {
            placeholder = suggestion;
            this.ui.info(`Suggested: ${suggestion}`);
          }
        } catch (err) {
          this.ui.warn(`AI failed: ${err instanceof Error ? err.message : "unknown error"}`);
        }
      }
    }

    const input = await this.ui.askText("Commit message:", undefined, placeholder);
    const message = input.trim() || current;
    await this.ui.spin("Amending commit...", () => this.git.amendCommit(message));
    this.ui.success(
      withStagedFiles
        ? `Commit amended with new message and staged files: "${message}"`
        : `Commit amended: "${message}"`,
    );
  }
}
