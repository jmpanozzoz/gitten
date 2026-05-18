import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type ResetAction = "discard" | "remote";

export class ResetManager {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
    const action = await this.ui.askSelect<ResetAction>("Reset options:", [
      { value: "discard", label: "🗑️  Discard local changes" },
      { value: "remote", label: "⚡ Reset to remote" },
    ]);

    if (action === "discard") return this.discardChanges();
    if (action === "remote") return this.resetToRemote();
  }

  private async discardChanges(): Promise<void> {
    const status = await this.git.getStatus();
    if (status.isClean()) {
      this.ui.info("Working tree is already clean.");
      return;
    }

    const confirmed = await this.ui.askConfirm(
      "This will permanently discard all uncommitted changes and untracked files."
    );
    if (!confirmed) return;

    await this.ui.spin("Discarding local changes...", () => this.git.discardLocalChanges());
    this.ui.success("Working tree is clean.");
  }

  private async resetToRemote(): Promise<void> {
    const branch = await this.git.getCurrentBranch();

    try {
      await this.git.fetchRemote();
      const commits = await this.git.getLogSince(`origin/${branch}`);
      if (commits.length > 0) {
        this.ui.warn(`⚠️  ${commits.length} local commit(s) not on remote will be permanently lost:`);
        for (const c of commits) {
          this.ui.warn(`  • ${c.hash} — ${c.message}`);
        }
      }
    } catch {
      // no remote or offline — continue, the confirmation is enough
    }

    const confirmed = await this.ui.askConfirm(
      `Reset branch '${branch}' to origin/${branch}? This cannot be undone.`
    );
    if (!confirmed) return;

    await this.ui.spin("Resetting...", () => this.git.resetHardToRemote(branch));
    this.ui.success(`Branch reset to origin/${branch}.`);
  }
}
