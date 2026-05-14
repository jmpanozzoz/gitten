import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

type RemoteAction = "add" | "change-url" | "remove" | "back";

export class RemoteManager {
  constructor(
    private readonly git: IGitClient,
    private readonly ui: IUI
  ) {}

  async runInit(): Promise<void> {
    await this.ui.spin("Initializing Git repository...", () => this.git.initRepo());
    this.ui.success("Git repository initialized.");

    const addRemote = await this.ui.askConfirm("Link a remote repository now?");
    if (addRemote) await this.addRemote();
  }

  async run(): Promise<void> {
    const remotes = await this.git.getRemotes();
    this.printRemotes(remotes);

    const action = await this.ui.askSelect<RemoteAction>("What do you want to do?", [
      { value: "add", label: "➕ Add remote" },
      { value: "change-url", label: "✏️  Change remote URL" },
      { value: "remove", label: "🗑️  Remove remote" },
      { value: "back", label: "← Back" },
    ]);

    if (action === "back") return;
    if (action === "add") return this.addRemote();
    if (action === "change-url") return this.changeUrl(remotes.map((r) => r.name));
    if (action === "remove") return this.remove(remotes.map((r) => r.name));
  }

  async addRemote(): Promise<void> {
    const name = await this.promptRemoteName("Remote name:", "origin");
    const url = await this.promptUrl();

    await this.ui.spin(`Adding remote ${name}...`, () => this.git.addRemote(name, url));
    this.ui.success(`Remote "${name}" added → ${url}`);
  }

  private async changeUrl(remoteNames: string[]): Promise<void> {
    if (remoteNames.length === 0) {
      this.ui.info("No remotes to update.");
      return;
    }

    const name = await this.ui.askSelect(
      "Which remote?",
      remoteNames.map((r) => ({ value: r, label: r }))
    );
    const url = await this.promptUrl();

    await this.ui.spin(`Updating ${name}...`, () => this.git.setRemoteUrl(name, url));
    this.ui.success(`Remote "${name}" updated → ${url}`);
  }

  private async remove(remoteNames: string[]): Promise<void> {
    if (remoteNames.length === 0) {
      this.ui.info("No remotes to remove.");
      return;
    }

    const name = await this.ui.askSelect(
      "Which remote do you want to remove?",
      remoteNames.map((r) => ({ value: r, label: r }))
    );

    const confirmed = await this.ui.askConfirm(`Remove remote "${name}"?`);
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
      this.ui.info(`${r.name}  →  ${r.url}`);
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
