import { confirmAISend } from "./ai-consent";
import { type RemoteResetTarget, sameResetSource, sameResetTarget } from "./domain/reset-target";
import type { AICommitSummarizer } from "./ports/ai.port";
import type { ResetPort } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type ResetAction = "discard" | "remote";

export class ResetManager {
  constructor(
    private readonly git: ResetPort,
    private readonly ui: IUI,
    private readonly aiSummarizer?: AICommitSummarizer,
  ) {}

  async run(): Promise<void> {
    const action = await this.ui.askSelect<ResetAction>("Reset options:", [
      { value: "discard", label: "🗑️  Discard local changes" },
      { value: "remote", label: "⚡ Reset to remote" },
    ]);

    const pending = await this.git.getInProgressOperation();
    if (pending) {
      this.ui.warn(`Finish the pending ${pending} before resetting.`);
      return;
    }

    if (action === "discard") return this.discardChanges();
    return this.resetToRemote();
  }

  private async discardChanges(): Promise<void> {
    const status = await this.git.getStatus();
    if (status.isClean()) {
      this.ui.info("Working tree is already clean.");
      return;
    }

    const confirmed = await this.ui.askConfirm(
      "This will permanently discard all uncommitted changes and untracked files.",
      false,
    );
    if (!confirmed) return;
    if (await this.git.getInProgressOperation()) {
      this.ui.warn("A Git operation started. Local changes were kept.");
      return;
    }

    await this.ui.spin("Discarding local changes...", () => this.git.discardLocalChanges());
    this.ui.success("Working tree is clean.");
  }

  private async resetToRemote(): Promise<void> {
    let target: RemoteResetTarget | null;
    try {
      target = await this.refreshResetTarget();
      if (!target) return;
      await this.showCommitsAtRisk(target.commit);
    } catch {
      this.ui.error("The upstream or local commits could not be verified. No changes were made.");
      return;
    }

    const destination = target.ref.replace(/^refs\/remotes\//, "");
    const hashes = `${target.head.slice(0, 12)} → ${target.commit.slice(0, 12)}`;
    const confirmed = await this.ui.askConfirm(
      `Reset '${target.branch}' to ${destination} (${hashes}) and discard uncommitted tracked changes?`,
      false,
    );
    if (!confirmed) return;

    const current = await this.git.getRemoteResetTarget();
    if (!sameResetTarget(target, current) || (await this.git.getInProgressOperation())) {
      this.ui.error(
        "Git state changed after the preview. Open Reset again to review the new state.",
      );
      return;
    }

    try {
      const recovery = await this.ui.spin("Resetting...", () => this.git.resetToRemote(target));
      this.ui.success(`Branch reset to ${destination}.`);
      this.ui.info(`Previous tip saved at ${recovery}.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.ui.error(`Reset did not complete.\n${detail}`);
    }
  }

  private async refreshResetTarget(): Promise<RemoteResetTarget | null> {
    const before = await this.git.getRemoteResetTarget();
    if (!before) {
      this.ui.error("The current branch has no verified remote upstream.");
      return null;
    }
    await this.git.fetchRemote(before.remote);
    const after = await this.git.getRemoteResetTarget();
    if (!after || !sameResetSource(before, after)) {
      this.ui.error("The current branch or upstream changed while fetching.");
      return null;
    }
    return after;
  }

  private async showCommitsAtRisk(commit: string): Promise<void> {
    const commits = await this.git.getLogSince(commit);
    if (commits.length === 0) return;

    this.ui.warn(`${commits.length} local commit(s) absent from the upstream:`);
    for (const entry of commits) this.ui.warn(`  • ${entry.hash} — ${entry.message}`);

    const summarize = this.aiSummarizer;
    if (
      !summarize ||
      !(await confirmAISend(this.ui, "the commit messages for a reset summary", summarize))
    ) {
      return;
    }
    try {
      const summary = await this.ui.spin("Summarizing what will be lost...", () =>
        summarize(commits.map((entry) => entry.message)),
      );
      if (summary) this.ui.info(`✨ What will be lost:\n${summary}`);
    } catch {
      this.ui.warn("AI summary failed. Review the commits above.");
    }
  }
}
