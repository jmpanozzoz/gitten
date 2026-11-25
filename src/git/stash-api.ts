import type { StashEntry, StashIdentity } from "../core/ports/git-client.port";
import type { GitContext } from "./client-context";

export const stashAPI = {
  async stash(): Promise<void> {
    await this.stashWithMessage("", true);
  },
  async getStashes(): Promise<StashEntry[]> {
    const raw = await this.git.raw(["stash", "list", "-z", "--format=%H%x00%gd%x00%s%x00%cr"]);
    const fields = raw.split("\0");
    const stashes: StashEntry[] = [];
    for (let offset = 0; offset + 3 < fields.length; offset += 4) {
      const oid = fields[offset]!;
      const ref = fields[offset + 1]!;
      const message = fields[offset + 2]!;
      const date = fields[offset + 3]!;
      const index = ref.match(/^stash@\{(\d+)\}$/)?.[1];
      if (!oid || index === undefined) throw new Error("Git returned an invalid stash entry.");
      stashes.push({ oid, index: Number(index), message, date });
    }
    return stashes;
  },
  async stashWithMessage(message: string, includeUntracked = false): Promise<void> {
    const args = ["push"];
    if (includeUntracked) args.push("--include-untracked");
    if (message.trim()) args.push("-m", message);
    await this.git.stash(args);
  },
  async stashApply(selection: StashIdentity): Promise<void> {
    await currentStashRef(this, selection);
    await this.git.stash(["apply", selection.oid]);
  },
  async stashPop(selection: StashIdentity): Promise<void> {
    const ref = await currentStashRef(this, selection);
    await this.git.stash(["pop", ref]);
  },
  async stashDrop(selection: StashIdentity): Promise<void> {
    const ref = await currentStashRef(this, selection);
    await this.git.stash(["drop", ref]);
  },
  async getStashStat(
    oid: string,
  ): Promise<{ filesChanged: number; insertions: number; deletions: number }> {
    const raw = await this.git.raw([
      "stash",
      "show",
      "--numstat",
      "-z",
      "--no-renames",
      "--include-untracked",
      oid,
      "--",
    ]);
    const records = raw.split("\0").filter(Boolean);
    let insertions = 0;
    let deletions = 0;
    for (const row of records) {
      const [added, removed] = row.split("\t", 2);
      const ins = Number(added);
      const del = Number(removed);
      if (Number.isFinite(ins)) insertions += ins;
      if (Number.isFinite(del)) deletions += del;
    }
    return { filesChanged: records.length, insertions, deletions };
  },
  async getStashDiff(oid: string): Promise<string> {
    return this.git.raw([
      "stash",
      "show",
      "-p",
      "--include-untracked",
      "--no-ext-diff",
      "--no-textconv",
      oid,
      "--",
    ]);
  },
} satisfies ThisType<GitContext>;

async function currentStashRef(
  context: GitContext,
  { index, oid }: StashIdentity,
): Promise<string> {
  const entry = (await context.getStashes()).find((stash) => stash.index === index);
  if (entry?.oid !== oid) throw new Error("The stash list changed. Select the stash again.");
  return `stash@{${index}}`;
}
