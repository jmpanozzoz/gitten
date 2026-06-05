import { stdinResolution } from "../utils/stdin-resolution";
import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

interface ConflictActions {
  label: string;
  onContinue: () => Promise<void>;
  onAbort: () => Promise<void>;
}

/**
 * Drive the user through a conflict pause (resolve in IDE → ENTER continue / ESC abort).
 * Returns `true` when the operation was continued and completed, `false` when it was
 * aborted or the continue failed — callers running a sequence use this to decide
 * whether to keep going.
 */
export async function resolveConflict(
  git: IGitClient,
  ui: IUI,
  actions: ConflictActions,
  waitForResolution: () => Promise<boolean> = stdinResolution,
): Promise<boolean> {
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
      return true;
    } catch {
      ui.error(`Failed to complete ${actions.label.toLowerCase()}. Check your working tree.`);
      return false;
    }
  }

  await actions.onAbort();
  ui.info(`${actions.label} aborted. Working tree is clean.`);
  return false;
}
