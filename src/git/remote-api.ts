import { hasLayoutControl } from "../core/domain/text-layout";
import type {
  BranchPushPlan,
  Remote,
  RemoteBranchDeletion,
  RemoteResetTarget,
  TagPushPlan,
  TrackingBranch,
} from "../core/ports/git-client.port";

import type { GitContext } from "./client-context";
import { fetchSource } from "./refspec";
import { gitFailureDetail } from "./strict-git";

export const remoteAPI = {
  async getRemotes(): Promise<Remote[]> {
    const remotes = await remoteNames(this);
    return Promise.all(
      remotes.map(async (name) => ({
        name,
        url: (await configuredPushOrFetchUrls(this, name, "url"))[0] ?? "",
      })),
    );
  },
  async addRemote(name: string, url: string): Promise<void> {
    assertRemoteAddress(url);
    await this.git.raw(["remote", "add", "--", name, url]);
  },
  async removeRemote(name: string): Promise<void> {
    await this.git.raw(["remote", "remove", "--", name]);
  },
  async setRemoteUrl(name: string, url: string): Promise<void> {
    assertRemoteAddress(url);
    await this.git.raw(["remote", "set-url", "--", name, url]);
  },
  async getTrackingBranches(): Promise<TrackingBranch[]> {
    const raw = await this.git.raw([
      "for-each-ref",
      "--format=%(refname)%00%(symref)%00%(objectname)",
      "refs/remotes/",
    ]);
    const remotes = (await remoteNames(this)).sort((a, b) => b.length - a.length);
    return raw
      .trimEnd()
      .split("\n")
      .flatMap((line) => trackingBranch(line, remotes));
  },
  async checkoutTrackingBranch(target: TrackingBranch, local: string): Promise<void> {
    if (!local || local.startsWith("-")) throw new Error("Choose a valid local branch name.");
    await this.git.raw(["check-ref-format", `refs/heads/${local}`]);
    await requireSameTrackingBranch(this, target);
    await this.git.raw(["switch", "--track", "-c", local, "--", target.ref]);
  },
  async previewRemoteBranchDeletion(target: TrackingBranch): Promise<RemoteBranchDeletion> {
    await requireSameTrackingBranch(this, target);
    const config = await readOneConfig(this, `remote.${target.remote}.fetch`);
    const destination = fetchSource(target.ref, config.split("\n"));
    if (!destination?.startsWith("refs/heads/")) {
      throw new Error("Could not determine the source branch from the remote's fetch refspecs.");
    }
    await this.git.raw(["check-ref-format", destination]);
    return { target, destination, urls: await readPushUrls(this, target.remote) };
  },
  async deleteRemoteBranch(plan: RemoteBranchDeletion): Promise<void> {
    const { destination, urls } = await this.previewRemoteBranchDeletion(plan.target);
    if (destination !== plan.destination || JSON.stringify(urls) !== JSON.stringify(plan.urls)) {
      throw new Error("The remote configuration changed. Review the branch again.");
    }
    await writeRemote(
      this,
      [
        "push",
        "--porcelain",
        "--no-follow-tags",
        "--recurse-submodules=no",
        `--force-with-lease=${destination}:${plan.target.head}`,
        "--",
        plan.target.remote,
        `:${destination}`,
      ],
      urls,
    );
  },
  async fetchRemote(remote?: string): Promise<void> {
    await this.git.fetch(remote ? ["--", remote] : []);
  },
  async previewBranchPush(remote: string): Promise<BranchPushPlan> {
    const branch = (
      await this.git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "")
    ).trimEnd();
    if (!branch) throw new Error("Check out a local branch before pushing.");
    const head = (
      await this.git.raw(["rev-parse", "--verify", "HEAD^{commit}"]).catch(() => "")
    ).trimEnd();
    if (!head) throw new Error("Create an initial commit before pushing.");
    await requireRemote(this, remote);
    const upstream = await readOneConfig(this, `branch.${branch}.remote`);
    const mergeRef = upstream === remote ? await readOneConfig(this, `branch.${branch}.merge`) : "";
    const destination = mergeRef || `refs/heads/${branch}`;
    if (!destination.startsWith("refs/heads/") || destination.includes("\n")) {
      throw new Error("The configured destination must identify one remote branch.");
    }
    await this.git.raw(["check-ref-format", destination]);
    return {
      branch,
      head,
      remote,
      destination,
      urls: await readPushUrls(this, remote),
      upstreamRemote: upstream || null,
    };
  },
  async pushBranch(plan: BranchPushPlan, setUpstream = false): Promise<void> {
    if (await this.getInProgressOperation()) {
      throw new Error("Finish the pending Git operation before pushing the branch.");
    }
    const verified = await this.previewBranchPush(plan.remote);
    if (JSON.stringify(verified) !== JSON.stringify(plan)) {
      throw new Error("The branch or destination changed. Review the push again.");
    }
    await publishRef(this, {
      remote: plan.remote,
      ref: plan.destination,
      oid: plan.head,
      urls: verified.urls,
    });
    if (setUpstream && !plan.upstreamRemote) await configurePushedUpstream(this, plan);
  },
  async getRemoteResetTarget(): Promise<RemoteResetTarget | null> {
    const localRef = await this.git.raw(["symbolic-ref", "--quiet", "HEAD"]).catch(() => "");
    const branchRef = localRef.trimEnd();
    if (!branchRef.startsWith("refs/heads/")) return null;

    const info = await this.git.raw([
      "for-each-ref",
      "--format=%(objectname)%00%(upstream:remotename)%00%(upstream)",
      branchRef,
    ]);
    const [head, remote, ref] = info.trimEnd().split("\0");
    if (!head || !remote || remote === "." || !ref) return null;
    const commit = (
      await this.git.raw(["rev-parse", "--verify", `${ref}^{commit}`]).catch(() => "")
    ).trim();
    if (!commit) return null;
    return { branch: branchRef.slice("refs/heads/".length), head, remote, ref, commit };
  },
  async previewTagPush(name: string, remote: string): Promise<TagPushPlan> {
    const ref = `refs/tags/${name}`;
    await this.git.raw(["check-ref-format", ref]);
    const oid = await this.git.revparse(["--verify", "--end-of-options", `${ref}^{tag}`]);
    await requireRemote(this, remote);
    return { name, oid, remote, urls: await readPushUrls(this, remote) };
  },
  async pushTag(plan: TagPushPlan): Promise<void> {
    const confirmed = await this.previewTagPush(plan.name, plan.remote);
    if (JSON.stringify(confirmed) !== JSON.stringify(plan)) {
      throw new Error("The tag or destination changed. Review the push again.");
    }
    await publishRef(this, {
      remote: plan.remote,
      ref: `refs/tags/${plan.name}`,
      oid: plan.oid,
      urls: confirmed.urls,
    });
  },
} satisfies ThisType<GitContext>;

async function readOneConfig(context: GitContext, key: string): Promise<string> {
  return (await readConfigValues(context, key)).join("\n").trimEnd();
}

async function readConfigValues(context: GitContext, key: string): Promise<string[]> {
  const result = Bun.spawn(["git", "config", "--null", "--get-all", key], {
    cwd: context.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, text, errors] = await Promise.all([
    result.exited,
    result.stdout.text(),
    result.stderr.text(),
  ]);
  if (code === 1 && errors.length === 0) return [];
  if (code !== 0) throw new Error(errors.trim() || "Git could not read the push configuration.");
  return text.split("\0").slice(0, -1);
}

async function remoteNames(context: GitContext): Promise<string[]> {
  return (await context.git.raw(["remote"])).split("\n").filter(Boolean);
}

async function configuredPushOrFetchUrls(
  context: GitContext,
  remote: string,
  preferred: "url" | "pushurl",
): Promise<string[]> {
  const urls = await readConfigValues(context, `remote.${remote}.${preferred}`);
  if (urls.some((url) => url.trim() !== "")) return urls;
  const fallback = preferred === "url" ? "pushurl" : "url";
  return readConfigValues(context, `remote.${remote}.${fallback}`);
}

function trackingBranch(line: string, remotes: string[]): TrackingBranch[] {
  const [ref, symbolic, head] = line.split("\0");
  if (!ref || symbolic || !head) return [];
  const remote = remotes.find((name) => ref.startsWith(`refs/remotes/${name}/`));
  if (!remote) return [];
  const name = ref.slice(`refs/remotes/${remote}/`.length);
  return [{ remote, name, ref, head }];
}

function hasRemoteControl(text: string): boolean {
  return /\p{Cc}/u.test(text) || hasLayoutControl(text);
}

function assertRemoteAddress(url: string): void {
  if (!url.trim() || hasRemoteControl(url)) {
    throw new Error("Enter a non-empty remote URL or path without control characters.");
  }
}

async function readPushUrls(context: GitContext, remote: string): Promise<string[]> {
  const configured = await configuredPushOrFetchUrls(context, remote, "pushurl");
  if (configured.length === 0 || configured.every((url) => url.trim() === "")) {
    throw new Error("The selected remote has no push URLs.");
  }
  if (configured.some(hasRemoteControl)) {
    throw new Error("Git supplied push URLs that cannot be reviewed safely.");
  }
  const output = await context.git.raw(["remote", "get-url", "--push", "--all", "--", remote]);
  const urls = output.replace(/\n$/, "").split("\n");
  if (urls.length > configured.length || urls.some((url) => hasRemoteControl(url) || !url.trim())) {
    throw new Error("Git supplied push URLs that cannot be reviewed safely.");
  }
  return urls;
}

async function requireSameTrackingBranch(
  context: GitContext,
  target: TrackingBranch,
): Promise<void> {
  const fresh = (await context.getTrackingBranches()).find(({ ref }) => ref === target.ref);
  if (!fresh || fresh.remote !== target.remote || fresh.head !== target.head) {
    throw new Error("The tracking branch changed. Review the branch list again.");
  }
}

async function requireRemote(context: GitContext, remote: string): Promise<void> {
  if (!(await remoteNames(context)).includes(remote)) {
    throw new Error("The selected remote no longer exists.");
  }
}

async function publishRef(
  context: GitContext,
  { remote, ref, oid, urls }: { remote: string; ref: string; oid: string; urls: string[] },
): Promise<void> {
  await writeRemote(
    context,
    [
      "push",
      "--porcelain",
      "--no-follow-tags",
      "--recurse-submodules=no",
      "--",
      remote,
      `${oid}:${ref}`,
    ],
    urls,
  );
}

async function writeRemote(context: GitContext, args: string[], urls: string[]): Promise<void> {
  try {
    await context.git.raw(args);
  } catch (error) {
    if (urls.length <= 1) throw error;
    const detail = gitFailureDetail(error);
    throw new Error(
      `Some reviewed push destinations may already have changed. Verify each destination before retrying.\n${detail}`,
      { cause: error },
    );
  }
}

async function configurePushedUpstream(context: GitContext, plan: BranchPushPlan): Promise<void> {
  try {
    const fresh = await context.previewBranchPush(plan.remote);
    if (JSON.stringify(fresh) !== JSON.stringify(plan))
      throw new Error("Branch settings changed after the push.");
    const config = (await readOneConfig(context, `remote.${plan.remote}.fetch`)).split("\n");
    const branches = await context.getTrackingBranches();
    const match = branches.find(
      ({ remote, ref, head }) =>
        remote === plan.remote &&
        head === plan.head &&
        fetchSource(ref, config) === plan.destination,
    );
    if (!match) throw new Error("The remote has no matching fetch ref.");
    await context.git.raw(["branch", `--set-upstream-to=${match.ref}`, "--", plan.branch]);
  } catch (error) {
    throw new Error("The remote branch was updated, but its upstream could not be set.", {
      cause: error,
    });
  }
}
