import { confirmAISend } from "./ai-consent";
import { showDiffPages } from "./diff-pages";
import type { AIMessageImprover } from "./ports/ai.port";
import type { AmendPort, CommitSummary } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { PROTECTED_BRANCHES } from "./protected-branches";

type AmendOption = "message" | "staged" | "both";

interface AmendPreview {
  branch: string;
  last: CommitSummary;
  staged?: string;
}

export class AmendFlow {
  constructor(
    private readonly git: AmendPort,
    private readonly ui: IUI,
    private readonly aiSuggester?: AIMessageImprover,
  ) {}

  async run(): Promise<void> {
    const pending = await this.git.getInProgressOperation();
    if (pending) {
      this.ui.warn(`Finish the pending ${pending} before amending.`);
      return;
    }
    const branch = await this.git.getCurrentBranch();
    if (PROTECTED_BRANCHES.has(branch)) {
      const proceed = await this.ui.askConfirm(
        `⚠️  You are on '${branch}'. Amend a commit on this branch?`,
      );
      if (!proceed) return;
    }

    let last: CommitSummary;
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

    const preview: AmendPreview = { branch, last };
    if (choice !== "message") {
      const staged = await this.git.getStagedDiff();
      if (!staged) {
        this.ui.warn("Nothing staged — stage your changes before amending.");
        return;
      }
      preview.staged = staged;
      await showDiffPages(this.ui, staged);
      if (!(await this.ui.askConfirm("Amend with the displayed staged changes?", false))) return;
    }
    if (choice === "staged") {
      if (await this.apply(preview, () => this.git.amendNoEdit())) {
        this.ui.success("Commit amended with staged files.");
      }
      return;
    }
    await this.amendMessage(preview);
  }

  private async amendMessage(preview: AmendPreview): Promise<void> {
    const { last, staged } = preview;
    const current = last.message;
    const placeholder = await this.suggestSubject(current);
    const input = await this.ui.askText("Commit subject:", undefined, placeholder);
    const subject = input.trim() || current;
    const message = last.body ? `${subject}\n\n${last.body}` : subject;
    if (!(await this.apply(preview, () => this.git.amendCommit(message, staged === undefined))))
      return;
    this.ui.success(
      staged === undefined
        ? `Commit amended: "${subject}"`
        : `Commit amended with new message and staged files: "${subject}"`,
    );
  }

  private async apply(preview: AmendPreview, write: () => Promise<void>): Promise<boolean> {
    const pending = await this.git.getInProgressOperation();
    const branch = await this.git.getCurrentBranch();
    const tip = await this.git.getLastCommit().catch(() => null);
    if (pending || branch !== preview.branch || tip?.hash !== preview.last.hash) {
      this.ui.warn("The branch or Git operation changed. Review the amend again.");
      return false;
    }
    if (preview.staged !== undefined && (await this.git.getStagedDiff()) !== preview.staged) {
      this.ui.warn("Staged changes differ from the preview. Review the amend again.");
      return false;
    }
    await this.ui.spin("Amending commit...", write);
    return true;
  }

  private async suggestSubject(current: string): Promise<string> {
    const suggest = this.aiSuggester;
    if (!suggest || !(await confirmAISend(this.ui, "the commit subject for rewriting", suggest))) {
      return current;
    }
    try {
      const suggestion = await this.ui.spin("Improving...", () => suggest(current));
      if (!suggestion) return current;
      this.ui.info(`Suggested: ${suggestion}`);
      return suggestion;
    } catch (err) {
      this.ui.warn(`AI failed: ${err instanceof Error ? err.message : "unknown error"}`);
      return current;
    }
  }
}
