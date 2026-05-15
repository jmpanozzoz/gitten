import type { IGitClient, BisectResult } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type VerdictOption = "bad" | "good" | "stop";

export class BisectWizard {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
    const branch = await this.git.getCurrentBranch();
    const commits = await this.git.getLog(branch, 30);

    if (commits.length === 0) {
      this.ui.warn("No commits found on this branch.");
      return;
    }

    this.ui.info("Select the last commit you know was GOOD (before the bug appeared):");
    const goodHash = await this.ui.askSearchSelect(
      "Last known good commit:",
      commits.map((c) => ({ value: c.hash, label: `${c.hash}  ${c.message}` }))
    );

    await this.ui.spin("Starting bisect...", async () => {
      await this.git.bisectStart();
      await this.git.bisectBad(undefined);
      await this.git.bisectGood(goodHash);
    });

    await this.bisectLoop();
  }

  private async bisectLoop(): Promise<void> {
    while (true) {
      const current = await this.git.getLastCommit();
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

      const result: BisectResult = await this.ui.spin("Marking commit...", fn);

      if (result.done && result.badCommit) {
        this.ui.success(
          `First bad commit found: ${result.badCommit.hash}${result.badCommit.message ? ` — ${result.badCommit.message}` : ""}`
        );
        await this.ui.spin("Resetting bisect...", () => this.git.bisectReset());
        return;
      }
    }
  }
}
