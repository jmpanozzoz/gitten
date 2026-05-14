import type { IGitClient } from "./ports/git-client.port";
import type { IUI, BranchType } from "./ports/ui.port";

const BRANCH_TYPES: BranchType[] = ["feat", "fix", "hotfix", "chore", "docs"];

export class BranchCreator {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
    const type = await this.ui.askSelect<BranchType>("Branch type:", [
      { value: "feat", label: "feat — new feature" },
      { value: "fix", label: "fix — bug fix" },
      { value: "hotfix", label: "hotfix — urgent production fix" },
      { value: "chore", label: "chore — maintenance task" },
      { value: "docs", label: "docs — documentation only" },
    ]);

    const description = await this.promptDescription();
    const branchName = this.buildBranchName(type, description);

    const exists = await this.git.branchExists(branchName);
    if (exists) {
      this.ui.error(`Branch "${branchName}" already exists locally.`);
      return;
    }

    await this.ui.spin(`Creating branch ${branchName}...`, () =>
      this.git.checkoutNewBranch(branchName)
    );

    this.ui.success(`You are now on ${branchName}.`);
  }

  buildBranchName(type: BranchType, description: string): string {
    const slug = description
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    return `${type}/${slug}`;
  }

  private async promptDescription(): Promise<string> {
    while (true) {
      const input = await this.ui.askText("Short description:", "e.g. user authentication");
      if (input.trim().length > 0) return input;
      this.ui.warn("Description cannot be empty.");
    }
  }
}
