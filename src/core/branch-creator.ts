import type { IGitClient } from "./ports/git-client.port";
import type { IUI, BranchType } from "./ports/ui.port";

export type AIBranchSuggester = (type: BranchType, description: string) => Promise<string | null>;

export class BranchCreator {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly aiSuggester?: AIBranchSuggester
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
    const branchName = await this.resolveBranchName(type, description);

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

  private async resolveBranchName(type: BranchType, description: string): Promise<string> {
    const deterministic = this.buildBranchName(type, description);
    if (!this.aiSuggester) return deterministic;

    const suggest = await this.ui.askConfirm("✨ Suggest a branch name with AI?");
    if (!suggest) return deterministic;

    const slug = await this.ui.spin("Generating suggestion...", () =>
      this.aiSuggester!(type, description)
    );

    if (!slug) {
      this.ui.warn("AI did not return a suggestion — using generated name.");
      return deterministic;
    }

    const sanitized = this.buildBranchName(type, slug.replace(/^[^/]+\//, ""));
    return this.ui.askText("Branch name:", sanitized);
  }

  private async promptDescription(): Promise<string> {
    while (true) {
      const input = await this.ui.askText("Short description:", "e.g. user authentication");
      if (input.trim().length > 0) return input;
      this.ui.warn("Description cannot be empty.");
    }
  }
}
