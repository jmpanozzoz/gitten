import { GitClient } from "./git/git-client";
import { UI } from "./ui/prompts";
import { GoBackSignal } from "./ui/go-back";
import { BranchCreator } from "./core/branch-creator";
import { BranchCleaner } from "./core/branch-cleaner";
import { CherryPicker } from "./core/cherry-picker";
import { SyncFlow } from "./core/sync-flow";
import { RemoteManager } from "./core/remote-manager";
import { PullFlow } from "./core/pull-flow";
import { GitignoreManager } from "./core/gitignore-manager";
import { UndoCommit } from "./core/undo-commit";
import { HistoryPurge } from "./core/history-purge";
import { Settings } from "./core/settings";
import { BranchSwitcher } from "./core/branch-switcher";
import { StashManager } from "./core/stash-manager";
import { ResetManager } from "./core/reset-manager";
import { WorktreeManager } from "./core/worktree-manager";
import { AmendFlow } from "./core/amend-flow";
import { TagWizard } from "./core/tag-wizard";
import { BisectWizard } from "./core/bisect-wizard";
import { checkForUpdate } from "./utils/update-checker";
import { getActiveAIConfig } from "./config/config";
import { suggestBranchName, suggestCommitMessage, suggestGitignorePatterns, reviewStagedDiff, suggestAmendMessage } from "./core/ai-suggester";
import { theme } from "./ui/theme";
import type { IGitClient } from "./core/ports/git-client.port";
import type { IUI } from "./core/ports/ui.port";
import { version } from "../package.json";

type MainOption = "branch" | "switch" | "clean" | "cherry" | "pull" | "sync" | "stash" | "more" | "exit";
type MoreOption = "remotes" | "gitignore" | "undo" | "purge" | "settings" | "reset" | "worktree" | "amend" | "tag" | "bisect";

export async function app(
  git: IGitClient = new GitClient(),
  ui: IUI = new UI()
): Promise<void> {
  ui.intro("🐱 Gitten — Your Git assistant");

  const latestVersion = await checkForUpdate(version);
  if (latestVersion) {
    ui.info(
      `Update available: v${latestVersion} — run the install script to upgrade:\n  curl -fsSL https://raw.githubusercontent.com/jmpanozzoz/gitten/main/install.sh | bash`
    );
  }

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

  const buildSyncFlow = async () => {
    const aiConfig = await getActiveAIConfig();
    const aiSuggester = aiConfig
      ? (diff: string) => suggestCommitMessage(diff, aiConfig)
      : undefined;
    const aiReviewer = aiConfig
      ? (diff: string) => reviewStagedDiff(diff, aiConfig)
      : undefined;
    return new SyncFlow(git, ui, aiSuggester, aiReviewer).run();
  };

  const buildGitignoreManager = async () => {
    const aiConfig = await getActiveAIConfig();
    const aiSuggester = aiConfig
      ? (files: string[], existing: string[]) => suggestGitignorePatterns(files, existing, aiConfig)
      : undefined;
    return new GitignoreManager(git, ui, aiSuggester).run();
  };

  const buildAmendFlow = async () => {
    const aiConfig = await getActiveAIConfig();
    const aiSuggester = aiConfig
      ? (msg: string) => suggestAmendMessage(msg, aiConfig)
      : undefined;
    return new AmendFlow(git, ui, aiSuggester).run();
  };

  const moreHandlers: Record<MoreOption, () => Promise<void>> = {
    amend: () => buildAmendFlow(),
    tag: () => new TagWizard(git, ui).run(),
    bisect: () => new BisectWizard(git, ui).run(),
    worktree: () => new WorktreeManager(git, ui).run(),
    remotes: () => new RemoteManager(git, ui).run(),
    gitignore: () => buildGitignoreManager(),
    undo: () => new UndoCommit(git, ui).run(),
    purge: () => new HistoryPurge(git, ui).run(),
    settings: () => new Settings(ui).run(),
    reset: () => new ResetManager(git, ui).run(),
  };

  const mainHandlers: Record<Exclude<MainOption, "exit" | "more">, () => Promise<void>> = {
    branch: async () => {
      const aiConfig = await getActiveAIConfig();
      const aiSuggester = aiConfig
        ? (type: Parameters<typeof suggestBranchName>[0], desc: string) => suggestBranchName(type, desc, aiConfig)
        : undefined;
      return new BranchCreator(git, ui, aiSuggester).run();
    },
    switch: () => new BranchSwitcher(git, ui).run(),
    clean: () => new BranchCleaner(git, ui).run(),
    cherry: () => new CherryPicker(git, ui).run(),
    pull: () => new PullFlow(git, ui).run(),
    sync: () => buildSyncFlow(),
    stash: () => new StashManager(git, ui).run(),
  };

  while (true) {
    git.fetchRemote().catch(() => {}); // background — never blocks the menu
    const ctx = await git.getRepoContext();
    const parts: string[] = [`${repoName} · ${ctx.branch}`];
    if (ctx.commitsAhead > 0) parts.push(`${ctx.commitsAhead} ahead`);
    if (ctx.commitsBehind > 0) parts.push(`${ctx.commitsBehind} behind`);
    if (ctx.modifiedCount > 0) {
      parts.push(`${theme.additions(ctx.insertions)} ${theme.deletions(ctx.deletions)} · ${ctx.modifiedCount} files`);
    }
    ui.context(parts.join(" · "));

    const moreOptions: { value: MoreOption; label: string; hints?: string[] }[] = [
      { value: "amend",     label: "✏️  Amend",      hints: ["edit", "fix", "modify", "update", "rewrite", "message", "last commit"] },
      { value: "tag",       label: "🏷️  Tag",        hints: ["release", "version", "label", "mark", "v1", "publish"] },
      { value: "bisect",    label: "🔎 Bisect",      hints: ["debug", "bug", "search", "binary", "regression", "blame", "find"] },
      { value: "worktree",  label: "🗂️  Worktrees",  hints: ["workspace", "parallel", "multiple", "linked"] },
      { value: "undo",      label: "↩  Undo",        hints: ["revert", "rollback", "back", "cancel", "uncommit", "unpush"] },
      { value: "reset",     label: "⚡ Reset",        hints: ["revert", "undo", "rollback", "restore", "hard", "soft", "mixed", "discard"] },
      { value: "remotes",   label: "🔗 Remotes",     hints: ["remote", "origin", "url", "server", "github", "gitlab", "upstream"] },
      { value: "gitignore", label: "🙈 .gitignore",  hints: ["ignore", "exclude", "skip", "hide", "patterns", "untrack"] },
      { value: "purge",     label: "🔥 Purge",       hints: ["delete", "remove", "clean", "sensitive", "secret", "password", "rewrite", "bfg"] },
      { value: "settings",  label: "⚙️  Settings",   hints: ["config", "configuration", "preferences", "setup", "ai", "options"] },
    ];

    let choice: MainOption | MoreOption;
    try {
      choice = await ui.askSearchSelect<MainOption | MoreOption>("What do you want to do?", [
        { value: "sync",   label: "🚀 Sync",          hints: ["push", "commit", "add", "stage", "upload", "send", "save", "publish"] },
        { value: "pull",   label: "🔽 Pull",          hints: ["fetch", "merge", "rebase", "download", "update", "get", "integrate"] },
        { value: "branch", label: "🌿 New Branch",    hints: ["create", "new", "start", "feature", "feat", "fix", "hotfix"] },
        { value: "switch", label: "🔀 Switch Branch", hints: ["checkout", "change", "go", "move", "navigate"] },
        { value: "stash",  label: "📦 Stash",         hints: ["save", "hide", "temporary", "shelve", "wip", "draft", "store"] },
        { value: "cherry", label: "🍒 Cherry Pick",   hints: ["apply", "pick", "copy", "transfer", "port", "backport"] },
        { value: "clean",  label: "🧹 Clean Branches",hints: ["delete", "remove", "prune", "trim", "old", "merged", "archive"] },
        { value: "more",   label: "⋯  More" },
        { value: "exit",   label: "🚪 Exit" },
      ], moreOptions);
    } catch (e) {
      if (e instanceof GoBackSignal) break;
      throw e;
    }

    if (choice === "exit") break;

    try {
      if (choice === "more") {
        const more = await ui.askSelect<MoreOption>("More options:", moreOptions);
        await moreHandlers[more]();
      } else if (choice in moreHandlers) {
        await moreHandlers[choice as MoreOption]();
      } else {
        await mainHandlers[choice as Exclude<MainOption, "exit" | "more">]();
      }
    } catch (e) {
      if (e instanceof GoBackSignal) continue;
      throw e;
    }
  }

  ui.outro("See you later! 👋");
}
