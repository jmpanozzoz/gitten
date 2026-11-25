import { GoBackSignal } from "./domain/navigation";
import { sameResetSource, sameResetTarget } from "./domain/reset-target";
import type { IGitClient, TrackingBranch } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

export class BranchSwitcher {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
  ) {}

  async run(): Promise<void> {
    const [{ all, current }, tracking] = await Promise.all([
      this.git.getBranches(),
      this.git.getTrackingBranches(),
    ]);
    const local = all.filter((branch) => branch !== current);
    if (local.length === 0 && tracking.length === 0) {
      this.ui.info("No other local or remote-tracking branches found.");
      return;
    }
    const options = await this.options(local, tracking);
    const choice = await this.ui.askSearchSelect("Switch to branch:", options);
    const remote = tracking.find((branch) => remoteKey(branch) === choice);
    const target = remote ? await this.localName(remote, all) : choice;
    if (!target || !(await this.prepareWorkingTree())) return;

    if (remote) {
      await this.ui.spin(`Tracking ${remote.remote}/${remote.name} as ${target}...`, () =>
        this.git.checkoutTrackingBranch(remote, target),
      );
      this.ui.success(`Switched to ${target}, tracking ${remote.remote}/${remote.name}.`);
      return;
    }
    await this.ui.spin(`Switching to ${target}...`, () => this.git.checkoutBranch(target));
    this.ui.success(`Switched to ${target}.`);
    await this.checkBehind(target);
  }

  private async localName(branch: TrackingBranch, existing: string[]): Promise<string> {
    const preferred = existing.includes(branch.name)
      ? `${branch.remote}/${branch.name}`
      : branch.name;
    const name = (
      await this.ui.askText("Create local tracking branch:", undefined, preferred)
    ).trim();
    if (!name || existing.includes(name)) {
      this.ui.warn("Choose a new local branch name.");
      return "";
    }
    return name;
  }

  private async options(local: string[], tracking: TrackingBranch[]) {
    const branches = await this.ui.spin("Loading local branches...", () =>
      Promise.all(
        local.map(async (value) => ({
          value,
          label: `${value}  (${await this.git.getBranchLastActivity(value)})`,
        })),
      ),
    );
    return [
      ...branches,
      ...tracking.map((branch) => ({
        value: remoteKey(branch),
        label: `${branch.remote}/${branch.name}  (remote-tracking)`,
      })),
    ];
  }

  private async prepareWorkingTree(): Promise<boolean> {
    const status = await this.git.getStatus();
    if (status.isClean()) return true;
    const stash = await this.ui.askConfirm(
      `${status.files.length} uncommitted change(s). Stash them and switch?`,
    );
    if (!stash) return false;
    await this.ui.spin("Stashing changes...", () => this.git.stash());
    this.ui.info("Changes stashed. Use the Stash menu to apply them later.");
    return true;
  }

  private async checkBehind(branch: string): Promise<void> {
    try {
      const upstream = await this.git.getRemoteResetTarget();
      if (!upstream || upstream.branch !== branch) return;
      await this.git.fetchRemote(upstream.remote);
      const refreshed = await this.git.getRemoteResetTarget();
      if (!refreshed || !sameResetSource(upstream, refreshed)) {
        this.ui.info(
          "Branch or upstream changed during fetch. Use Pull to review the current state.",
        );
        return;
      }
      const { commitsBehind } = await this.git.getStatus();
      if (commitsBehind === 0) return;
      const pullNow = await this.ui.askConfirm(
        `Branch '${branch}' is ${commitsBehind} commit(s) behind its upstream. Pull now?`,
      );
      if (pullNow) {
        if (!sameResetTarget(refreshed, await this.git.getRemoteResetTarget())) {
          this.ui.info(
            "Branch or upstream changed after confirmation. Use Pull to review the current state.",
          );
          return;
        }
        await this.ui.spin("Pulling...", () => this.git.pull());
        this.ui.success("Up to date.");
      }
    } catch (error) {
      if (error instanceof GoBackSignal) throw error;
      this.ui.info("Branch switched. Use Pull to refresh its upstream.");
    }
  }
}

function remoteKey(branch: TrackingBranch): string {
  return `\0${branch.ref}`;
}
