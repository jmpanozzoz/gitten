import { explainDiff } from "./explain-diff";
import type { AIConflictExplainer } from "./ports/ai.port";
import type { ConflictOperation, ConflictPort } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

interface ConflictActions {
  operation: ConflictOperation;
  label: string;
  onContinue: () => Promise<void>;
  onAbort: () => Promise<void>;
  /** Optional AI explainer; when set, the user is offered an explanation of the conflict. */
  explain?: AIConflictExplainer;
}

export async function resolveConflict(
  git: ConflictPort,
  ui: IUI,
  actions: ConflictActions,
  waitForResolution: () => Promise<boolean | null> = () => ui.waitForConflictResolution(),
): Promise<boolean> {
  const identity = await git.getConflictIdentity(actions.operation);
  warnConflict(ui, actions.label, await git.getConflictedFiles());
  await explainDiff(
    ui,
    () => git.getConflictDiff(),
    "the conflict diff for explanation",
    actions.explain,
  );

  ui.warn(
    "Resolve and stage the listed files before continuing. Escape leaves the operation pending.",
  );

  const confirmed = await waitForResolution();

  if (confirmed === null) return false;
  if (!(await stillActive(git, actions.operation, identity))) {
    ui.warn("The active Git operation changed. Open repository status again.");
    return false;
  }
  if (confirmed) {
    try {
      if ((await git.getConflictedFiles()).length > 0) {
        ui.warn(`${actions.label} is still pending. Stage the resolved files before continuing.`);
        return false;
      }
      if (await git.hasStagedConflictMarkers()) {
        ui.warn(`${actions.label} is still pending. The staged diff contains conflict markers.`);
        return false;
      }
      await actions.onContinue();
      ui.success(`${actions.label} completed.`);
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      ui.error(`${actions.label} did not continue. Check Git status before retrying.\n${detail}`);
      return false;
    }
  }

  await actions.onAbort();
  ui.info(`${actions.label} aborted. Check Git status for local changes.`);
  return false;
}

async function stillActive(
  git: ConflictPort,
  operation: ConflictOperation,
  identity: string | null,
): Promise<boolean> {
  return (
    identity !== null &&
    (await git.getInProgressOperation()) === operation &&
    (await git.getConflictIdentity(operation)) === identity
  );
}

function warnConflict(ui: IUI, label: string, conflicted: string[]): void {
  if (conflicted.length === 0) {
    ui.warn(`🚨 ${label} conflict detected.`);
    return;
  }
  ui.warn(`🚨 ${label} conflict — ${conflicted.length} file(s) need resolution:`);
  for (const file of conflicted) ui.warn(`  • ${file}`);
}
