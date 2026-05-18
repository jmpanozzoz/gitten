import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { renderDiff } from "../ui/diff-renderer";
import { PROTECTED_BRANCHES } from "./protected-branches";

const DEFAULT_COMMIT_MESSAGE = "chore: update";
const NO_UPSTREAM_ERROR = "no upstream";
const PROTECTED_BRANCHES = new Set(["main", "master"]);

export type AISuggester = (diff: string) => Promise<string | null>;
export type AiReviewer = (diff: string) => Promise<string[]>;

export class SyncFlow {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly aiSuggester?: AISuggester,
    private readonly aiReviewer?: AiReviewer
  ) {}

  async run(): Promise<void> {
    const branch = await this.git.getCurrentBranch();

    if (PROTECTED_BRANCHES.has(branch)) {
      const proceed = await this.ui.askConfirm(
        `⚠️  You are on '${branch}'. Commit directly to this branch?`
      );
      if (!proceed) return;
    }

    // Fetch silently so behind count is accurate before we start staging
    try {
      await this.git.fetchRemote();
    } catch {
      // No remote or network issue — continue without blocking
    }

    const status = await this.git.getStatus();

    if (status.isClean()) {
      if (status.commitsAhead === 0) {
        this.ui.info("Already up to date — nothing to commit or push.");
        return;
      }
      const proceed = await this.ui.askConfirm("Nothing to commit. Push current branch?");
      if (!proceed) return;
    } else {
      if (status.commitsBehind > 0) {
        const pullFirst = await this.ui.askConfirm(
          `⚠️  Remote has ${status.commitsBehind} new commit(s). Pull first to avoid a rejected push?`
        );
        if (pullFirst) {
          this.ui.info("Go to Pull from the main menu, then come back to Sync.");
          return;
        }
      }

      const staged = await this.selectFiles(status.files);
      if (staged.length === 0) return;
      const shouldPush = await this.stageAndCommit(staged);
      if (!shouldPush) return;
    }

    await this.safePush();
  }

  private async selectFiles(
    files: { path: string; status: string }[]
  ): Promise<string[]> {
    return this.ui.askMultiSelect(
      "Select files to stage:",
      files.map((f) => ({ value: f.path, label: `${f.status}  ${f.path}` }))
    );
  }

  private async stageAndCommit(paths: string[]): Promise<boolean> {
    await this.ui.spin("Staging...", () => this.git.addFiles(paths));

    const stat = await this.git.getDiffStat();
    this.ui.info(`+${stat.insertions} −${stat.deletions} lines staged`);

    await this.showDiffPreview();
    await this.runAiReview();

    const placeholder = await this.resolveCommitPlaceholder();
    const message = await this.ui.askText("Commit message:", undefined, placeholder);
    const finalMessage = message.trim() || DEFAULT_COMMIT_MESSAGE;

    await this.ui.spin("Committing...", () => this.git.commit(finalMessage));

    return this.ui.askConfirm("Push now?");
  }

  private async showDiffPreview(): Promise<void> {
    const diff = await this.git.getStagedDiff();
    if (!diff) return;
    this.ui.info(renderDiff(diff, 30));
  }

  private async runAiReview(): Promise<void> {
    if (!this.aiReviewer) return;

    const proceed = await this.ui.askConfirm("✨ Review staged diff with AI before committing?");
    if (!proceed) return;

    const diff = await this.git.getStagedDiff();
    let findings: string[] = [];

    try {
      findings = await this.ui.spin("Reviewing...", () => this.aiReviewer!(diff));
    } catch (err) {
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

  private async resolveCommitPlaceholder(): Promise<string> {
    if (!this.aiSuggester) return DEFAULT_COMMIT_MESSAGE;

    const suggest = await this.ui.askConfirm("✨ Generate commit message with AI?");
    if (!suggest) return DEFAULT_COMMIT_MESSAGE;

    const diff = await this.git.getStagedDiff();

    let suggestion: string | null = null;
    try {
      suggestion = await this.ui.spin("Generating suggestion...", () => this.aiSuggester!(diff));
    } catch (err) {
      if (err instanceof Error && err.message === "go-back") throw err;
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

  private async safePush(): Promise<void> {
    try {
      await this.ui.spin("Pushing...", () => this.git.push(false));
      this.ui.success("Branch pushed successfully.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";

      if (message.includes(NO_UPSTREAM_ERROR) || message.includes("has no upstream")) {
        await this.ui.spin("No upstream found — pushing with -u origin...", () =>
          this.git.push(true)
        );
        this.ui.success("Branch pushed and upstream set.");
        return;
      }

      if (message.includes("rejected") || message.includes("fetch first")) {
        this.ui.error("Push rejected — the remote has new commits. Run a pull first.");
        return;
      }

      const raw = err instanceof Error ? err.message : String(err);
      this.ui.error(`Push failed: ${raw}`);
      this.ui.info("Your commit is saved locally. Push manually with: git push");
    }
  }
}
