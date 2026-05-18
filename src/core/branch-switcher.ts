import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

export class BranchSwitcher {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
    const { all, current } = await this.git.getBranches();
    const candidates = all.filter((b) => b !== current);

    if (candidates.length === 0) {
      this.ui.info("No other local branches found.");
      return;
    }

    const labelled = await this.ui.spin("Loading branches...", () =>
      Promise.all(
        candidates.map(async (b) => ({
          value: b,
          label: `${b}  (${await this.git.getBranchLastActivity(b)})`,
        }))
      )
    );

    const target = await this.ui.askSearchSelect("Switch to branch:", labelled);

    const status = await this.git.getStatus();
    if (!status.isClean()) {
      const stashAndSwitch = await this.ui.askConfirm(
        `${status.files.length} uncommitted change(s). Stash them and switch?`
      );
      if (!stashAndSwitch) return;

      await this.ui.spin("Stashing changes...", () => this.git.stash());
      this.ui.info("Changes stashed. Use the Stash menu to apply them later.");
    }

    await this.ui.spin(`Switching to ${target}...`, () => this.git.checkoutBranch(target));
    this.ui.success(`Switched to ${target}.`);

    try {
      await this.git.fetchRemote();
      const freshStatus = await this.git.getStatus();
      if (freshStatus.commitsBehind > 0) {
        const pullNow = await this.ui.askConfirm(
          `⚠️  Branch '${target}' is ${freshStatus.commitsBehind} commit(s) behind origin. Pull now?`
        );
        if (pullNow) {
          await this.ui.spin("Pulling...", () => this.git.pull());
          this.ui.success("Up to date.");
        }
      }
    } catch {
      // Fetch failed (no remote or network) — silently continue
    }
  }
}
