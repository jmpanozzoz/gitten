import { GoBackSignal } from "./domain/navigation";
import { redactRemoteCredentials } from "./domain/remote-display";
import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type RemoteAction = "add" | "change-url" | "remove";
type InitResult = { status: "linked" | "local-only" } | { status: "remote-failed"; error: unknown };

export class RemoteManager {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI,
  ) {}

  async runInit(): Promise<InitResult> {
    await this.ui.spin("Initializing Git repository...", () => this.git.initRepo());
    this.ui.success("Git repository initialized.");

    try {
      if (!(await this.ui.askConfirm("Link a remote repository now?")))
        return { status: "local-only" };
      await this.addRemote();
      return { status: "linked" };
    } catch (error) {
      if (error instanceof GoBackSignal) return { status: "local-only" };
      return { status: "remote-failed", error };
    }
  }

  async run(): Promise<void> {
    const remotes = await this.git.getRemotes();
    this.printRemotes(remotes);

    const action = await this.ui.askSelect<RemoteAction>("What do you want to do?", [
      { value: "add", label: "➕ Add remote" },
      { value: "change-url", label: "✏️  Change remote URL" },
      { value: "remove", label: "🗑️  Remove remote" },
    ]);

    if (action === "add") return this.addRemote();
    if (action === "change-url") return this.changeUrl(remotes.map((r) => r.name));
    return this.remove(remotes.map((r) => r.name));
  }

  async addRemote(): Promise<void> {
    const name = await this.promptRemoteName("Remote name:", "origin");
    const url = await this.promptUrl();

    await this.ui.spin(`Adding remote ${name}...`, () => this.git.addRemote(name, url));
    this.ui.success(`Remote "${name}" added → ${redactRemoteCredentials(url)}`);
  }

  private async changeUrl(remoteNames: string[]): Promise<void> {
    if (remoteNames.length === 0) {
      this.ui.info("No remotes to update.");
      return;
    }

    const name = await this.ui.askSelect(
      "Which remote?",
      remoteNames.map((r) => ({ value: r, label: r })),
    );
    const url = await this.promptUrl();

    await this.ui.spin(`Updating ${name}...`, () => this.git.setRemoteUrl(name, url));
    this.ui.success(`Remote "${name}" updated → ${redactRemoteCredentials(url)}`);
  }

  private async remove(remoteNames: string[]): Promise<void> {
    if (remoteNames.length === 0) {
      this.ui.info("No remotes to remove.");
      return;
    }

    const name = await this.ui.askSelect(
      "Which remote do you want to remove?",
      remoteNames.map((r) => ({ value: r, label: r })),
    );

    const confirmed = await this.ui.askConfirm(
      `Remove remote "${name}" and its tracking refs?`,
      false,
    );
    if (!confirmed) {
      this.ui.info("Cancelled.");
      return;
    }

    await this.ui.spin(`Removing ${name}...`, () => this.git.removeRemote(name));
    this.ui.success(`Remote "${name}" removed.`);
  }

  private printRemotes(remotes: { name: string; url: string }[]): void {
    if (remotes.length === 0) {
      this.ui.info("No remotes configured.");
      return;
    }
    for (const r of remotes) {
      this.ui.info(`${r.name}  →  ${redactRemoteCredentials(r.url)}`);
    }
  }

  private async promptRemoteName(message: string, placeholder: string): Promise<string> {
    while (true) {
      const input = await this.ui.askText(message, placeholder);
      if (input.trim().length > 0) return input.trim();
      this.ui.warn("Remote name cannot be empty.");
    }
  }

  private async promptUrl(): Promise<string> {
    while (true) {
      const input = await this.ui.askText("Remote URL:", "https://github.com/user/repo.git");
      if (input.trim().length > 0) return input.trim();
      this.ui.warn("URL cannot be empty.");
    }
  }
}
