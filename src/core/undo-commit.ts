import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type ResetMode = "soft" | "mixed";

export class UndoCommit {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
    let lastCommit;
    try {
      lastCommit = await this.git.getLastCommit();
    } catch {
      this.ui.error("No commits found in this repository.");
      return;
    }

    this.ui.info(`Last commit: ${lastCommit.hash} — ${lastCommit.message}`);

    const mode = await this.ui.askSelect<ResetMode>("How do you want to undo it?", [
      {
        value: "soft",
        label: "↩  Soft — keep changes staged (ready to re-commit)",
      },
      {
        value: "mixed",
        label: "↺  Mixed — keep changes unstaged (back to working tree)",
      },
    ]);

    const confirmed = await this.ui.askConfirm(
      `Undo commit "${lastCommit.hash}" with ${mode} reset?`
    );
    if (!confirmed) return;

    if (mode === "soft") {
      await this.ui.spin("Undoing commit (soft)...", () => this.git.resetSoft());
      this.ui.success("Commit undone. Changes are staged and ready to re-commit.");
    } else {
      await this.ui.spin("Undoing commit (mixed)...", () => this.git.resetMixed());
      this.ui.success("Commit undone. Changes are back in your working tree.");
    }
  }
}
