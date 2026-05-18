import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { GoBackSignal } from "../ui/go-back";
import { stdinResolution } from "../utils/stdin-resolution";
import { renderDiff } from "../ui/diff-renderer";
import { resolveConflict } from "./conflict-resolver";
import { PROTECTED_BRANCHES } from "./protected-branches";
import { readConfig, getLimits } from "../config/config";

export type AICommitExplainer = (diff: string) => Promise<string | null>;

export class CherryPicker {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly waitForResolution: () => Promise<boolean> = stdinResolution,
    private readonly aiExplainer?: AICommitExplainer
  ) {}

  async run(): Promise<void> {
    const { all, current } = await this.git.getBranches();

    if (PROTECTED_BRANCHES.has(current)) {
      const proceed = await this.ui.askConfirm(
        `⚠️  You are on '${current}'. Apply a cherry-picked commit here?`
      );
      if (!proceed) return;
    }

    const localBranches = all.filter((b) => b !== current);

    const remoteBranches = await this.git.getRemoteBranches();
    const remoteOnlyBranches = remoteBranches.filter((b) => !all.includes(b));

    const branchOptions = [
      ...localBranches.map((b) => ({ value: b, label: b })),
      ...remoteOnlyBranches.map((b) => ({ value: `origin/${b}`, label: `origin/${b}  (remote only)` })),
    ];

    if (branchOptions.length === 0) {
      this.ui.info("No other branches to cherry-pick from.");
      return;
    }

    const sourceBranch = await this.ui.askSearchSelect(
      "Pick commits from which branch?",
      branchOptions
    );

    const { cherryPickLogLimit } = getLimits(await readConfig());
    const commits = await this.git.getLog(sourceBranch, cherryPickLogLimit);

    if (commits.length === 0) {
      this.ui.info("No commits found on that branch.");
      return;
    }

    const hash = await this.ui.askSearchSelect(
      "Select a commit to cherry-pick:",
      commits.map((c) => ({ value: c.hash, label: `${c.hash} — ${c.message}` }))
    );

    if (this.aiExplainer) {
      try {
        const diff = await this.git.getCommitDiff(hash);
        if (diff) {
          const explanation = await this.ui.spin("Analyzing commit...", () => this.aiExplainer!(diff));
          if (explanation) this.ui.info(`✨ ${explanation}`);
        }
      } catch { /* non-blocking */ }
    }

    const preview = await this.ui.askConfirm("Preview this commit's diff before applying?");
    if (preview) {
      const diff = await this.git.getCommitDiff(hash);
      if (diff) this.ui.info(renderDiff(diff));

      const proceed = await this.ui.askConfirm("Apply this commit?");
      if (!proceed) return;
    }

    try {
      await this.ui.spin(`Applying commit ${hash}...`, () =>
        this.git.cherryPick(hash)
      );
      this.ui.success("Commit applied successfully.");
    } catch (e) {
      if (e instanceof GoBackSignal) throw e;
      await resolveConflict(this.git, this.ui, {
        label: "Cherry-pick",
        onContinue: () => this.git.cherryPickContinue(),
        onAbort: () => this.git.cherryPickAbort(),
      }, this.waitForResolution);
    }
  }
}
