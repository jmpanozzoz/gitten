import { confirmAISend } from "./ai-consent";
import { GoBackSignal } from "./domain/navigation";
import type { AICommitSummarizer } from "./ports/ai.port";
import type { CommitSummary } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import type { TagPort } from "./ports/workflow-git.port";
import { choosePushRemote, formatPushDestination } from "./push-destination";

type BumpType = "major" | "minor" | "patch";

const releaseVersion =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;

function inferBump(commits: CommitSummary[]): BumpType {
  for (const { message, body } of commits) {
    if (/^[a-z]+(?:\([^()]+\))?!:/.test(message)) return "major";
    if (`${message}\n${body ?? ""}`.includes("BREAKING CHANGE")) return "major";
  }
  for (const { message } of commits) {
    if (message.startsWith("feat:") || message.startsWith("feat(")) return "minor";
  }
  return "patch";
}

function bumpVersion(base: string | null, bump: BumpType): string {
  const parsed = base && parseVersion(base);
  if (!parsed) return "v0.1.0";
  const [major, minor, patch] = parsed;
  if (bump === "major") return `v${major + 1n}.0.0`;
  if (bump === "minor") return `v${major}.${minor + 1n}.0`;
  return `v${major}.${minor}.${patch + 1n}`;
}

function parseVersion(value: string): [bigint, bigint, bigint] | null {
  const parsed = releaseVersion.exec(value);
  if (!parsed) return null;
  const [, major, minor, patch, prerelease] = parsed;
  if (prerelease?.split(".").some((identifier) => /^0\d+$/.test(identifier))) return null;
  return [BigInt(major!), BigInt(minor!), BigInt(patch!)];
}

export class TagWizard {
  constructor(
    private readonly git: TagPort,
    private readonly ui: IUI,
    private readonly aiSummarizer?: AICommitSummarizer,
  ) {}

  async run(): Promise<void> {
    const head = await this.git.getLastCommit().catch(() => null);
    if (!head) {
      this.ui.info("Create a commit before tagging a release.");
      return;
    }
    const pkgVersion = await this.git.getPackageVersion();
    const lastTag = await this.git.getLastTag(head.hash);
    const commits = lastTag
      ? await this.git.getLogSince(lastTag, head.hash)
      : await this.git.getLog(head.hash, 1000);

    if (commits.length === 0) {
      this.ui.info("No new commits since the last tag. Nothing to release.");
      return;
    }

    const bump = inferBump(commits);
    const base = pkgVersion ?? lastTag;
    const suggested = bumpVersion(base, bump);

    const baseLabel = pkgVersion
      ? `package.json: ${pkgVersion}`
      : lastTag
        ? `last tag: ${lastTag}`
        : "no previous version";
    this.ui.info(
      `Current version (${baseLabel}) · ${commits.length} commit(s) → suggested: ${suggested} (${bump})`,
    );

    await this.showReleaseNotes(commits);
    const tag = await this.createTag(suggested, head.hash);
    if (tag) await this.maybePush(tag);
  }

  private async showReleaseNotes(commits: CommitSummary[]): Promise<void> {
    if (
      this.aiSummarizer &&
      (await confirmAISend(this.ui, "the commit messages for release notes", this.aiSummarizer))
    ) {
      try {
        const notes = await this.ui.spin("Generating release notes...", () =>
          this.aiSummarizer!(commits.map((c) => c.message)),
        );
        if (notes) this.ui.info(`✨ What's in this release:\n${notes}`);
      } catch {
        /* non-blocking */
      }
    }
  }

  private async createTag(suggested: string, head: string): Promise<string | null> {
    const version = await this.ui.askText("Tag name:", suggested, suggested);
    const finalVersion = version.trim() || suggested;

    if (!parseVersion(finalVersion)) {
      this.ui.error(`"${finalVersion}" is not a valid semver tag (expected format: v1.2.3).`);
      return null;
    }

    const message = await this.ui.askText(
      "Annotation message:",
      `Release ${finalVersion}`,
      `Release ${finalVersion}`,
    );
    const finalMessage = message.trim() || `Release ${finalVersion}`;

    this.ui.info(`Tag ${finalVersion} at commit ${head.slice(0, 12)}.`);
    try {
      await this.ui.spin(`Creating tag ${finalVersion}...`, () =>
        this.git.createAnnotatedTag(finalVersion, finalMessage, head),
      );
    } catch (err) {
      this.ui.error(`Failed to create tag: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    this.ui.success(`Tag ${finalVersion} created.`);

    return finalVersion;
  }

  private async maybePush(name: string): Promise<void> {
    try {
      const remote = await choosePushRemote(this.ui, await this.git.getRemotes());
      if (!remote) {
        this.ui.info("Tag saved locally. Add a remote before pushing.");
        return;
      }
      const plan = await this.git.previewTagPush(name, remote);
      this.ui.info(formatPushDestination(plan.oid, `refs/tags/${name}`, remote, plan.urls));
      if (!(await this.ui.askConfirm(`Push tag ${name} to ${remote}?`, false))) return;
      await this.ui.spin(`Pushing ${name}...`, () => this.git.pushTag(plan));
      this.ui.success(`Tag ${name} pushed to ${remote}.`);
    } catch (error) {
      if (error instanceof GoBackSignal) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      this.ui.error(`Push failed: ${detail}`);
      this.ui.info("Tag saved locally. Check the remote before retrying.");
    }
  }
}
