import { showDiffPages } from "./diff-pages";
import { explainDiff } from "./explain-diff";
import type { AICommitExplainer } from "./ports/ai.port";
import type { LogPage } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import type { LogPort } from "./ports/workflow-git.port";

const LOG_LIMIT = 30;

export class LogBrowser {
  constructor(
    private readonly git: LogPort,
    private readonly ui: IUI,
    private readonly aiExplainer?: AICommitExplainer,
  ) {}

  async run(): Promise<void> {
    let number = 0;
    let page = await this.load(number);
    const head = page.head ?? undefined;
    if (page.commits.length === 0) {
      this.ui.info("No commits to show.");
      return;
    }
    while (true) {
      const choice = await this.pick(page, number);
      if (choice === "older" || choice === "newer") {
        number += choice === "older" ? 1 : -1;
        page = await this.load(number, head);
      } else {
        await this.inspect(choice);
      }
    }
  }

  private load(number: number, head?: string): Promise<LogPage> {
    return this.ui.spin("Loading history...", () =>
      this.git.readLogPage({ head, limit: LOG_LIMIT, offset: number * LOG_LIMIT }),
    );
  }

  private pick(page: LogPage, number: number): Promise<string> {
    const options = page.commits.map(({ hash, message }) => ({
      value: hash,
      label: `${hash.slice(0, 12)} — ${message}`,
    }));
    if (number > 0) options.push({ value: "newer", label: "Newer commits" });
    if (page.hasNext) options.push({ value: "older", label: "Older commits" });
    return this.ui.askSearchSelect(`History page ${number + 1} — select a commit:`, options);
  }

  private async inspect(hash: string): Promise<void> {
    const diff = await this.ui.spin("Loading commit...", () => this.git.getCommitDiff(hash));

    if (!diff) {
      this.ui.info("No changes in this commit.");
      return;
    }

    await showDiffPages(this.ui, diff);

    await explainDiff(
      this.ui,
      async () => diff,
      "the commit diff for explanation",
      this.aiExplainer,
    );
  }
}
