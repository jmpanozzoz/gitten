import { resolveConflict } from "./conflict-resolver";
import { GoBackSignal } from "./domain/navigation";
import { DEFAULT_LIMITS } from "./domain/preferences";
import { explainDiff } from "./explain-diff";
import type { AICommitExplainer, AIConflictExplainer } from "./ports/ai.port";
import type { BranchSummary, CommitSummary, IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { PROTECTED_BRANCHES } from "./protected-branches";

interface CherryPickerOptions {
  waitForResolution?: () => Promise<boolean>;
  aiExplainer?: AICommitExplainer;
  aiConflictExplainer?: AIConflictExplainer;
  logLimit?: number;
}

export class CherryPicker {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly options: CherryPickerOptions = {},
  ) {}

  async run(): Promise<void> {
    const pending = await this.git.getInProgressOperation();
    if (pending === "cherry-pick") {
      await this.handleConflict();
      return;
    }
    if (pending) {
      this.ui.warn(`Finish the pending ${pending} before cherry-picking.`);
      return;
    }

    const branches = await this.git.getBranches();
    const ordered = await this.selectCommits(branches);
    if (ordered.length === 0) return;
    const [only] = ordered;
    if (ordered.length === 1 && only) {
      await explainDiff(
        this.ui,
        () => this.git.getCommitDiff(only.hash),
        "the selected commit diff for explanation",
        this.options.aiExplainer,
      );
    }
    const plan = ordered.map((commit) => `${commit.hash} — ${commit.message}`).join("\n  ");
    const proceed = await this.ui.askConfirm(
      `Apply ${ordered.length} commit(s) in this order?\n  ${plan}`,
      false,
    );
    if (!proceed) return;
    if ((await this.git.getBranches()).current !== branches.current) {
      this.ui.warn("The destination branch changed. Review the cherry-pick again.");
      return;
    }
    await this.applyCommits(ordered);
  }

  private async selectCommits(destination: BranchSummary): Promise<CommitSummary[]> {
    const branches = await this.sourceBranches(destination);
    if (branches.length === 0) return [];
    const source = await this.ui.askSearchSelect("Pick commits from which branch?", branches);
    const commits = await this.git.getLog(
      source,
      this.options.logLimit ?? DEFAULT_LIMITS.cherryPickLogLimit,
    );
    if (commits.length === 0) {
      this.ui.info("No commits found on that branch.");
      return [];
    }
    const selected = new Set(
      await this.ui.askSearchMultiSelect(
        "Select commits to cherry-pick:",
        commits.map((commit) => ({
          value: commit.hash,
          label: `${commit.hash} — ${commit.message}`,
        })),
      ),
    );
    return commits.filter((commit) => selected.has(commit.hash)).reverse();
  }

  private async sourceBranches({ all, current }: BranchSummary) {
    if (PROTECTED_BRANCHES.has(current)) {
      const proceed = await this.ui.askConfirm(
        `⚠️  You are on '${current}'. Apply a cherry-picked commit here?`,
      );
      if (!proceed) return [];
    }

    const remoteBranches = await this.git.getTrackingBranches();
    const branchOptions = [
      ...all
        .filter((branch) => branch !== current)
        .map((branch) => ({
          value: `refs/heads/${branch}`,
          label: `${branch} · local`,
        })),
      ...remoteBranches.map(({ remote, name, ref }) => ({
        value: ref,
        label: `${remote}/${name} · remote`,
      })),
    ];

    if (branchOptions.length === 0) this.ui.info("No other branches to cherry-pick from.");
    return branchOptions;
  }

  private async applyCommits(ordered: CommitSummary[]): Promise<void> {
    let applied = 0;
    for (const commit of ordered) {
      try {
        await this.ui.spin(`Applying ${commit.hash}...`, () => this.git.cherryPick(commit.hash));
        applied++;
      } catch (e) {
        if (e instanceof GoBackSignal) throw e;
        if ((await this.git.getInProgressOperation()) !== "cherry-pick") {
          this.ui.error(
            `Could not apply ${commit.hash}. Applied ${applied} of ${ordered.length} commit(s).`,
          );
          return;
        }
        const continued = await this.handleConflict();
        if (!continued) {
          this.ui.warn(
            `Stopped after ${applied} of ${ordered.length} commit(s) due to an unresolved conflict.`,
          );
          return;
        }
        applied++;
      }
    }

    this.ui.success(`Applied ${applied} commit(s) successfully.`);
  }

  private handleConflict(): Promise<boolean> {
    return resolveConflict(
      this.git,
      this.ui,
      {
        operation: "cherry-pick",
        label: "Cherry-pick",
        onContinue: () => this.git.cherryPickContinue(),
        onAbort: () => this.git.cherryPickAbort(),
        explain: this.options.aiConflictExplainer,
      },
      this.options.waitForResolution,
    );
  }
}
