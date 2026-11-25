import { isRepositoryFilePath } from "./domain/purge-path";
import type { IUI } from "./ports/ui.port";
import type { PurgePort } from "./ports/workflow-git.port";

export class HistoryPurge {
  constructor(
    private readonly git: PurgePort,
    private readonly ui: IUI,
  ) {}

  async run(): Promise<void> {
    if (!(await this.git.filterRepoAvailable())) {
      this.ui.error("Install git-filter-repo to create a filtered copy.");
      return;
    }
    const status = await this.git.getStatus();
    if (!status.isClean()) {
      this.ui.error("Commit or stash local changes before creating the filtered copy.");
      return;
    }
    const paths = await this.pickPaths();
    if (paths.length === 0) return;

    const { refs, absent } = await this.git.describePurge(paths);
    if (absent.length > 0 || refs.length === 0) {
      this.ui.error(
        absent.length > 0 ? `No history found for: ${absent.join(", ")}` : "No refs to rewrite.",
      );
      return;
    }
    this.ui.warn(
      `Files to remove:\n${paths.map((path) => JSON.stringify(path)).join("\n")}\n\nRefs in the copy:\n${refs.join("\n")}`,
    );
    if (
      !(await this.ui.askConfirm(
        "Create a filtered mirror? The source remains your backup.",
        false,
      ))
    )
      return;
    if (
      !(await this.ui.askConfirm("Create the mirror locally without publishing any refs?", false))
    )
      return;

    const copy = await this.ui.spin("Creating filtered mirror...", () =>
      this.git.purgeFromHistory(paths, refs),
    );
    this.ui.success(`Filtered mirror created at ${copy}.`);
    this.ui.info(
      "Review the mirror and retain it in a persistent directory before replacing any remote refs.",
    );
    this.ui.info(
      "If credentials were exposed, rotate them and coordinate cleanup of remotes and other clones.",
    );
  }

  private async pickPaths(): Promise<string[]> {
    const tracked = await this.git.getTrackedFiles();
    const selected = await this.ui.askSearchMultiSelect("Paths to remove from the mirror:", [
      ...tracked.map((path) => ({ value: path, label: path })),
      { value: "", label: "Enter a historical path…" },
    ]);
    if (!selected.includes("")) return selected;
    const path = await this.ui.askText("Exact repository-relative historical path:");
    if (!isRepositoryFilePath(path)) {
      this.ui.error("Use an exact path relative to the repository.");
      return [];
    }
    return [...new Set([...selected.filter(Boolean), path])];
  }
}
