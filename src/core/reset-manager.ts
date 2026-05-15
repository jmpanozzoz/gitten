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

    const confirmed = await this.ui.askConfirm(
      `This will discard all local commits and changes not pushed to origin/${branch}.`
    );
    if (!confirmed) return;

    await this.ui.spin("Fetching and resetting...", async () => {
      await this.git.fetchRemote();
      await this.git.resetHardToRemote(branch);
    });
    this.ui.success(`Branch reset to origin/${branch}.`);
  }
}
