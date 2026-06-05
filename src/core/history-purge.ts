import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

const FILTER_REPO_INSTALL = `git filter-repo is not installed. Install it with:
  pip install git-filter-repo
  # or: brew install git-filter-repo`;

export class HistoryPurge {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
  ) {}

  async run(): Promise<void> {
    const available = await this.git.filterRepoAvailable();
    if (!available) {
      this.ui.error(FILTER_REPO_INSTALL);
      return;
    }

    const status = await this.git.getStatus();
    if (!status.isClean()) {
      this.ui.error(
        "Working tree has uncommitted changes. Commit or stash them before purging history.",
      );
      return;
    }

    const tracked = await this.git.getTrackedFiles();
    if (tracked.length === 0) {
      this.ui.info("No tracked files found.");
      return;
    }

    const selected = await this.ui.askSearchMultiSelect(
      "Select files to remove from ALL history:",
      tracked.map((f) => ({ value: f, label: f })),
    );

    if (selected.length === 0) return;

    this.ui.warn(
      `About to permanently erase from history:\n${selected.map((f) => `  ${f}`).join("\n")}\n\nThis rewrites every commit. All existing clones will diverge.`,
    );

    const first = await this.ui.askConfirm("Are you sure you want to rewrite history?");
    if (!first) return;

    const second = await this.ui.askConfirm(
      "Final check — this CANNOT be undone without a backup. Proceed?",
    );
    if (!second) return;

    await this.ui.spin(`Purging ${selected.length} file(s) from history...`, () =>
      this.git.purgeFromHistory(selected),
    );

    this.ui.success(`${selected.length} file(s) removed from entire Git history.`);
    this.ui.warn(
      "Run: git push --force origin <branch>  to update the remote.\nAll collaborators must re-clone or run: git pull --rebase",
    );
  }
}
