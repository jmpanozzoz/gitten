import { DEFAULT_LIMITS } from "./domain/preferences";
import { describeHistoryRange, editableHistory, selectHistoryRange } from "./history-range";
import type { HistoryRewritePort, UndoMode } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

export class UndoCommit {
  constructor(
    private readonly git: HistoryRewritePort,
    private readonly ui: IUI,
    private readonly logLimit = DEFAULT_LIMITS.undoCommitLimit,
  ) {}

  async run(): Promise<void> {
    const history = await editableHistory(this.git, this.ui, this.logLimit);
    if (!history) return;
    if (history.commits.length === 0) {
      this.ui.info("No commits to undo.");
      return;
    }
    const range = await selectHistoryRange(
      this.ui,
      history,
      "Undo from HEAD through this first-parent commit:",
    );
    if (!range) return;

    const mode = await this.ui.askSelect<UndoMode>("How do you want to undo?", [
      { value: "soft", label: "Soft — keep the existing index and working files" },
      { value: "mixed", label: "Mixed — reset the index and keep working files" },
    ]);
    if (mode === "mixed")
      this.ui.warn("The index will be replaced. Working files remain in place.");
    this.ui.warn(describeHistoryRange(range));
    if (!(await this.ui.askConfirm(`Undo ${range.count} commit(s) with ${mode} reset?`, false)))
      return;

    const backup = await this.ui.spin(`Undoing ${range.count} commit(s)...`, () =>
      this.git.undoRange(range, mode),
    );
    this.ui.success(`Undid ${range.count} commit(s). Recovery ref ${backup}.`);
  }
}
