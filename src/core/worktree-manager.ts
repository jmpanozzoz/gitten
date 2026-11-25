import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type WorktreeAction = "list" | "add" | "remove";
type BranchSource = "existing" | "new";

export class WorktreeManager {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
  ) {}

  async run(): Promise<void> {
    const action = await this.ui.askSelect<WorktreeAction>("Worktrees:", [
      { value: "list", label: "📋  List worktrees" },
      { value: "add", label: "➕  Add worktree" },
      { value: "remove", label: "🗑️  Remove worktree" },
    ]);

    if (action === "list") await this.listWorktrees();
    else if (action === "add") await this.addWorktree();
    else await this.removeWorktree();
  }

  private async listWorktrees(): Promise<void> {
    const worktrees = await this.git.getWorktrees();
    if (worktrees.length === 0) {
      this.ui.info("No worktrees found.");
      return;
    }
    for (const wt of worktrees) {
      const tag = wt.isMain ? " (main)" : wt.isLocked ? " (locked)" : "";
      this.ui.info(`${wt.branch}${tag}  →  ${wt.path}`);
    }
  }

  private async addWorktree(): Promise<void> {
    const path = await this.ui.askText("Directory path for new worktree:", "../repo-branch");

    const source = await this.ui.askSelect<BranchSource>("Branch to check out:", [
      { value: "existing", label: "Use existing branch" },
      { value: "new", label: "Create new branch" },
    ]);

    const branch =
      source === "new" ? await this.ui.askText("New branch name:") : await this.pickFreeBranch();
    if (!branch) return;
    try {
      await this.ui.spin(`Adding worktree at ${path}...`, () =>
        this.git.addWorktree(path, branch, source === "new"),
      );
    } catch (error) {
      this.ui.error(
        `Failed to add worktree: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    this.ui.success(`Worktree added at ${path}.`);
  }

  private async pickFreeBranch(): Promise<string | undefined> {
    const [{ all }, worktrees] = await Promise.all([
      this.git.getBranches(),
      this.git.getWorktrees(),
    ]);
    const occupied = new Set(worktrees.map(({ branch }) => branch));
    const available = all.filter((branch) => !occupied.has(branch));
    if (available.length === 0) {
      this.ui.info("No local branches are available for a new worktree.");
      return;
    }
    return this.ui.askSearchSelect(
      "Select branch:",
      available.map((value) => ({ value, label: value })),
    );
  }

  private async removeWorktree(): Promise<void> {
    const worktrees = await this.git.getWorktrees();
    const removable = worktrees.filter((wt) => !wt.isMain && !wt.isLocked);

    if (removable.length === 0) {
      this.ui.warn("No unlocked linked worktrees available for removal.");
      return;
    }

    const path = await this.ui.askSearchSelect(
      "Select worktree to remove:",
      removable.map((wt) => ({ value: wt.path, label: `${wt.branch}  →  ${wt.path}` })),
    );

    const confirm = await this.ui.askConfirm(
      `Remove the linked worktree and its checkout at ${path}?`,
      false,
    );
    if (!confirm) return;

    try {
      await this.ui.spin(`Removing worktree at ${path}...`, () => this.git.removeWorktree(path));
    } catch (err) {
      this.ui.error(
        `Failed to remove worktree: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    this.ui.success(`Worktree at ${path} removed.`);
  }
}
