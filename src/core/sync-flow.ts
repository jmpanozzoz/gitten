import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

const DEFAULT_COMMIT_MESSAGE = "chore: update";
const NO_UPSTREAM_ERROR = "no upstream";

export class SyncFlow {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
    const status = await this.git.getStatus();

    if (status.isClean()) {
      const proceed = await this.ui.askConfirm("Nothing to commit. Push current branch?");
      if (!proceed) return;
    } else {
      const fileCount = status.files.length;
      const proceed = await this.ui.askConfirm(
        `${fileCount} file(s) modified. Stage, commit and push?`
      );
      if (!proceed) return;
      await this.stageAndCommit();
    }

    await this.safePush();
  }

  private async stageAndCommit(): Promise<void> {
    await this.ui.spin("Staging...", () => this.git.addAll());

    const stat = await this.git.getDiffStat();
    this.ui.info(`+${stat.insertions} −${stat.deletions} lines staged`);

    const message = await this.ui.askText("Commit message:", DEFAULT_COMMIT_MESSAGE);
    const finalMessage = message.trim() || DEFAULT_COMMIT_MESSAGE;

    await this.ui.spin("Committing...", () => this.git.commit(finalMessage));
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
        this.ui.error(
          "Push rejected — the remote has new commits. Run a pull first."
        );
        return;
      }

      throw err;
    }
  }
}
