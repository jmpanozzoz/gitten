import { getLimits, readConfig } from "../config/config";
import { stdinResolution } from "../utils/stdin-resolution";
import { resolveConflict } from "./conflict-resolver";
import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { PROTECTED_BRANCHES } from "./protected-branches";

export class RevertCommit {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly waitForResolution: () => Promise<boolean> = stdinResolution,
  ) {}

  async run(): Promise<void> {
    const branch = await this.git.getCurrentBranch();

    if (PROTECTED_BRANCHES.has(branch)) {
      const proceed = await this.ui.askConfirm(
        `⚠️  You are on '${branch}'. Revert a commit on this branch?`,
      );
      if (!proceed) return;
    }

    const { revertLogLimit } = getLimits(await readConfig());
    const commits = await this.git.getLog(branch, revertLogLimit);

    if (commits.length === 0) {
      this.ui.info("No commits to revert.");
      return;
    }

    const hash = await this.ui.askSearchSelect(
      "Select a commit to revert:",
      commits.map((c) => ({ value: c.hash, label: `${c.hash} — ${c.message}` })),
    );

    const commit = commits.find((c) => c.hash === hash)!;

    const confirmed = await this.ui.askConfirm(
      `Revert "${commit.message}"? This creates a new commit that undoes those changes.`,
    );
    if (!confirmed) return;

    try {
      await this.ui.spin(`Reverting ${hash}...`, () => this.git.revertCommit(hash));
      this.ui.success(`Reverted: a new commit undoing "${commit.message}" was created.`);
    } catch (_e) {
      await resolveConflict(
        this.git,
        this.ui,
        {
          label: "Revert",
          onContinue: async () => {
            await this.git.addAll();
            await this.git.revertContinue();
          },
          onAbort: () => this.git.revertAbort(),
        },
        this.waitForResolution,
      );
    }
  }
}
