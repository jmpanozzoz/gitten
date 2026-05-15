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

function bumpVersion(tag: string | null, bump: BumpType): string {
  if (!tag) return "v0.1.0";
  const clean = tag.replace(/^v/, "");
  const parts = clean.split(".").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return "v0.1.0";
  const [major, minor, patch] = parts;
  if (bump === "major") return `v${major + 1}.0.0`;
  if (bump === "minor") return `v${major}.${minor + 1}.0`;
  return `v${major}.${minor}.${patch + 1}`;
}

export class TagWizard {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async run(): Promise<void> {
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
    const suggested = bumpVersion(lastTag, bump);

    this.ui.info(
      lastTag
        ? `Last tag: ${lastTag} · ${commits.length} commit(s) since → suggested bump: ${bump}`
        : `No previous tag · ${commits.length} commit(s) → suggested: ${suggested}`
    );

    const version = await this.ui.askText("Tag name:", "v1.0.0", suggested);
    const finalVersion = version.trim() || suggested;

    const message = await this.ui.askText(
      "Annotation message:",
      `Release ${finalVersion}`,
      `Release ${finalVersion}`
    );
    const finalMessage = message.trim() || `Release ${finalVersion}`;

    await this.ui.spin(
      `Creating tag ${finalVersion}...`,
      () => this.git.createAnnotatedTag(finalVersion, finalMessage)
    );
    this.ui.success(`Tag ${finalVersion} created.`);

    const shouldPush = await this.ui.askConfirm("Push tag to remote?");
    if (shouldPush) {
      await this.ui.spin(`Pushing ${finalVersion}...`, () => this.git.pushTag(finalVersion));
      this.ui.success(`Tag ${finalVersion} pushed.`);
    }

  }
}
