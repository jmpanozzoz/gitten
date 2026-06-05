import { getLimits, readConfig } from "../config/config";
import { GoBackSignal } from "../ui/go-back";
import { stdinResolution } from "../utils/stdin-resolution";
import { resolveConflict } from "./conflict-resolver";
import type { AICommitExplainer } from "./ports/ai.port";
import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { PROTECTED_BRANCHES } from "./protected-branches";

export class CherryPicker {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly waitForResolution: () => Promise<boolean> = stdinResolution,
    private readonly aiExplainer?: AICommitExplainer,
  ) {}

  async run(): Promise<void> {
    const { all, current } = await this.git.getBranches();

    if (PROTECTED_BRANCHES.has(current)) {
      const proceed = await this.ui.askConfirm(
        `⚠️  You are on '${current}'. Apply a cherry-picked commit here?`,
      );
      if (!proceed) return;
    }

    const localBranches = all.filter((b) => b !== current);

    const remoteBranches = await this.git.getRemoteBranches();
    const remoteOnlyBranches = remoteBranches.filter((b) => !all.includes(b));

    const branchOptions = [
      ...localBranches.map((b) => ({ value: b, label: b })),
      ...remoteOnlyBranches.map((b) => ({
        value: `origin/${b}`,
        label: `origin/${b}  (remote only)`,
      })),
    ];

    if (branchOptions.length === 0) {
      this.ui.info("No other branches to cherry-pick from.");
      return;
    }

    const sourceBranch = await this.ui.askSearchSelect(
      "Pick commits from which branch?",
      branchOptions,
    );

    const { cherryPickLogLimit } = getLimits(await readConfig());
    const commits = await this.git.getLog(sourceBranch, cherryPickLogLimit);

    if (commits.length === 0) {
      this.ui.info("No commits found on that branch.");
      return;
    }

    const selected = await this.ui.askSearchMultiSelect(
      "Select commits to cherry-pick:",
      commits.map((c) => ({ value: c.hash, label: `${c.hash} — ${c.message}` })),
    );

    if (selected.length === 0) return;

    // getLog is newest-first; apply oldest-first so the original order is preserved.
    const ordered = commits.filter((c) => selected.includes(c.hash)).reverse();

    // AI explanation stays a single-commit nicety; the Log browser covers inspecting the rest.
    if (ordered.length === 1 && this.aiExplainer) {
      try {
        const diff = await this.git.getCommitDiff(ordered[0]!.hash);
        if (diff) {
          const explanation = await this.ui.spin("Analyzing commit...", () =>
            this.aiExplainer!(diff),
          );
          if (explanation) this.ui.info(`✨ ${explanation}`);
        }
      } catch {
        /* non-blocking */
      }
    }

    const plan = ordered.map((c) => `${c.hash} — ${c.message}`).join("\n  ");
    const proceed = await this.ui.askConfirm(
      `Apply ${ordered.length} commit(s) in this order?\n  ${plan}`,
    );
    if (!proceed) return;

    let applied = 0;
    for (const commit of ordered) {
      try {
        await this.ui.spin(`Applying ${commit.hash}...`, () => this.git.cherryPick(commit.hash));
        applied++;
      } catch (e) {
        if (e instanceof GoBackSignal) throw e;
        const continued = await resolveConflict(
          this.git,
          this.ui,
          {
            label: "Cherry-pick",
            onContinue: () => this.git.cherryPickContinue(),
            onAbort: () => this.git.cherryPickAbort(),
          },
          this.waitForResolution,
        );
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
}
