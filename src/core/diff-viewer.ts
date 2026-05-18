import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { renderDiff } from "../ui/diff-renderer";

export class DiffViewer {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
    const { all, current } = await this.git.getBranches();
    const remoteBranches = await this.git.getRemoteBranches();
    const remoteOnly = remoteBranches.filter((b) => !all.includes(b));

    const options = [
      ...all.filter((b) => b !== current).map((b) => ({ value: b, label: b })),
      ...remoteOnly.map((b) => ({ value: b, label: `${b}  (remote)` })),
    ];

    if (options.length === 0) {
      this.ui.info("No other branches to compare against.");
      return;
    }

    const target = await this.ui.askSearchSelect(
      `Compare '${current}' against:`,
      options
    );

    const diff = await this.ui.spin(
      `Comparing with ${target}...`,
      () => this.git.getBranchDiff(target)
    );

    if (!diff) {
      this.ui.info(`No differences between '${current}' and '${target}'.`);
      return;
    }

    this.ui.info(renderDiff(diff));
  }
}
