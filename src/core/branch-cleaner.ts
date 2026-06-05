import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { PROTECTED_BRANCHES } from "./protected-branches";

export class BranchCleaner {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
  ) {}

  async run(): Promise<void> {
    const { all: local, current } = await this.git.getBranches();
    const remote = await this.git.getRemoteBranches();

    const localSet = new Set(local);
    const localCandidates = local.filter((b) => b !== current);
    const remoteOnlyCandidates = remote.filter((b) => !localSet.has(b) && b !== current);

    if (localCandidates.length === 0 && remoteOnlyCandidates.length === 0) {
      this.ui.info("No branches available to delete.");
      return;
    }

    const labelled = await this.ui.spin("Loading branch info...", async () => {
      const localLabels = await Promise.all(
        localCandidates.map(async (b) => ({
          value: b,
          label: `${b}  (${await this.git.getBranchLastActivity(b)})`,
        })),
      );
      const remoteLabels = remoteOnlyCandidates.map((b) => ({
        value: `remote:${b}`,
        label: `${b}  [remote only]`,
      }));
      return [...localLabels, ...remoteLabels];
    });

    const selected = await this.ui.askSearchMultiSelect("Select branches to delete:", labelled);
    if (selected.length === 0) return;

    const selectedProtected = selected
      .map((s) => (s.startsWith("remote:") ? s.slice(7) : s))
      .filter((b) => PROTECTED_BRANCHES.has(b));

    if (selectedProtected.length > 0) {
      const confirmed = await this.ui.askConfirm(
        `⚠️  You selected protected branch(es): ${selectedProtected.join(", ")}. Delete anyway?`,
      );
      if (!confirmed) return;
    }

    const hasLocalSelected = selected.some((s) => !s.startsWith("remote:"));
    const deleteRemote = hasLocalSelected
      ? await this.ui.askConfirm("Also delete from origin?")
      : true;

    let localDeleted = 0;
    let remoteDeleted = 0;
    const warnings: string[] = [];

    for (const entry of selected) {
      const isRemoteOnly = entry.startsWith("remote:");
      const branch = isRemoteOnly ? entry.slice(7) : entry;

      if (!isRemoteOnly) {
        try {
          await this.ui.spin(`Removing local "${branch}"...`, () =>
            this.git.deleteLocalBranchForce(branch),
          );
          localDeleted++;
        } catch {
          warnings.push(`Could not delete local branch "${branch}" — skipping.`);
        }
      }

      if (isRemoteOnly || deleteRemote) {
        try {
          await this.ui.spin(`Removing remote "${branch}"...`, () =>
            this.git.deleteRemoteBranch(branch),
          );
          remoteDeleted++;
        } catch {
          warnings.push(`Could not delete remote branch "${branch}" — skipping.`);
        }
      }
    }

    for (const w of warnings) this.ui.warn(w);

    const parts: string[] = [];
    if (localDeleted > 0) parts.push(`${localDeleted} local`);
    if (remoteDeleted > 0) parts.push(`${remoteDeleted} remote`);
    this.ui.success(`${parts.join(" + ")} branch(es) deleted.`);
  }

  filterCandidates(all: string[], current: string): string[] {
    return all.filter((b) => b !== current);
  }
}
