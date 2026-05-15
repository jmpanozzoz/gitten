import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type AmendOption = "message" | "staged" | "both";

export class AmendFlow {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
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
      if (status.isClean()) {
        this.ui.warn("Nothing staged — stage your changes before amending.");
        return;
      }
    }

    if (choice === "message") {
      await this.amendMessage(last.message);
    } else if (choice === "staged") {
      await this.ui.spin("Amending with staged files...", () => this.git.amendNoEdit());
      this.ui.success("Commit amended with staged files.");
    } else {
      await this.amendMessage(last.message);
    }
  }

  private async amendMessage(current: string): Promise<void> {
    const input = await this.ui.askText("Commit message:", undefined, current);
    const message = input.trim() || current;
    await this.ui.spin("Amending commit...", () => this.git.amendCommit(message));
    this.ui.success(`Commit amended: "${message}"`);
  }
}
