import { getBranchPrefixes, readConfig } from "../config/config";
import type { AIBranchSuggester } from "./ports/ai.port";
import type { IGitClient } from "./ports/git-client.port";
import type { BranchType, IUI } from "./ports/ui.port";

/** Descriptions shown next to the built-in prefixes; custom prefixes show bare. */
const PREFIX_DESCRIPTIONS: Record<string, string> = {
  feat: "new feature",
  fix: "bug fix",
  hotfix: "urgent production fix",
  chore: "maintenance task",
  docs: "documentation only",
};

export class BranchCreator {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly aiSuggester?: AIBranchSuggester,
  ) {}

  async run(): Promise<void> {
    const prefixes = getBranchPrefixes(await readConfig());
    const type = await this.ui.askSelect<BranchType>(
      "Branch type:",
      prefixes.map((p) => ({
        value: p,
        label: PREFIX_DESCRIPTIONS[p] ? `${p} — ${PREFIX_DESCRIPTIONS[p]}` : p,
      })),
    );

    const description = await this.promptDescription();
    let branchName = await this.resolveBranchName(type, description);

    const exists = await this.git.branchExists(branchName);
    if (exists) {
      if (!this.aiSuggester) {
        this.ui.error(`Branch "${branchName}" already exists locally.`);
        return;
      }
      branchName = await this.resolveCollision(branchName);
    }

    await this.ui.spin(`Creating branch ${branchName}...`, () =>
      this.git.checkoutNewBranch(branchName),
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

  private async resolveCollision(conflicting: string): Promise<string> {
    this.ui.warn(`Branch "${conflicting}" already exists — enter a different name.`);
    while (true) {
      const input = await this.ui.askText("Branch name:", conflicting);
      if (!(await this.git.branchExists(input))) return input;
      this.ui.warn(`Branch "${input}" also already exists.`);
    }
  }

  private async resolveBranchName(type: BranchType, description: string): Promise<string> {
    const deterministic = this.buildBranchName(type, description);
    if (!this.aiSuggester) return deterministic;

    const suggest = await this.ui.askConfirm("✨ Suggest a branch name with AI?");
    if (!suggest) return deterministic;

    const slug = await this.ui.spin("Generating suggestion...", () =>
      this.aiSuggester!(type, description),
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
