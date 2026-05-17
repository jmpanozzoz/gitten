import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { GoBackSignal } from "../ui/go-back";
import { stdinResolution } from "../utils/stdin-resolution";
import { theme } from "../ui/theme";

const COMMIT_LOG_LIMIT = 30;

export class CherryPicker {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly waitForResolution: () => Promise<boolean> = stdinResolution
  ) {}

  async run(): Promise<void> {
    const { all, current } = await this.git.getBranches();
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

    const commits = await this.git.getLog(sourceBranch, COMMIT_LOG_LIMIT);

    if (commits.length === 0) {
      this.ui.info("No commits found on that branch.");
      return;
    }

    const hash = await this.ui.askSearchSelect(
      "Select a commit to cherry-pick:",
      commits.map((c) => ({ value: c.hash, label: `${c.hash} — ${c.message}` }))
    );

    const preview = await this.ui.askConfirm("Preview this commit's diff before applying?");
    if (preview) {
      const diff = await this.git.getCommitDiff(hash);
      if (diff) {
        const MAX_LINES = 40;
        const lines = diff.split("\n");
        const colored = lines.slice(0, MAX_LINES)
          .map((line) => {
            if (line.startsWith("+") && !line.startsWith("+++")) return theme.diffAdd(line);
            if (line.startsWith("-") && !line.startsWith("---")) return theme.diffRemove(line);
            return theme.muted(line);
          })
          .join("\n");
        this.ui.info(colored);
        if (lines.length > MAX_LINES) this.ui.info(theme.muted(`...and ${lines.length - MAX_LINES} more lines`));
      }

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
      await this.handleConflict();
    }
  }

  private async handleConflict(): Promise<void> {
    const conflicted = await this.git.getConflictedFiles();
    if (conflicted.length > 0) {
      this.ui.warn(`🚨 Cherry-pick conflict — ${conflicted.length} file(s) need resolution:`);
      for (const f of conflicted) {
        this.ui.warn(`  • ${f}`);
      }
    } else {
      this.ui.warn("🚨 Cherry-pick conflict detected.");
    }
    this.ui.warn("Resolve in your IDE, then press ENTER to continue or ESC to abort.");

    const confirmed = await this.waitForResolution();

    if (confirmed) {
      try {
        await this.git.cherryPickContinue();
        this.ui.success("Cherry-pick completed.");
      } catch {
        this.ui.error("Failed to continue cherry-pick. Check your working tree.");
      }
    } else {
      await this.git.cherryPickAbort();
      this.ui.info("Cherry-pick aborted. Working tree is clean.");
    }
  }
}
