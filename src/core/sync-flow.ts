import { confirmAISend } from "./ai-consent";
import { showDiffPages } from "./diff-pages";
import { GoBackSignal } from "./domain/navigation";
import { sameResetSource } from "./domain/reset-target";
import type { AICommitReviewer, AICommitSuggester } from "./ports/ai.port";
import type { IGitClient, StatusSummary } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { PROTECTED_BRANCHES } from "./protected-branches";
import { PushBranch } from "./push-branch";

const DEFAULT_COMMIT_MESSAGE = "chore: update";
type UpstreamCheck = "missing" | "unverified" | "verified";

export class SyncFlow {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly aiSuggester?: AICommitSuggester,
    private readonly aiReviewer?: AICommitReviewer,
  ) {}

  async run(): Promise<void> {
    const pending = await this.git.getInProgressOperation();
    if (pending) {
      this.ui.warn(`Finish the pending ${pending} before using Sync.`);
      return;
    }

    const upstream = await this.refreshUpstream();
    const status = await this.git.getStatus();
    const push = new PushBranch(this.git, this.ui);

    if (status.isClean()) {
      if (this.shouldOfferPush(status, upstream)) await push.run({ setUpstream: true });
      return;
    }

    const branch = await this.git.getCurrentBranch();
    if (
      PROTECTED_BRANCHES.has(branch) &&
      !(await this.ui.askConfirm(`Commit directly to protected branch '${branch}'?`, false))
    )
      return;

    const commit = await this.commitChanges(status);
    if (commit) await push.run({ expectedHead: commit, setUpstream: true });
  }

  private async refreshUpstream(): Promise<UpstreamCheck> {
    try {
      const upstream = await this.git.getRemoteResetTarget();
      if (!upstream) return "missing";
      await this.git.fetchRemote(upstream.remote);
      const refreshed = await this.git.getRemoteResetTarget();
      if (refreshed && sameResetSource(upstream, refreshed)) return "verified";
      this.ui.warn("The branch or upstream changed during fetch. Commit counts may be stale.");
    } catch {
      this.ui.warn("Could not refresh the upstream. Commit counts may be stale.");
    }
    return "unverified";
  }

  private shouldOfferPush(status: StatusSummary, upstream: UpstreamCheck): boolean {
    if (upstream !== "verified" || status.commitsAhead > 0) return true;
    if (status.commitsBehind > 0) {
      this.ui.info(`Behind upstream by ${status.commitsBehind} commit(s). Use Pull to update.`);
    } else {
      this.ui.info("Already up to date — nothing to commit or push.");
    }
    return false;
  }

  private async commitChanges(status: StatusSummary): Promise<string | undefined> {
    if (status.commitsBehind > 0) {
      const pullFirst = await this.ui.askConfirm(
        `⚠️  Remote has ${status.commitsBehind} new commit(s). Pull first to avoid a rejected push?`,
      );
      if (pullFirst) {
        this.ui.info("Go to Pull from the main menu, then come back to Sync.");
        return;
      }
    }
    const paths = await this.selectFiles(status.files);
    if (paths.length > 0) return this.previewAndCommit(paths);
  }

  private async selectFiles(files: StatusSummary["files"]): Promise<string[]> {
    const selected = new Set(
      await this.ui.askMultiSelect(
        "Select files to commit:",
        files.map(({ path, status, previousPath }) => ({
          value: path,
          label: `${status}  ${previousPath ? `${previousPath} → ` : ""}${path}`,
        })),
      ),
    );
    const paths = files
      .filter(({ path }) => selected.has(path))
      .flatMap(({ path, previousPath }) => (previousPath ? [previousPath, path] : [path]));
    return [...new Set(paths)];
  }

  private async previewAndCommit(paths: string[]): Promise<string | undefined> {
    const selection = await this.ui.spin("Preparing commit preview...", () =>
      this.git.previewSelectedCommit(paths),
    );
    const { diff, stat } = selection;
    if (!diff) {
      this.ui.info("The selected files have no changes to commit.");
      return;
    }
    this.ui.info(`+${stat.insertions} −${stat.deletions} lines selected`);
    await showDiffPages(this.ui, diff);
    await this.runAiReview(diff);

    const placeholder = await this.resolveCommitPlaceholder(diff);
    const message = await this.ui.askText("Commit message:", undefined, placeholder);
    const finalMessage = message.trim() || DEFAULT_COMMIT_MESSAGE;

    try {
      return await this.ui.spin("Committing selection...", () =>
        this.git.commitSelection(selection, finalMessage),
      );
    } catch (error) {
      this.ui.error(error instanceof Error ? error.message : "Could not commit the selection.");
      return;
    }
  }

  private async runAiReview(diff: string): Promise<void> {
    if (!this.aiReviewer) return;

    const proceed = await confirmAISend(this.ui, "the selected diff for review", this.aiReviewer);
    if (!proceed) return;

    let findings: string[] = [];

    try {
      findings = await this.ui.spin("Reviewing...", () => this.aiReviewer!(diff));
    } catch (err) {
      if (err instanceof GoBackSignal) throw err;
      this.ui.warn(`AI review failed: ${err instanceof Error ? err.message : "unknown error"}`);
      return;
    }

    if (findings.length === 0) {
      this.ui.success("No issues found — looking good!");
      return;
    }

    for (const finding of findings) {
      this.ui.warn(`⚠ ${finding}`);
    }
  }

  private async resolveCommitPlaceholder(diff: string): Promise<string> {
    if (!this.aiSuggester) return DEFAULT_COMMIT_MESSAGE;

    const suggest = await confirmAISend(
      this.ui,
      "the selected diff to suggest a commit message",
      this.aiSuggester,
    );
    if (!suggest) return DEFAULT_COMMIT_MESSAGE;

    let suggestion: string | null = null;
    try {
      suggestion = await this.ui.spin("Generating suggestion...", () => this.aiSuggester!(diff));
    } catch (err) {
      if (err instanceof GoBackSignal) throw err;
      const msg = err instanceof Error ? err.message : "unknown error";
      this.ui.warn(`AI failed: ${msg}`);
      return DEFAULT_COMMIT_MESSAGE;
    }

    if (!suggestion) {
      this.ui.warn("AI returned an empty response — type your message.");
      return DEFAULT_COMMIT_MESSAGE;
    }

    return suggestion;
  }
}
