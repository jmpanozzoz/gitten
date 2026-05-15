import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

const PROTECTED_BRANCHES = new Set(["main", "master", "dev", "develop"]);

export class BranchCleaner {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
    const { all, current } = await this.git.getBranches();
    const candidates = all.filter(
      (b) => !PROTECTED_BRANCHES.has(b) && b !== current
    );

    if (candidates.length === 0) {
      this.ui.info("No branches available to delete.");
      return;
    }

    const labelled = await this.ui.spin("Loading branch info...", () =>
      Promise.all(
        candidates.map(async (b) => ({
          value: b,
          label: `${b}  (${await this.git.getBranchLastActivity(b)})`,
        }))
      )
    );

    const selected = await this.ui.askSearchMultiSelect("Select branches to delete:", labelled);

    if (selected.length === 0) return;

    const deleteRemote = await this.ui.askConfirm("Also delete from origin?");

    let localDeleted = 0;
    let remoteDeleted = 0;

    for (const branch of selected) {
      try {
        await this.git.deleteLocalBranch(branch);
        localDeleted++;
      } catch {
        this.ui.warn(`Could not delete local branch "${branch}" — skipping.`);
      }

      if (deleteRemote) {
        try {
          await this.git.deleteRemoteBranch(branch);
          remoteDeleted++;
        } catch {
          this.ui.warn(`Could not delete remote branch "${branch}" — skipping.`);
        }
      }
    }

    const remotePart = deleteRemote ? ` + ${remoteDeleted} remote` : "";
    this.ui.success(`${localDeleted} local${remotePart} branch(es) deleted.`);
  }

  filterCandidates(all: string[], current: string): string[] {
    return all.filter((b) => !PROTECTED_BRANCHES.has(b) && b !== current);
  }
}
