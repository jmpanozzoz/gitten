import { showDiffPages } from "./diff-pages";
import type { RepositoryStatus, StashEntry } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import type { StashPort } from "./ports/workflow-git.port";

type StashAction = "apply" | "drop" | "push";
type ApplyMode = "pop" | "apply";

export class StashManager {
  constructor(
    private readonly git: StashPort,
    private readonly ui: IUI,
  ) {}

  async run(): Promise<void> {
    const action = await this.ui.askSelect<StashAction>("Manage stashes:", [
      { value: "apply", label: "Apply a stash" },
      { value: "drop", label: "Drop stashes" },
      { value: "push", label: "Stash current changes" },
    ]);
    if (action === "push") return this.pushStash();
    const stashes = await this.git.getStashes();
    if (stashes.length === 0) {
      this.ui.info("No stashes found.");
      return;
    }
    if (action === "apply") return this.applyStash(stashes);
    return this.dropStashes(stashes);
  }

  private async applyStash(stashes: StashEntry[]): Promise<void> {
    const stashed = await this.ui.askSearchSelect("Select stash to apply:", stashOptions(stashes));
    const { oid, index } = stashed;
    const stat = await this.git.getStashStat(oid);
    this.ui.info(`${stat.filesChanged} file(s) changed — +${stat.insertions} −${stat.deletions}`);
    if (await this.ui.askConfirm("Preview stash contents before applying?")) {
      const diff = await this.git.getStashDiff(oid);
      if (diff) await showDiffPages(this.ui, diff);
      else this.ui.info("No diff available for this stash.");
    }

    const mode = await this.ui.askSelect<ApplyMode>("How to apply?", [
      { value: "apply", label: "Apply — keep in stash list" },
      { value: "pop", label: "Pop — apply and remove from stash list" },
    ]);
    const selection = { oid, index };
    try {
      await this.ui.spin("Applying stash...", () =>
        mode === "pop" ? this.git.stashPop(selection) : this.git.stashApply(selection),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.ui.warn(
        `Stash ${oid.slice(0, 12)} did not apply cleanly. Check the working tree and stash list.\n${detail}`,
      );
      return;
    }
    this.ui.success(`Stash ${oid.slice(0, 12)} applied.`);
  }

  private async dropStashes(stashes: StashEntry[]): Promise<void> {
    const selected = await this.ui.askSearchMultiSelect(
      "Select stashes to drop:",
      stashOptions(stashes),
    );
    if (selected.length === 0) return;
    if (
      !(await this.ui.askConfirm(
        `Drop ${selected.length} stash(es)? This cannot be undone.`,
        false,
      ))
    )
      return;

    let dropped = 0;
    for (const { oid, index } of [...selected].sort((a, b) => b.index - a.index)) {
      try {
        await this.git.stashDrop({ oid, index });
        dropped++;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.ui.warn(
          `Dropped ${dropped} of ${selected.length} selected stash(es). Stopped at ${oid.slice(0, 12)}.\n${detail}`,
        );
        return;
      }
    }
    this.ui.success(`${dropped} stash(es) dropped.`);
  }

  private async pushStash(): Promise<void> {
    const status = await this.git.describeStatus();
    const { staged, unstaged, untracked } = status;
    const tracked = new Set([...staged.map(({ path }) => path), ...unstaged]).size;
    if (tracked === 0 && untracked.length === 0) {
      this.ui.info("Nothing to stash — working tree is clean.");
      return;
    }
    const include =
      untracked.length > 0 &&
      (await this.ui.askConfirm(`Include ${untracked.length} untracked file(s)?`, false));
    if (tracked === 0 && !include) {
      this.ui.info("The untracked files were left in the working tree.");
      return;
    }
    const message = await this.ui.askText("Stash message (optional):", "WIP: in progress");
    const current = await this.git.describeStatus();
    if (
      (await this.git.getInProgressOperation()) ||
      stashPaths(current, include) !== stashPaths(status, include)
    ) {
      this.ui.warn("The working tree or Git operation changed. Review the files before stashing.");
      return;
    }
    await this.ui.spin("Stashing...", () => this.git.stashWithMessage(message, include));
    this.ui.success(
      `Stashed ${tracked} tracked and ${include ? untracked.length : 0} untracked file(s).`,
    );
  }
}

function stashPaths(status: RepositoryStatus, includeUntracked: boolean): string {
  const staged = status.staged
    .map(({ path, previousPath }) => JSON.stringify([path, previousPath]))
    .sort();
  const unstaged = [...status.unstaged].sort();
  const untracked = includeUntracked ? [...status.untracked].sort() : [];
  return JSON.stringify([staged, unstaged, untracked]);
}

function stashOptions(stashes: StashEntry[]) {
  return stashes.map((value) => ({
    value,
    label: `stash@{${value.index}} · ${value.oid.slice(0, 12)} · ${value.message} (${value.date})`,
  }));
}
