import { GoBackSignal } from "./domain/navigation";
import { DEFAULT_LIMITS } from "./domain/preferences";
import { explainDiff } from "./explain-diff";
import type { AICommitExplainer } from "./ports/ai.port";
import type { BisectResult, CommitSummary, IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type Verdict = "bad" | "good" | "skip" | "stop";

export class BisectWizard {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly aiExplainer?: AICommitExplainer,
    private readonly logLimit = DEFAULT_LIMITS.bisectLogLimit,
  ) {}

  async run(): Promise<void> {
    const pending = await this.git.getInProgressOperation();
    if (pending === "bisect") return this.bisectLoop();
    if (pending) {
      this.ui.warn(`Finish the pending ${pending} before bisecting.`);
      return;
    }
    const commits = await this.git.getLog(await this.git.getCurrentBranch(), this.logLimit);
    if (commits.length === 0) {
      this.ui.warn("No commits found on this branch.");
      return;
    }
    const good = await this.ui.askSearchSelect(
      "Last known good commit:",
      commits.map(({ hash, message }) => ({ value: hash, label: `${hash}  ${message}` })),
    );
    const first = await this.start(good);
    if (!first) return;
    if (first.done && first.badCommit) return this.finish(first.badCommit);
    await this.bisectLoop();
  }

  private async start(good: string): Promise<BisectResult | null> {
    try {
      return await this.ui.spin("Starting bisect...", async () => {
        await this.git.bisectStart();
        await this.git.bisectBad(undefined);
        return this.git.bisectGood(good);
      });
    } catch (error) {
      await this.reportFailure("Failed to start bisect", error);
      return null;
    }
  }

  private async bisectLoop(): Promise<void> {
    try {
      while (true) {
        const current = await this.git.getLastCommit();
        this.ui.info(`Testing: ${current.hash} — ${current.message}`);
        const verdict = await this.askVerdict();
        if (verdict === "stop") {
          await this.reset();
          this.ui.info("Bisect cancelled.");
          return;
        }
        const result = await this.mark(verdict);
        if (result.done && result.badCommit) {
          await this.finish(result.badCommit);
          return;
        }
      }
    } catch (error) {
      if (error instanceof GoBackSignal) {
        this.ui.info("Bisect is still active. Open Bisect again to resume or stop.");
        return;
      }
      await this.reportFailure("Bisect failed", error);
    }
  }

  private askVerdict(): Promise<Verdict> {
    return this.ui.askSelect<Verdict>("Does this commit have the bug?", [
      { value: "bad", label: "✗  Yes — this commit is BAD" },
      { value: "good", label: "✓  No — this commit is GOOD" },
      { value: "skip", label: "Skip this commit" },
      { value: "stop", label: "⏹  Stop bisecting" },
    ]);
  }

  private mark(verdict: Exclude<Verdict, "stop">): Promise<BisectResult> {
    const actions = {
      bad: () => this.git.bisectBad(),
      good: () => this.git.bisectGood(),
      skip: () => this.git.bisectSkip(),
    };
    return this.ui.spin("Marking commit...", actions[verdict]);
  }

  private async finish(commit: CommitSummary): Promise<void> {
    const subject = commit.message ? ` — ${commit.message}` : "";
    this.ui.success(`First bad commit found: ${commit.hash.slice(0, 12)}${subject}`);
    try {
      await explainDiff(
        this.ui,
        () => this.git.getCommitDiff(commit.hash),
        "the first bad commit diff for explanation",
        this.aiExplainer,
      );
    } finally {
      await this.reset();
    }
  }

  private reset(): Promise<void> {
    return this.ui.spin("Resetting bisect...", () => this.git.bisectReset());
  }

  private async reportFailure(label: string, error: unknown): Promise<void> {
    this.ui.error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    await this.git.bisectReset().catch(() => {
      this.ui.warn("Could not reset bisect. Open Repository Status or run git bisect reset.");
    });
  }
}
