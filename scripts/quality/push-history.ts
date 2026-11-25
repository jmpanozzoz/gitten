import { readFileSync } from "node:fs";
import { localGit } from "./push-snapshot";
import type { PushUpdate } from "./push-updates";

export interface PushHistory {
  published: ReadonlySet<string>;
  shallow: ReadonlySet<string>;
}

const objectId = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export async function pushHistory(
  root: string,
  updates: readonly PushUpdate[],
  signal: AbortSignal,
  destination?: string,
): Promise<PushHistory> {
  const advertised = destination ? await remoteObjects(root, destination, signal) : [];
  const candidates = new Set([...advertised, ...updates.map(({ remoteOid }) => remoteOid)]);
  const expressions = [...candidates].map((oid) => `${oid}^{commit}\n`).join("");
  const objects = localGit(
    root,
    ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    expressions,
  );
  const published = new Set(
    lines(objects)
      .filter((line) => line.endsWith(" commit"))
      .map((line) => line.slice(0, -" commit".length)),
  );
  const shallowFile = localGit(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "shallow",
  ]);
  const shallow =
    localGit(root, ["rev-parse", "--is-shallow-repository"]) === "true"
      ? lines(readFileSync(shallowFile, "utf8"))
      : [];
  return { published, shallow: new Set(shallow) };
}

export function outgoingCommits(root: string, update: PushUpdate, history: PushHistory): string[] {
  const tip = pushedCommit(root, update);
  const revisions = [tip, ...[...history.published].map((oid) => `^${oid}`)].join("\n");
  const outgoing = lines(
    localGit(root, ["rev-list", "--reverse", "--topo-order", "--stdin"], `${revisions}\n`),
  );
  if (outgoing.some((commit) => history.shallow.has(commit))) {
    throw new Error(
      `Cannot verify all outgoing commits for ${update.localRef} in this shallow checkout. Fetch more history from the destination and retry.`,
    );
  }
  // A ref update still validates its exact target when the remote already knows that commit.
  return outgoing.includes(tip) ? outgoing : [...outgoing, tip];
}

function pushedCommit(root: string, { oid, localRef }: PushUpdate): string {
  try {
    return localGit(root, ["rev-parse", "--verify", `${oid}^{commit}`]);
  } catch (cause) {
    throw new Error(
      `Cannot verify ${localRef} at ${oid.slice(0, 12)}. The object must resolve to a commit.`,
      { cause },
    );
  }
}

async function remoteObjects(
  root: string,
  destination: string,
  signal: AbortSignal,
): Promise<string[]> {
  const lookup = Bun.spawn(["git", "ls-remote", "--", destination], {
    cwd: root,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    signal,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [code, advertisement] = await Promise.all([lookup.exited, lookup.stdout.text()]);
  signal.throwIfAborted();
  // If upload-pack is unavailable, only exclude old object IDs supplied by the push itself.
  if (code !== 0) return [];
  return lines(advertisement)
    .map((line) => line.split("\t", 1)[0]!)
    .filter((oid) => objectId.test(oid));
}

function lines(output: string): string[] {
  return output.split("\n").filter(Boolean);
}
