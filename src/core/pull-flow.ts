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

    const strategy = await this.ui.askSelect<"merge" | "rebase">("Pull strategy:", [
      { value: "merge", label: "Merge (default)" },
      { value: "rebase", label: "Rebase — keeps history linear, avoids merge commits" },
    ]);

    const doPull = strategy === "rebase"
      ? () => this.git.pullRebase()
      : () => this.git.pull();

    try {
      const result = await this.ui.spin("Pulling latest changes...", doPull);
      if (result.filesChanged === 0) {
        this.ui.info("Already up to date.");
      } else {
        this.ui.success(`Pulled successfully. ${result.filesChanged} file(s) changed.`);
      }
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
    const conflicted = await this.git.getConflictedFiles();
    if (conflicted.length > 0) {
      this.ui.warn(`🚨 Merge conflict — ${conflicted.length} file(s) need resolution:`);
      for (const f of conflicted) {
        this.ui.warn(`  • ${f}`);
      }
    } else {
      this.ui.warn("🚨 Merge conflict detected.");
    }
    this.ui.warn("Resolve in your IDE, then press ENTER to continue or ESC to abort.");

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
