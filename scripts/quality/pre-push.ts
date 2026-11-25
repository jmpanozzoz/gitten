import { join } from "node:path";
import { outgoingCommits, pushHistory } from "./push-history";
import { verifySnapshot } from "./push-snapshot";
import { parsePushUpdates } from "./push-updates";

export async function prePush(
  root: string,
  input: string,
  signal: AbortSignal,
  destination?: string,
): Promise<void> {
  const updates = parsePushUpdates(input);
  if (updates.length === 0) return;
  signal.throwIfAborted();
  const history = await pushHistory(root, updates, signal, destination);
  const checked = new Set<string>();
  for (const update of updates) {
    signal.throwIfAborted();
    for (const commit of outgoingCommits(root, update, history)) {
      if (checked.has(commit)) continue;
      await checkCommit(root, update.localRef, commit, signal);
      checked.add(commit);
    }
  }
}

async function checkCommit(
  root: string,
  ref: string,
  commit: string,
  signal: AbortSignal,
): Promise<void> {
  const short = commit.slice(0, 12);
  console.log(`Checking ${ref} at ${short}`);
  try {
    await verifySnapshot(root, commit, signal);
  } catch (cause) {
    throw new Error(
      `Quality checks failed for ${ref} at ${short}. Run bun run quality:check on that commit.`,
      { cause },
    );
  }
}

async function readUpdates(signal: AbortSignal): Promise<string> {
  const input = process.stdin;
  const stop = () => input.destroy();
  signal.addEventListener("abort", stop, { once: true });
  try {
    input.setEncoding("utf8");
    let updates = "";
    for await (const chunk of input) updates += chunk;
    return updates;
  } finally {
    signal.removeEventListener("abort", stop);
    signal.throwIfAborted();
  }
}

export function describePrePushFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.cause instanceof Error) return `${error.message}\n${error.cause.message}`;
  return error.message;
}

if (import.meta.main) {
  const abort = new AbortController();
  const cancel = () => abort.abort(new Error("Pre-push cancelled."));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    await prePush(
      join(import.meta.dir, "../.."),
      await readUpdates(abort.signal),
      abort.signal,
      process.argv[3],
    );
  } catch (error) {
    console.error(describePrePushFailure(error));
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
