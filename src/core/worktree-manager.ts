import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type WorktreeAction = "list" | "add" | "remove";
type BranchSource = "existing" | "new";

export class WorktreeManager {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
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

    if (source === "existing") {
      const { all } = await this.git.getBranches();
      const branch = await this.ui.askSearchSelect(
        "Select branch:",
        all.map((b) => ({ value: b, label: b }))
      );
      await this.ui.spin(`Adding worktree at ${path}...`, () =>
        this.git.addWorktree(path, branch as string, false)
      );
    } else {
      const branch = await this.ui.askText("New branch name:");
      await this.ui.spin(`Adding worktree with new branch ${branch}...`, () =>
        this.git.addWorktree(path, branch, true)
      );
    }

    this.ui.success(`Worktree added at ${path}.`);
  }

  private async removeWorktree(): Promise<void> {
    const worktrees = await this.git.getWorktrees();
    const removable = worktrees.filter((wt) => !wt.isMain);

    if (removable.length === 0) {
      this.ui.warn("No removable worktrees found (main worktree cannot be removed).");
      return;
    }

    const path = await this.ui.askSearchSelect(
      "Select worktree to remove:",
      removable.map((wt) => ({ value: wt.path, label: `${wt.branch}  →  ${wt.path}` }))
    );

    const confirm = await this.ui.askConfirm(`Remove worktree at ${path}?`);
    if (!confirm) return;

    await this.ui.spin(`Removing worktree at ${path}...`, () =>
      this.git.removeWorktree(path as string)
    );
    this.ui.success(`Worktree at ${path} removed.`);
  }
}
