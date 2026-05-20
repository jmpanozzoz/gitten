import type { IGitClient, CommitSummary } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type BumpType = "major" | "minor" | "patch";

function inferBump(commits: CommitSummary[]): BumpType {
  for (const { message } of commits) {
    if (message.startsWith("feat!:") || message.includes("BREAKING CHANGE")) return "major";
  }
  for (const { message } of commits) {
    if (message.startsWith("feat:") || message.startsWith("feat(")) return "minor";
  }
  return "patch";
}

function bumpVersion(base: string | null, bump: BumpType): string {
  if (!base) return "v0.1.0";
  const clean = base.replace(/^v/, "");
  const parts = clean.split(".").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return "v0.1.0";
  const [major, minor, patch] = parts as [number, number, number];
  if (bump === "major") return `v${major + 1}.0.0`;
  if (bump === "minor") return `v${major}.${minor + 1}.0`;
  return `v${major}.${minor}.${patch + 1}`;
}

export type AICommitSummarizer = (messages: string[]) => Promise<string | null>;

export class TagWizard {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
    private readonly aiSummarizer?: AICommitSummarizer
  ) {}

  async run(): Promise<void> {
    const pkgVersion = await this.git.getPackageVersion();
    const lastTag = await this.git.getLastTag();
    const branch = await this.git.getCurrentBranch();
    const commits = lastTag
      ? await this.git.getLogSince(lastTag)
      : await this.git.getLog(branch, 1000);

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
      `Current version (${baseLabel}) · ${commits.length} commit(s) → suggested: ${suggested} (${bump})`
    );

    if (this.aiSummarizer) {
      try {
        const notes = await this.ui.spin("Generating release notes...", () =>
          this.aiSummarizer!(commits.map((c) => c.message))
        );
        if (notes) this.ui.info(`✨ What's in this release:\n${notes}`);
      } catch { /* non-blocking */ }
    }

    const version = await this.ui.askText("Tag name:", suggested, suggested);
    const finalVersion = version.trim() || suggested;

    if (!/^v?\d+\.\d+\.\d+/.test(finalVersion)) {
      this.ui.error(`"${finalVersion}" is not a valid semver tag (expected format: v1.2.3).`);
      return;
    }

    const message = await this.ui.askText(
      "Annotation message:",
      `Release ${finalVersion}`,
      `Release ${finalVersion}`
    );
    const finalMessage = message.trim() || `Release ${finalVersion}`;

    try {
      await this.ui.spin(
        `Creating tag ${finalVersion}...`,
        () => this.git.createAnnotatedTag(finalVersion, finalMessage)
      );
    } catch (err) {
      this.ui.error(`Failed to create tag: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.ui.success(`Tag ${finalVersion} created.`);

    const shouldPush = await this.ui.askConfirm("Push tag to remote?");
    if (shouldPush) {
      try {
        await this.ui.spin(`Pushing ${finalVersion}...`, () => this.git.pushTag(finalVersion));
        this.ui.success(`Tag ${finalVersion} pushed.`);
      } catch (err) {
        this.ui.error(`Push failed: ${err instanceof Error ? err.message : String(err)}`);
        this.ui.info(`Tag was created locally. Push manually with: git push origin ${finalVersion}`);
      }
    }
  }
}
