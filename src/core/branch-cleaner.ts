import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

const PROTECTED_BRANCHES = new Set(["main", "master", "dev", "develop"]);

export class BranchCleaner {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
    const { all: local, current } = await this.git.getBranches();
    const remote = await this.git.getRemoteBranches();

    const localSet = new Set(local);
    const localCandidates = local.filter(
      (b) => !PROTECTED_BRANCHES.has(b) && b !== current
    );
    const remoteOnlyCandidates = remote.filter(
      (b) => !PROTECTED_BRANCHES.has(b) && !localSet.has(b) && b !== current
    );

    if (localCandidates.length === 0 && remoteOnlyCandidates.length === 0) {
      this.ui.info("No branches available to delete.");
      return;
    }

    const labelled = await this.ui.spin("Loading branch info...", async () => {
      const localLabels = await Promise.all(
        localCandidates.map(async (b) => ({
          value: b,
          label: `${b}  (${await this.git.getBranchLastActivity(b)})`,
        }))
      );
      const remoteLabels = remoteOnlyCandidates.map((b) => ({
        value: `remote:${b}`,
        label: `${b}  [remote only]`,
      }));
      return [...localLabels, ...remoteLabels];
    });

    const selected = await this.ui.askSearchMultiSelect("Select branches to delete:", labelled);
    if (selected.length === 0) return;

    const hasLocalSelected = selected.some((s) => !s.startsWith("remote:"));
    const deleteRemote = hasLocalSelected
      ? await this.ui.askConfirm("Also delete from origin?")
      : true;

    let localDeleted = 0;
    let remoteDeleted = 0;

    for (const branch of selected) {
      try {
        await this.git.deleteLocalBranchForce(branch);
        localDeleted++;
      } catch {
        this.ui.warn(`Could not delete local branch "${branch}" — skipping.`);
      }

      if (isRemoteOnly || deleteRemote) {
        try {
          await this.git.deleteRemoteBranch(branch);
          remoteDeleted++;
        } catch {
          this.ui.warn(`Could not delete remote branch "${branch}" — skipping.`);
        }
      }
    }

    const parts: string[] = [];
    if (localDeleted > 0) parts.push(`${localDeleted} local`);
    if (remoteDeleted > 0) parts.push(`${remoteDeleted} remote`);
    this.ui.success(`${parts.join(" + ")} branch(es) deleted.`);
  }

  filterCandidates(all: string[], current: string): string[] {
    return all.filter((b) => !PROTECTED_BRANCHES.has(b) && b !== current);
  }
}
