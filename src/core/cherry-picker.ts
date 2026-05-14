import * as readline from "node:readline";
import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

const COMMIT_LOG_LIMIT = 15;

function stdinResolution(): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    process.stdin.setRawMode(true);
    process.stdin.once("data", (key: Buffer) => {
      rl.close();
      process.stdin.setRawMode(false);
      resolve(key[0] !== 0x1b);
    });
  });
}

export class CherryPicker {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly waitForResolution: () => Promise<boolean> = stdinResolution
  ) {}

  async run(): Promise<void> {
    const { all, current } = await this.git.getBranches();
    const branches = all.filter((b) => b !== current);

    if (branches.length === 0) {
      this.ui.info("No other branches to cherry-pick from.");
      return;
    }

    const sourceBranch = await this.ui.askSelect(
      "Pick commits from which branch?",
      branches.map((b) => ({ value: b, label: b }))
    );

    const commits = await this.git.getLog(sourceBranch, COMMIT_LOG_LIMIT);

    if (commits.length === 0) {
      this.ui.info("No commits found on that branch.");
      return;
    }

    const hash = await this.ui.askSelect(
      "Select a commit to cherry-pick:",
      commits.map((c) => ({ value: c.hash, label: `${c.hash} — ${c.message}` }))
    );

    try {
      await this.ui.spin(`Applying commit ${hash}...`, () =>
        this.git.cherryPick(hash)
      );
      this.ui.success("Commit applied successfully.");
    } catch {
      await this.handleConflict();
    }
  }

  private async handleConflict(): Promise<void> {
    this.ui.warn(
      "🚨 Conflict detected. Open your IDE, resolve the files, then press ENTER to continue or ESC to abort."
    );

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
