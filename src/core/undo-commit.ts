import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { readConfig, getLimits } from "../config/config";

type ResetMode = "soft" | "mixed";

export class UndoCommit {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
    const { undoCommitLimit } = getLimits(await readConfig());
    const branch = await this.git.getCurrentBranch();
    const commits = await this.git.getLog(branch, undoCommitLimit);

    if (commits.length === 0) {
      this.ui.info("No commits to undo.");
      return;
    }

    const hash = await this.ui.askSearchSelect(
      "Undo back to which commit? (everything above it will be undone)",
      commits.map((c) => ({
        value: c.hash,
        label: `${c.hash} — ${c.message}`,
      }))
    );

    const n = commits.findIndex((c) => c.hash === hash) + 1;

    const mode = await this.ui.askSelect<ResetMode>("How do you want to undo?", [
      { value: "soft", label: "↩  Soft — keep changes staged" },
      { value: "mixed", label: "↺  Mixed — keep changes unstaged" },
    ]);

    const confirmed = await this.ui.askConfirm(
      `Undo ${n} commit(s) with ${mode} reset?`
    );
    if (!confirmed) return;

    await this.ui.spin(`Undoing ${n} commit(s)...`, () =>
      mode === "soft" ? this.git.resetSoft(n) : this.git.resetMixed(n)
    );

    this.ui.success(
      `${n} commit(s) undone. Changes are ${mode === "soft" ? "staged" : "in your working tree"}.`
    );
  }
}
