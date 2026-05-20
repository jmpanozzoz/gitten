import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import type { AICommitSummarizer } from "./ports/ai.port";
import { stdinResolution } from "../utils/stdin-resolution";
import { resolveConflict } from "./conflict-resolver";

export class PullFlow {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly waitForResolution: () => Promise<boolean> = stdinResolution,
    private readonly aiSummarizer?: AICommitSummarizer
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

    let beforeHash: string | null = null;
    if (this.aiSummarizer) {
      try { beforeHash = (await this.git.getLastCommit()).hash; } catch { /* empty repo */ }
    }

    try {
      const result = await this.ui.spin("Pulling latest changes...", doPull);
      if (result.filesChanged === 0) {
        this.ui.info("Already up to date.");
      } else {
        this.ui.success(`Pulled successfully. ${result.filesChanged} file(s) changed.`);
        if (this.aiSummarizer && beforeHash) {
          try {
            const newCommits = await this.git.getLogSince(beforeHash);
            if (newCommits.length > 0) {
              const summary = await this.ui.spin("Summarizing changes...", () =>
                this.aiSummarizer!(newCommits.map((c) => c.message))
              );
              if (summary) this.ui.info(`✨ What changed:\n${summary}`);
            }
          } catch { /* non-blocking */ }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";

      if (message.includes("no tracking") || message.includes("no upstream") || message.includes("has no upstream")) {
        this.ui.error("This branch has no upstream. Push it first with Sync.");
        return;
      }

      if (message.includes("conflict")) {
        await resolveConflict(this.git, this.ui, {
          label: "Merge",
          onContinue: async () => {
            await this.git.addAll();
            await this.git.mergeContinue();
          },
          onAbort: () => this.git.mergeAbort(),
        }, this.waitForResolution);
        return;
      }

      throw err;
    }
  }
}
