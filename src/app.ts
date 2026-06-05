import { version } from "../package.json";
import type { AIConfig } from "./config/config";
import { getActiveAIConfig } from "./config/config";
import {
  explainCommitDiff,
  reviewStagedDiff,
  suggestAmendMessage,
  suggestBranchName,
  suggestCommitMessage,
  suggestGitignorePatterns,
  summarizeCommits,
} from "./core/ai-suggester";
import { AmendFlow } from "./core/amend-flow";
import { BisectWizard } from "./core/bisect-wizard";
import { BranchCleaner } from "./core/branch-cleaner";
import { BranchCreator } from "./core/branch-creator";
import { BranchSwitcher } from "./core/branch-switcher";
import { CherryPicker } from "./core/cherry-picker";
import { DiffViewer } from "./core/diff-viewer";
import { GitignoreManager } from "./core/gitignore-manager";
import { HistoryPurge } from "./core/history-purge";
import { LogBrowser } from "./core/log-browser";
import type { IGitClient } from "./core/ports/git-client.port";
import type { IUI } from "./core/ports/ui.port";
import { PullFlow } from "./core/pull-flow";
import { RemoteManager } from "./core/remote-manager";
import { ResetManager } from "./core/reset-manager";
import { RevertCommit } from "./core/revert-commit";
import { Settings } from "./core/settings";
import { StashManager } from "./core/stash-manager";
import { SyncFlow } from "./core/sync-flow";
import { TagWizard } from "./core/tag-wizard";
import { UndoCommit } from "./core/undo-commit";
import { WorktreeManager } from "./core/worktree-manager";
import { GitClient } from "./git/git-client";
import { GoBackSignal } from "./ui/go-back";
import { UI } from "./ui/prompts";
import { theme } from "./ui/theme";
import { checkForUpdate } from "./utils/update-checker";

type MainOption =
  | "branch"
  | "switch"
  | "clean"
  | "cherry"
  | "pull"
  | "sync"
  | "stash"
  | "more"
  | "exit";
type MoreOption =
  | "remotes"
  | "gitignore"
  | "undo"
  | "purge"
  | "settings"
  | "reset"
  | "worktree"
  | "amend"
  | "tag"
  | "bisect"
  | "revert"
  | "diff"
  | "log";

export async function app(
  git: IGitClient = new GitClient(),
  ui: IUI = new UI(),
  fetchAIConfig: () => Promise<AIConfig | null> = getActiveAIConfig,
  checkUpdate: (v: string) => Promise<string | null> = checkForUpdate,
): Promise<void> {
  ui.intro("🐱 Gitten — Your Git assistant");

  const latestVersion = await checkUpdate(version);
  if (latestVersion) {
    ui.info(
      `Update available: v${latestVersion} — run the install script to upgrade:\n  curl -fsSL https://raw.githubusercontent.com/jmpanozzoz/gitten/main/install.sh | bash`,
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
      "A Git lock file was detected. If Git is not running, fix it with:\n  rm -f .git/index.lock",
    );
    process.exit(1);
  }

  const repoName = process.cwd().split("/").pop() ?? "unknown";

  const buildSyncFlow = async () => {
    const aiConfig = await fetchAIConfig();
    const aiSuggester = aiConfig
      ? (diff: string) => suggestCommitMessage(diff, aiConfig)
      : undefined;
    const aiReviewer = aiConfig ? (diff: string) => reviewStagedDiff(diff, aiConfig) : undefined;
    return new SyncFlow(git, ui, aiSuggester, aiReviewer).run();
  };

  const buildGitignoreManager = async () => {
    const aiConfig = await fetchAIConfig();
    const aiSuggester = aiConfig
      ? (files: string[], existing: string[]) => suggestGitignorePatterns(files, existing, aiConfig)
      : undefined;
    return new GitignoreManager(git, ui, aiSuggester).run();
  };

  const buildAmendFlow = async () => {
    const aiConfig = await fetchAIConfig();
    const aiSuggester = aiConfig ? (msg: string) => suggestAmendMessage(msg, aiConfig) : undefined;
    return new AmendFlow(git, ui, aiSuggester).run();
  };

  const buildCherryPicker = async () => {
    const aiConfig = await fetchAIConfig();
    const aiExplainer = aiConfig ? (diff: string) => explainCommitDiff(diff, aiConfig) : undefined;
    return new CherryPicker(git, ui, undefined, aiExplainer).run();
  };

  const buildPullFlow = async () => {
    const aiConfig = await fetchAIConfig();
    const aiSummarizer = aiConfig
      ? (msgs: string[]) => summarizeCommits(msgs, aiConfig)
      : undefined;
    return new PullFlow(git, ui, undefined, aiSummarizer).run();
  };

  const buildBisectWizard = async () => {
    const aiConfig = await fetchAIConfig();
    const aiExplainer = aiConfig ? (diff: string) => explainCommitDiff(diff, aiConfig) : undefined;
    return new BisectWizard(git, ui, aiExplainer).run();
  };

  const buildTagWizard = async () => {
    const aiConfig = await fetchAIConfig();
    const aiSummarizer = aiConfig
      ? (msgs: string[]) => summarizeCommits(msgs, aiConfig)
      : undefined;
    return new TagWizard(git, ui, aiSummarizer).run();
  };

  const buildResetManager = async () => {
    const aiConfig = await fetchAIConfig();
    const aiSummarizer = aiConfig
      ? (msgs: string[]) => summarizeCommits(msgs, aiConfig)
      : undefined;
    return new ResetManager(git, ui, aiSummarizer).run();
  };

  const buildLogBrowser = async () => {
    const aiConfig = await fetchAIConfig();
    const aiExplainer = aiConfig ? (diff: string) => explainCommitDiff(diff, aiConfig) : undefined;
    return new LogBrowser(git, ui, aiExplainer).run();
  };

  const moreHandlers: Record<MoreOption, () => Promise<void>> = {
    amend: () => buildAmendFlow(),
    tag: () => buildTagWizard(),
    bisect: () => buildBisectWizard(),
    worktree: () => new WorktreeManager(git, ui).run(),
    remotes: () => new RemoteManager(git, ui).run(),
    gitignore: () => buildGitignoreManager(),
    undo: () => new UndoCommit(git, ui).run(),
    purge: () => new HistoryPurge(git, ui).run(),
    settings: () => new Settings(ui).run(),
    reset: () => buildResetManager(),
    revert: () => new RevertCommit(git, ui).run(),
    diff: () => new DiffViewer(git, ui).run(),
    log: () => buildLogBrowser(),
  };

  const mainHandlers: Record<Exclude<MainOption, "exit" | "more">, () => Promise<void>> = {
    branch: async () => {
      const aiConfig = await fetchAIConfig();
      const aiSuggester = aiConfig
        ? (type: Parameters<typeof suggestBranchName>[0], desc: string) =>
            suggestBranchName(type, desc, aiConfig)
        : undefined;
      return new BranchCreator(git, ui, aiSuggester).run();
    },
    switch: () => new BranchSwitcher(git, ui).run(),
    clean: () => new BranchCleaner(git, ui).run(),
    cherry: () => buildCherryPicker(),
    pull: () => buildPullFlow(),
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
      parts.push(
        `${theme.additions(ctx.insertions)} ${theme.deletions(ctx.deletions)} · ${ctx.modifiedCount} files`,
      );
    }
    ui.context(parts.join(" · "));

    const moreOptions: { value: MoreOption; label: string; hints?: string[] }[] = [
      {
        value: "amend",
        label: "✏️  Amend",
        hints: ["edit", "fix", "modify", "update", "rewrite", "message", "last commit"],
      },
      {
        value: "revert",
        label: "↩  Revert Commit",
        hints: ["undo", "rollback", "safe", "new commit", "cancel"],
      },
      {
        value: "tag",
        label: "🏷️  Tag",
        hints: ["release", "version", "label", "mark", "v1", "publish"],
      },
      {
        value: "bisect",
        label: "🔎 Bisect",
        hints: ["debug", "bug", "search", "binary", "regression", "blame", "find"],
      },
      {
        value: "diff",
        label: "🔍 Diff",
        hints: ["compare", "branch", "changes", "difference", "versus", "vs"],
      },
      {
        value: "log",
        label: "📜 Log",
        hints: ["history", "commits", "browse", "show", "explore", "inspect", "view"],
      },
      {
        value: "worktree",
        label: "🗂️  Worktrees",
        hints: ["workspace", "parallel", "multiple", "linked"],
      },
      {
        value: "undo",
        label: "⏪ Undo",
        hints: ["uncommit", "unpush", "back", "cancel", "reset soft"],
      },
      {
        value: "reset",
        label: "⚡ Reset",
        hints: ["rollback", "restore", "hard", "soft", "mixed", "discard", "origin"],
      },
      {
        value: "remotes",
        label: "🔗 Remotes",
        hints: ["remote", "origin", "url", "server", "github", "gitlab", "upstream"],
      },
      {
        value: "gitignore",
        label: "🙈 .gitignore",
        hints: ["ignore", "exclude", "skip", "hide", "patterns", "untrack"],
      },
      {
        value: "purge",
        label: "🔥 Purge",
        hints: ["delete", "remove", "clean", "sensitive", "secret", "password", "rewrite", "bfg"],
      },
      {
        value: "settings",
        label: "⚙️  Settings",
        hints: ["config", "configuration", "preferences", "setup", "ai", "options", "limits"],
      },
    ];

    let choice: MainOption | MoreOption;
    try {
      choice = await ui.askSearchSelect<MainOption | MoreOption>(
        "What do you want to do?",
        [
          {
            value: "sync",
            label: "🚀 Sync",
            hints: ["push", "commit", "add", "stage", "upload", "send", "save", "publish"],
          },
          {
            value: "pull",
            label: "🔽 Pull",
            hints: ["fetch", "merge", "rebase", "download", "update", "get", "integrate"],
          },
          {
            value: "branch",
            label: "🌿 New Branch",
            hints: ["create", "new", "start", "feature", "feat", "fix", "hotfix"],
          },
          {
            value: "switch",
            label: "🔀 Switch Branch",
            hints: ["checkout", "change", "go", "move", "navigate"],
          },
          {
            value: "stash",
            label: "📦 Stash",
            hints: ["save", "hide", "temporary", "shelve", "wip", "draft", "store"],
          },
          {
            value: "cherry",
            label: "🍒 Cherry Pick",
            hints: ["apply", "pick", "copy", "transfer", "port", "backport"],
          },
          {
            value: "clean",
            label: "🧹 Clean Branches",
            hints: ["delete", "remove", "prune", "trim", "old", "merged", "archive"],
          },
          { value: "more", label: "⋯  More" },
          { value: "exit", label: "🚪 Exit" },
        ],
        moreOptions,
      );
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
