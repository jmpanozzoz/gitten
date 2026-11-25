import type { HistoryRange, HistoryRewritePort, RewriteHistory } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { PROTECTED_BRANCHES } from "./protected-branches";

export async function editableHistory(
  git: HistoryRewritePort,
  ui: IUI,
  limit: number,
): Promise<RewriteHistory | undefined> {
  const pending = await git.getInProgressOperation();
  if (pending) {
    ui.warn(`Finish the pending ${pending} before rewriting history.`);
    return;
  }
  try {
    return await git.readRewriteHistory(limit);
  } catch (error) {
    ui.warn(error instanceof Error ? error.message : String(error));
  }
}

export async function selectHistoryRange(
  ui: IUI,
  history: RewriteHistory,
  prompt: string,
): Promise<HistoryRange | undefined> {
  const head = history.commits[0]?.oid;
  if (!head) return;
  const selected = await ui.askSearchSelect(
    prompt,
    history.commits.map(({ oid, subject }) => ({
      value: oid,
      label: `${oid.slice(0, 12)} — ${subject}`,
    })),
  );
  const index = history.commits.findIndex(({ oid }) => oid === selected);
  const oldest = history.commits[index];
  if (!oldest) return;
  return {
    branchRef: history.branchRef,
    head,
    oldest: oldest.oid,
    base: oldest.firstParent,
    count: index + 1,
  };
}

export function describeHistoryRange(range: HistoryRange): string {
  const branch = range.branchRef.slice("refs/heads/".length);
  const protectedLabel = PROTECTED_BRANCHES.has(branch) ? "Protected branch " : "Branch ";
  const target = range.base ? range.base.slice(0, 12) : "unborn branch";
  return `${protectedLabel}${branch} · ${range.head.slice(0, 12)} → ${target} · ${range.count} first-parent commit(s)`;
}
