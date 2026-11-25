import { confirmAISend } from "./ai-consent";
import { GoBackSignal } from "./domain/navigation";
import { DEFAULT_BRANCH_PREFIXES } from "./domain/preferences";
import type { AIBranchSuggester } from "./ports/ai.port";
import type { BranchType, IUI } from "./ports/ui.port";
import type { CreateBranchPort } from "./ports/workflow-git.port";

/** Descriptions shown next to the built-in prefixes; custom prefixes show bare. */
const PREFIX_DESCRIPTIONS = new Map([
  ["feat", "new feature"],
  ["fix", "bug fix"],
  ["hotfix", "urgent production fix"],
  ["chore", "maintenance task"],
  ["docs", "documentation only"],
]);

export class BranchCreator {
  constructor(
    private readonly git: CreateBranchPort,
    private readonly ui: IUI,
    private readonly aiSuggester?: AIBranchSuggester,
    private readonly prefixes: readonly string[] = DEFAULT_BRANCH_PREFIXES,
  ) {}

  async run(): Promise<void> {
    const prefixes = this.prefixes;
    const type = await this.ui.askSelect<BranchType>(
      "Branch type:",
      prefixes.map((prefix) => {
        const description = PREFIX_DESCRIPTIONS.get(prefix);
        return { value: prefix, label: description ? `${prefix} — ${description}` : prefix };
      }),
    );

    const description = await this.promptDescription();
    let branchName = await this.resolveBranchName(type, description);

    if (!(await this.git.isValidBranchName(branchName))) {
      this.ui.warn(`"${branchName}" is not a valid branch name.`);
      branchName = await this.promptAvailableName(branchName);
    } else if (await this.git.branchExists(branchName)) {
      if (!this.aiSuggester) {
        this.ui.error(`Branch "${branchName}" already exists locally.`);
        return;
      }
      this.ui.warn(`Branch "${branchName}" already exists — enter a different name.`);
      branchName = await this.promptAvailableName(branchName);
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

  private async promptAvailableName(placeholder: string): Promise<string> {
    while (true) {
      const name = (await this.ui.askText("Branch name:", placeholder)).trim();
      if (!(await this.git.isValidBranchName(name))) {
        this.ui.warn(`"${name}" is not a valid branch name.`);
      } else if (await this.git.branchExists(name)) {
        this.ui.warn(`Branch "${name}" also already exists.`);
      } else {
        return name;
      }
    }
  }

  private async resolveBranchName(type: BranchType, description: string): Promise<string> {
    const deterministic = this.buildBranchName(type, description);
    if (!this.aiSuggester) return deterministic;

    const suggest = await confirmAISend(
      this.ui,
      "your branch description for naming",
      this.aiSuggester,
    );
    if (!suggest) return deterministic;

    let slug: string | null;
    try {
      slug = await this.ui.spin("Generating suggestion...", () =>
        this.aiSuggester!(type, description),
      );
    } catch (error) {
      if (error instanceof GoBackSignal) throw error;
      this.ui.warn("AI naming failed — using the locally generated name.");
      return deterministic;
    }
    if (!slug) {
      this.ui.warn("AI did not return a suggestion — using generated name.");
      return deterministic;
    }

    const sanitized = this.buildBranchName(type, slug.replace(/^[^/]+\//, ""));
    return (await this.ui.askText("Branch name:", sanitized, sanitized)).trim() || sanitized;
  }

  private async promptDescription(): Promise<string> {
    while (true) {
      const input = await this.ui.askText("Short description:", "e.g. user authentication");
      if (input.trim().length > 0) return input;
      this.ui.warn("Description cannot be empty.");
    }
  }
}
