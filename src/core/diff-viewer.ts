import { showDiffPages } from "./diff-pages";
import type { DiffRequest } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import type { DiffPort } from "./ports/workflow-git.port";

type DiffScope = DiffRequest["scope"];

export class DiffViewer {
  constructor(
    private readonly git: DiffPort,
    private readonly ui: IUI,
  ) {}

  async run(): Promise<void> {
    const scope = await this.ui.askSelect<DiffScope>("What do you want to compare?", [
      { value: "working", label: "Working files against the index (unstaged)" },
      { value: "staged", label: "Index against HEAD (staged)" },
      { value: "refs", label: "Trees of two branches" },
      { value: "merge-base", label: "Target branch against its merge base" },
    ]);
    const request =
      scope === "refs" || scope === "merge-base" ? await this.selectRefs(scope) : { scope };
    if (!request) return;
    const diff = await this.ui.spin("Loading diff...", () => this.git.readDiff(request));
    if (!diff) {
      this.ui.info("No differences for this comparison.");
      return;
    }
    await showDiffPages(this.ui, diff);
  }

  private async selectRefs(scope: "refs" | "merge-base"): Promise<DiffRequest | undefined> {
    const [{ all, current }, tracking] = await Promise.all([
      this.git.getBranches(),
      this.git.getTrackingBranches(),
    ]);
    const branches = [
      ...all.map((name) => ({
        value: `refs/heads/${name}`,
        label: name === current ? `${name} · current` : `${name} · local`,
      })),
      ...tracking.map(({ name, ref, remote }) => ({
        value: ref,
        label: `${remote}/${name} · remote`,
      })),
    ];
    if (!current && all.length > 0) branches.unshift({ value: "HEAD", label: "Detached HEAD" });
    if (branches.length < 2) {
      this.ui.info("Choose a local comparison or add another branch to compare two refs.");
      return;
    }
    const base = await this.ui.askSearchSelect("Base branch:", branches);
    const target = await this.ui.askSearchSelect(
      "Target branch:",
      branches.filter(({ value }) => value !== base),
    );
    return { scope, base, target };
  }
}
