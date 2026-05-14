import { GitClient } from "./git/git-client";
import { UI } from "./ui/prompts";
import { BranchCreator } from "./core/branch-creator";
import { BranchCleaner } from "./core/branch-cleaner";
import { CherryPicker } from "./core/cherry-picker";
import { SyncFlow } from "./core/sync-flow";

type MenuOption = "branch" | "clean" | "cherry" | "sync" | "exit";

export async function app(): Promise<void> {
  const git = new GitClient();
  const ui = new UI();

  ui.intro("🐱 Gitten — Your Git assistant");

  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    ui.error("Not a Git repository. Run gitten from inside a project.");
    process.exit(1);
  }

  const hasLock = await git.hasIndexLock();
  if (hasLock) {
    ui.warn(
      "A Git lock file was detected. If Git is not running, fix it with:\n  rm -f .git/index.lock"
    );
    process.exit(1);
  }

  const branch = await git.getCurrentBranch();
  const repoName = process.cwd().split("/").pop() ?? "unknown";
  ui.info(`Context: ${repoName} | branch: ${branch}`);

  const choice = await ui.askSelect<MenuOption>("What do you want to do?", [
    { value: "branch", label: "🌿 New Standardized Branch" },
    { value: "clean", label: "🧹 Clean Old Branches" },
    { value: "cherry", label: "🍒 Quick Cherry Pick" },
    { value: "sync", label: "🚀 Sync (Stage, Commit & Push)" },
    { value: "exit", label: "🚪 Exit" },
  ]);

  if (choice === "exit") {
    ui.outro("See you later! 👋");
    return;
  }

  const handlers: Record<Exclude<MenuOption, "exit">, () => Promise<void>> = {
    branch: () => new BranchCreator(git, ui).run(),
    clean: () => new BranchCleaner(git, ui).run(),
    cherry: () => new CherryPicker(git, ui).run(),
    sync: () => new SyncFlow(git, ui).run(),
  };

  await handlers[choice as Exclude<MenuOption, "exit">]();

  ui.outro("Done. See you next time! 👋");
}
