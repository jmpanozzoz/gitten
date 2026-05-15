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

    const target = await this.ui.askSelect("Switch to branch:", labelled);

    const status = await this.git.getStatus();
    if (!status.isClean()) {
      const stashAndSwitch = await this.ui.askConfirm(
        `${status.files.length} uncommitted change(s). Stash them and switch?`
      );
      if (!stashAndSwitch) return;

      await this.ui.spin("Stashing changes...", () => this.git.stash());
      this.ui.info('Changes stashed. Run "git stash pop" to restore them later.');
    }

    await this.ui.spin(`Switching to ${target}...`, () => this.git.checkoutBranch(target));
    this.ui.success(`Switched to ${target}.`);
  }
}
