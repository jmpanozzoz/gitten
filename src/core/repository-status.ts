import { resolveConflict } from "./conflict-resolver";
import { showDiffPages } from "./diff-pages";
import type {
  GitOperation,
  IndexEntry,
  RepositoryStatus,
  RepositoryStatusPort,
} from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

export class RepositoryStatusFlow {
  constructor(
    private readonly git: RepositoryStatusPort,
    private readonly ui: IUI,
    private readonly resumeBisect: () => Promise<void>,
  ) {}

  async run(): Promise<void> {
    const status = await this.git.describeStatus();
    const operation = await this.git.getInProgressOperation();
    this.print(status, operation);

    const options: { value: "back" | "inspect" | "unstage" | "recover"; label: string }[] = [
      { value: "back", label: "Return to menu" },
    ];
    if (status.staged.length > 0) options.push({ value: "inspect", label: "Inspect staged file" });
    if (operation) options.push({ value: "recover", label: `Resume or abort ${operation}` });
    else if (status.staged.length > 0) options.push({ value: "unstage", label: "Unstage files" });
    if (options.length === 1) return;

    const action = await this.ui.askSelect("Repository status", options);
    if (action === "inspect") await this.inspect(status.staged);
    if (action === "unstage") await this.unstage(status.staged);
    if (operation && action === "recover") await this.recover(operation);
  }

  private print(status: RepositoryStatus, operation: GitOperation | null): void {
    const { branch, upstream, ahead, behind, staged, unstaged, untracked } = status;
    const tracking = upstream ? `${upstream} · ${ahead} ahead · ${behind} behind` : "No upstream";
    this.ui.info(`${branch} · ${tracking}`);
    if (operation) this.ui.warn(`Active operation: ${operation}`);
    for (const [label, paths] of [
      ["Staged", staged.map(({ path }) => path)],
      ["Unstaged", unstaged],
      ["Untracked", untracked],
    ] as const) {
      this.ui.info(`${label} (${paths.length})${paths.length ? `\n${paths.join("\n")}` : ""}`);
    }
  }

  private async inspect(entries: IndexEntry[]): Promise<void> {
    const entry = await this.ui.askSearchSelect("Inspect staged file:", fileOptions(entries));
    const diff = await this.git.getStagedPathDiff(affectedPaths([entry]));
    if (diff) await showDiffPages(this.ui, diff);
    else this.ui.info("No staged diff remains for this selection.");
  }

  private async unstage(entries: IndexEntry[]): Promise<void> {
    const selected = await this.ui.askSearchMultiSelect("Unstage files:", fileOptions(entries));
    if (selected.length === 0) return;
    const paths = affectedPaths(selected);
    const diff = await this.git.getStagedPathDiff(paths);
    if (!diff) {
      this.ui.info("No staged diff remains for this selection.");
      return;
    }
    await showDiffPages(this.ui, diff);
    if (!(await this.ui.askConfirm("Unstage these paths and keep their working files?", false)))
      return;
    if (await this.git.getInProgressOperation()) {
      this.ui.warn("A Git operation started. Staging was left as is.");
      return;
    }
    if ((await this.git.getStagedPathDiff(paths)) !== diff) {
      this.ui.warn("Staged changes differ from the preview. Open repository status again.");
      return;
    }
    await this.git.unstagePaths(paths);
    this.ui.success(`Unstaged ${selected.length} file(s).`);
  }

  private async recover(operation: GitOperation): Promise<void> {
    if ((await this.git.getInProgressOperation()) !== operation) {
      this.ui.warn("The active Git operation changed. Open repository status again.");
      return;
    }
    if (operation === "bisect") return this.resumeBisect();
    const operations = {
      merge: [this.git.mergeContinue, this.git.mergeAbort],
      rebase: [this.git.rebaseContinue, this.git.rebaseAbort],
      "cherry-pick": [this.git.cherryPickContinue, this.git.cherryPickAbort],
      revert: [this.git.revertContinue, this.git.revertAbort],
    } as const;
    const [continueOperation, abortOperation] = operations[operation];
    await resolveConflict(this.git, this.ui, {
      operation,
      label: operation,
      onContinue: () => continueOperation.call(this.git),
      onAbort: () => abortOperation.call(this.git),
    });
  }
}

function fileOptions(entries: IndexEntry[]): { value: IndexEntry; label: string }[] {
  return entries.map((value) => ({
    value,
    label: value.previousPath ? `${value.previousPath} → ${value.path}` : value.path,
  }));
}

function affectedPaths(entries: readonly IndexEntry[]): string[] {
  return [
    ...new Set(
      entries.flatMap(({ path, previousPath }) => (previousPath ? [previousPath, path] : [path])),
    ),
  ];
}
