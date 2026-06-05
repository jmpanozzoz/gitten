import { stdinResolution } from "../utils/stdin-resolution";
import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

interface ConflictActions {
  label: string;
  onContinue: () => Promise<void>;
  onAbort: () => Promise<void>;
}

export async function resolveConflict(
  git: IGitClient,
  ui: IUI,
  actions: ConflictActions,
  waitForResolution: () => Promise<boolean> = stdinResolution,
): Promise<void> {
  const conflicted = await git.getConflictedFiles();

  if (conflicted.length > 0) {
    ui.warn(`🚨 ${actions.label} conflict — ${conflicted.length} file(s) need resolution:`);
    for (const f of conflicted) {
      ui.warn(`  • ${f}`);
    }
  } else {
    ui.warn(`🚨 ${actions.label} conflict detected.`);
  }
  ui.warn("Resolve in your IDE, then press ENTER to continue or ESC to abort.");

  const confirmed = await waitForResolution();

  if (confirmed) {
    try {
      await actions.onContinue();
      ui.success(`${actions.label} completed.`);
    } catch {
      ui.error(`Failed to complete ${actions.label.toLowerCase()}. Check your working tree.`);
    }
  } else {
    await actions.onAbort();
    ui.info(`${actions.label} aborted. Working tree is clean.`);
  }
}
