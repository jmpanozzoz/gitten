import { GitClient } from "./git/git-client";
import { UI } from "./ui/prompts";
import { BranchCreator } from "./core/branch-creator";
import { BranchCleaner } from "./core/branch-cleaner";
import { CherryPicker } from "./core/cherry-picker";
import { SyncFlow } from "./core/sync-flow";
import { RemoteManager } from "./core/remote-manager";

type MenuOption = "branch" | "clean" | "cherry" | "sync" | "remotes" | "exit";

export async function app(): Promise<void> {
  const git = new GitClient();
  const ui = new UI();

  ui.intro("🐱 Gitten — Your Git assistant");

  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    const shouldInit = await ui.askConfirm("No Git repository found here. Initialize one?");
    if (!shouldInit) {
      ui.outro("Nothing to do. See you later! 👋");
      return;
    }
    await new RemoteManager(git, ui).runInit();
    ui.outro("Done. Run gitten again to manage your repo. 👋");
    return;
  }

  const hasLock = await git.hasIndexLock();
  if (hasLock) {
    ui.warn(
      "A Git lock file was detected. If Git is not running, fix it with:\n  rm -f .git/index.lock"
    );
    process.exit(1);
  }

  const repoName = process.cwd().split("/").pop() ?? "unknown";

  const handlers: Record<Exclude<MenuOption, "exit">, () => Promise<void>> = {
    branch: () => new BranchCreator(git, ui).run(),
    clean: () => new BranchCleaner(git, ui).run(),
    cherry: () => new CherryPicker(git, ui).run(),
    sync: () => new SyncFlow(git, ui).run(),
    remotes: () => new RemoteManager(git, ui).run(),
  };

  while (true) {
    const branch = await git.getCurrentBranch();
    ui.info(`Context: ${repoName} | branch: ${branch}`);

    const choice = await ui.askSelect<MenuOption>("What do you want to do?", [
      { value: "branch", label: "🌿 New Standardized Branch" },
      { value: "clean", label: "🧹 Clean Old Branches" },
      { value: "cherry", label: "🍒 Quick Cherry Pick" },
      { value: "sync", label: "🚀 Sync (Stage, Commit & Push)" },
      { value: "remotes", label: "🔗 Manage Remotes" },
      { value: "exit", label: "🚪 Exit" },
    ]);

    if (choice === "exit") break;

    await handlers[choice as Exclude<MenuOption, "exit">]();
  }

  ui.outro("See you later! 👋");
}
