import { GoBackSignal } from "./domain/navigation";
import { redactRemoteCredentials } from "./domain/remote-display";
import type { IGitClient, TrackingBranch } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { PROTECTED_BRANCHES } from "./protected-branches";

type BranchDeletion = Pick<TrackingBranch, "name"> & { target?: TrackingBranch };

export class BranchCleaner {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
  ) {}

  async run(): Promise<void> {
    const selected = await this.selectBranches();
    if (selected.length === 0 || !(await this.confirmProtected(selected))) return;
    let deleted = 0;
    try {
      for (const branch of selected) {
        const removed = branch.target
          ? await this.deleteRemote(branch.target)
          : await this.deleteLocal(branch.name);
        if (removed) deleted++;
      }
    } catch (error) {
      if (deleted > 0)
        this.ui.warn(`Deleted ${deleted} of ${selected.length} selected branch(es).`);
      throw error;
    }
    if (deleted === 0) this.ui.info("No branches were deleted.");
    else if (deleted === selected.length)
      this.ui.success(`Deleted all ${deleted} selected branch(es).`);
    else this.ui.warn(`Deleted ${deleted} of ${selected.length} selected branch(es).`);
  }

  private async selectBranches(): Promise<BranchDeletion[]> {
    const [{ all, current }, tracking] = await Promise.all([
      this.git.getBranches(),
      this.git.getTrackingBranches(),
    ]);
    const local = all.filter((name) => name !== current);
    if (local.length === 0 && tracking.length === 0) {
      this.ui.info("No branches available to delete.");
      return [];
    }
    const options = await this.ui.spin("Loading branch info...", async () => [
      ...(await Promise.all(
        local.map(async (name) => ({
          value: { name } satisfies BranchDeletion,
          label: `${name} · local · ${await this.git.getBranchLastActivity(name)}`,
        })),
      )),
      ...tracking.map((target) => ({
        value: { name: target.name, target },
        label: `${target.remote}/${target.name} · remote · ${target.head.slice(0, 12)}`,
      })),
    ]);
    return this.ui.askSearchMultiSelect<BranchDeletion>("Select branches to delete:", options);
  }

  private async confirmProtected(selected: BranchDeletion[]): Promise<boolean> {
    const names = selected
      .filter(({ name }) => PROTECTED_BRANCHES.has(name))
      .map(({ name, target }) => (target ? `${target.remote}/${name}` : name));
    if (names.length === 0) return true;
    return this.ui.askConfirm(`Delete protected branch(es) ${names.join(", ")}?`, false);
  }

  private async deleteLocal(branch: string): Promise<boolean> {
    try {
      await this.ui.spin(`Removing local "${branch}"...`, () => this.git.deleteLocalBranch(branch));
      return true;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("not fully merged")) {
        this.ui.warn(`Could not delete local branch "${branch}".`);
        return false;
      }
      return this.forceUnmerged(branch);
    }
  }

  private async forceUnmerged(branch: string): Promise<boolean> {
    const head = await this.localHead(branch);
    if (!head) {
      this.ui.warn(`Could not verify local branch "${branch}".`);
      return false;
    }
    if (
      !(await this.ui.askConfirm(
        `"${branch}" at ${head.slice(0, 12)} has unmerged commits. Force deletion?`,
        false,
      ))
    )
      return false;
    if ((await this.localHead(branch)) !== head) {
      this.ui.warn(`Local branch "${branch}" changed. Review it again before deleting.`);
      return false;
    }
    try {
      await this.ui.spin(`Removing unmerged branch "${branch}"...`, () =>
        this.git.deleteLocalBranchForce(branch),
      );
      return true;
    } catch {
      this.ui.warn(`Could not force-delete local branch "${branch}".`);
      return false;
    }
  }

  private async localHead(branch: string): Promise<string | undefined> {
    const log = await this.git.getLog(`refs/heads/${branch}`, 1).catch(() => []);
    return log[0]?.hash;
  }

  private async deleteRemote(target: TrackingBranch): Promise<boolean> {
    const label = `${target.remote}/${target.name}`;
    try {
      const plan = await this.git.previewRemoteBranchDeletion(target);
      const name = plan.destination.slice("refs/heads/".length);
      if (name !== target.name && PROTECTED_BRANCHES.has(name)) {
        if (
          !(await this.ui.askConfirm(
            `Delete protected remote branch ${target.remote}/${name}?`,
            false,
          ))
        )
          return false;
      }
      const details = plan.urls.map(redactRemoteCredentials).join("\n");
      this.ui.info(
        `${target.remote}:${plan.destination} at ${target.head.slice(0, 12)}\n${details}`,
      );
      if (!(await this.ui.askConfirm(`Delete ${plan.destination} from ${target.remote}?`, false)))
        return false;
      await this.ui.spin(`Removing ${label}...`, () => this.git.deleteRemoteBranch(plan));
      return true;
    } catch (error) {
      if (error instanceof GoBackSignal) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      this.ui.warn(
        `Deletion for ${label} could not be confirmed. Check the remote before retrying.\n${detail}`,
      );
      return false;
    }
  }
}
