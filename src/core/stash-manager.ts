import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type StashAction = "apply" | "drop" | "push";
type ApplyMode = "pop" | "apply";

export class StashManager {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
    const action = await this.ui.askSelect<StashAction>("Manage stashes:", [
      { value: "apply", label: "📦 Apply a stash" },
      { value: "drop", label: "🗑️  Drop stash(es)" },
      { value: "push", label: "💾 Stash current changes" },
    ]);

    if (action === "apply") return this.applyStash();
    if (action === "drop") return this.dropStashes();
    if (action === "push") return this.pushStash();
  }

  private async applyStash(): Promise<void> {
    const stashes = await this.git.getStashes();

    if (stashes.length === 0) {
      this.ui.info("No stashes found.");
      return;
    }

    const index = await this.ui.askSelect<number>(
      "Select stash to apply:",
      stashes.map((s) => ({
        value: s.index,
        label: `stash@{${s.index}}  ${s.message}  (${s.date})`,
      }))
    );

    const mode = await this.ui.askSelect<ApplyMode>("How to apply?", [
      { value: "pop", label: "Pop — apply and remove from stash list" },
      { value: "apply", label: "Apply — keep in stash list" },
    ]);

    if (mode === "pop") {
      await this.ui.spin("Applying and dropping stash...", () => this.git.stashPop(index));
    } else {
      await this.ui.spin("Applying stash...", () => this.git.stashApply(index));
    }

    this.ui.success(`Stash@{${index}} applied.`);
  }

  private async dropStashes(): Promise<void> {
    const stashes = await this.git.getStashes();

    if (stashes.length === 0) {
      this.ui.info("No stashes found.");
      return;
    }

    const selected = await this.ui.askMultiSelect<number>(
      "Select stashes to drop:",
      stashes.map((s) => ({
        value: s.index,
        label: `stash@{${s.index}}  ${s.message}  (${s.date})`,
      }))
    );

    if (selected.length === 0) return;

    const confirmed = await this.ui.askConfirm(
      `Drop ${selected.length} stash(es)? This cannot be undone.`
    );
    if (!confirmed) return;

    // Drop in reverse order so indices remain valid after each deletion
    const sorted = [...selected].sort((a, b) => b - a);
    for (const index of sorted) {
      await this.git.stashDrop(index);
    }

    this.ui.success(`${selected.length} stash(es) dropped.`);
  }

  private async pushStash(): Promise<void> {
    const status = await this.git.getStatus();

    if (status.isClean()) {
      this.ui.info("Nothing to stash — working tree is clean.");
      return;
    }

    const message = await this.ui.askText(
      "Stash message (optional):",
      "WIP: in progress"
    );

    await this.ui.spin("Stashing...", () => this.git.stashWithMessage(message));
    this.ui.success("Changes stashed.");
  }
}
