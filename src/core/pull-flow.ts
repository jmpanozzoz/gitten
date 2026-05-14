import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { stdinResolution } from "../utils/stdin-resolution";

export class PullFlow {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly waitForResolution: () => Promise<boolean> = stdinResolution
  ) {}

  async run(): Promise<void> {
    const remotes = await this.git.getRemotes();
    if (remotes.length === 0) {
      this.ui.info("No remote configured. Add one via Manage Remotes.");
      return;
    }

    try {
      await this.ui.spin("Pulling latest changes...", () => this.git.pull());
      this.ui.success("Branch is up to date.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";

      if (message.includes("no tracking") || message.includes("no upstream") || message.includes("has no upstream")) {
        this.ui.error("This branch has no upstream. Push it first with Sync.");
        return;
      }

      if (message.includes("conflict")) {
        await this.handleConflict();
        return;
      }

      throw err;
    }
  }

  private async handleConflict(): Promise<void> {
    this.ui.warn(
      "🚨 Conflict detected. Open your IDE, resolve the files, then press ENTER to continue or ESC to abort."
    );

    const confirmed = await this.waitForResolution();

    if (confirmed) {
      try {
        await this.git.addAll();
        await this.git.mergeContinue();
        this.ui.success("Merge completed.");
      } catch {
        this.ui.error("Failed to complete merge. Check your working tree.");
      }
    } else {
      await this.git.mergeAbort();
      this.ui.info("Merge aborted. Working tree is clean.");
    }
  }
}
