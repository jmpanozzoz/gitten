import type { IGitClient, BisectResult } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import type { AICommitExplainer } from "./ports/ai.port";
import { readConfig, getLimits } from "../config/config";

type VerdictOption = "bad" | "good" | "stop";

export class BisectWizard {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly aiExplainer?: AICommitExplainer
  ) {}

  async run(): Promise<void> {
    const { bisectLogLimit } = getLimits(await readConfig());
    const branch = await this.git.getCurrentBranch();
    const commits = await this.git.getLog(branch, bisectLogLimit);

    if (commits.length === 0) {
      this.ui.warn("No commits found on this branch.");
      return;
    }

    this.ui.info("Select the last commit you know was GOOD (before the bug appeared):");
    const goodHash = await this.ui.askSearchSelect(
      "Last known good commit:",
      commits.map((c) => ({ value: c.hash, label: `${c.hash}  ${c.message}` }))
    );

    try {
      await this.ui.spin("Starting bisect...", async () => {
        await this.git.bisectStart();
        await this.git.bisectBad(undefined);
        await this.git.bisectGood(goodHash);
      });
    } catch (err) {
      this.ui.error(`Failed to start bisect: ${err instanceof Error ? err.message : String(err)}`);
      await this.git.bisectReset().catch(() => {});
      return;
    }

    await this.bisectLoop();
  }

  private async bisectLoop(): Promise<void> {
    while (true) {
      let current: { hash: string; message: string };
      try {
        current = await this.git.getLastCommit();
      } catch (err) {
        this.ui.error(`Lost track of current commit: ${err instanceof Error ? err.message : String(err)}`);
        await this.git.bisectReset().catch(() => {});
        return;
      }
      this.ui.info(`Testing: ${current.hash} — ${current.message}`);

      const verdict = await this.ui.askSelect<VerdictOption>(
        "Does this commit have the bug?",
        [
          { value: "bad", label: "✗  Yes — this commit is BAD" },
          { value: "good", label: "✓  No — this commit is GOOD" },
          { value: "stop", label: "⏹  Stop bisecting" },
        ]
      );

      if (verdict === "stop") {
        await this.ui.spin("Resetting bisect...", () => this.git.bisectReset());
        this.ui.info("Bisect cancelled.");
        return;
      }

      const fn = verdict === "bad"
        ? () => this.git.bisectBad()
        : () => this.git.bisectGood();

      let result: BisectResult;
      try {
        result = await this.ui.spin("Marking commit...", fn);
      } catch (err) {
        this.ui.error(`Bisect failed: ${err instanceof Error ? err.message : String(err)}`);
        await this.git.bisectReset().catch(() => {});
        return;
      }

      if (result.done && result.badCommit) {
        this.ui.success(
          `First bad commit found: ${result.badCommit.hash}${result.badCommit.message ? ` — ${result.badCommit.message}` : ""}`
        );
        if (this.aiExplainer) {
          try {
            const diff = await this.git.getCommitDiff(result.badCommit.hash);
            if (diff) {
              const explanation = await this.ui.spin("Analyzing bad commit...", () => this.aiExplainer!(diff));
              if (explanation) this.ui.info(`✨ ${explanation}`);
            }
          } catch { /* non-blocking */ }
        }
        await this.ui.spin("Resetting bisect...", () => this.git.bisectReset());
        return;
      }
    }
  }
}
