import { bindAI } from "../ai/bind";
import { testAIConnection } from "../ai/suggester";
import {
  readConfig,
  readGlobalConfig,
  readRepoConfig,
  resolveAIConnection,
  writeConfig,
} from "../config/config";
import { AmendFlow } from "../core/amend-flow";
import { BisectWizard } from "../core/bisect-wizard";
import { BranchCleaner } from "../core/branch-cleaner";
import { BranchCreator } from "../core/branch-creator";
import { BranchSwitcher } from "../core/branch-switcher";
import { CherryPicker } from "../core/cherry-picker";
import { DiffViewer } from "../core/diff-viewer";
import { type AIConfig, getBranchPrefixes, getLimits } from "../core/domain/preferences";
import { GitignoreManager } from "../core/gitignore-manager";
import { HistoryPurge } from "../core/history-purge";
import { LogBrowser } from "../core/log-browser";
import type { IGitClient } from "../core/ports/git-client.port";
import type { IUI } from "../core/ports/ui.port";
import { PullFlow } from "../core/pull-flow";
import { PushBranch } from "../core/push-branch";
import { RemoteManager } from "../core/remote-manager";
import { RepositoryStatusFlow } from "../core/repository-status";
import { ResetManager } from "../core/reset-manager";
import { RevertCommit } from "../core/revert-commit";
import { Settings } from "../core/settings";
import { SquashFlow } from "../core/squash-flow";
import { StashManager } from "../core/stash-manager";
import { SyncFlow } from "../core/sync-flow";
import { TagWizard } from "../core/tag-wizard";
import { UndoCommit } from "../core/undo-commit";
import { WorktreeManager } from "../core/worktree-manager";
import type { MainOption, MoreOption } from "./menu-options";

type Action = () => Promise<void>;
export type MenuActions = Record<Exclude<MainOption, "exit" | "more"> | MoreOption, Action>;

interface ActionContext {
  git: IGitClient;
  ui: IUI;
  loadAI: () => Promise<ReturnType<typeof bindAI> | undefined>;
  loadPreferences: () => ReturnType<typeof readConfig>;
  loadRepositoryPreferences: () => ReturnType<typeof readRepoConfig>;
}

export function createActions(
  git: IGitClient,
  ui: IUI,
  root: string,
  readAI: () => Promise<AIConfig | null>,
): MenuActions {
  const context: ActionContext = {
    git,
    ui,
    loadPreferences: () => readConfig(root),
    loadRepositoryPreferences: () => readRepoConfig(root),
    loadAI: async () => {
      const config = await readAI();
      return config ? bindAI(config) : undefined;
    },
  };
  const extra = extraActions(context);
  return { ...mainActions(context, extra.bisect), ...extra };
}

function mainActions({ git, ui, loadAI, loadPreferences }: ActionContext, resumeBisect: Action) {
  return {
    async branch() {
      const prefixes = getBranchPrefixes(await loadPreferences());
      return new BranchCreator(git, ui, (await loadAI())?.branch, prefixes).run();
    },
    switch: () => new BranchSwitcher(git, ui).run(),
    clean: () => new BranchCleaner(git, ui).run(),
    async cherry() {
      const ai = await loadAI();
      const { cherryPickLogLimit } = getLimits(await loadPreferences());
      return new CherryPicker(git, ui, {
        aiExplainer: ai?.explain,
        aiConflictExplainer: ai?.conflict,
        logLimit: cherryPickLogLimit,
      }).run();
    },
    async pull() {
      const ai = await loadAI();
      return new PullFlow(git, ui, {
        aiSummarizer: ai?.summarize,
        aiConflictExplainer: ai?.conflict,
      }).run();
    },
    async sync() {
      const ai = await loadAI();
      return new SyncFlow(git, ui, ai?.commit, ai?.review).run();
    },
    push: () => new PushBranch(git, ui).run(),
    stash: () => new StashManager(git, ui).run(),
    status: () => new RepositoryStatusFlow(git, ui, resumeBisect).run(),
  };
}

function extraActions({
  git,
  ui,
  loadAI,
  loadPreferences,
  loadRepositoryPreferences,
}: ActionContext) {
  return {
    amend: async () => new AmendFlow(git, ui, (await loadAI())?.amend).run(),
    tag: async () => new TagWizard(git, ui, (await loadAI())?.summarize).run(),
    async bisect() {
      const ai = await loadAI();
      const { bisectLogLimit } = getLimits(await loadPreferences());
      return new BisectWizard(git, ui, ai?.explain, bisectLogLimit).run();
    },
    worktree: () => new WorktreeManager(git, ui).run(),
    remotes: () => new RemoteManager(git, ui).run(),
    gitignore: async () => new GitignoreManager(git, ui, (await loadAI())?.gitignore).run(),
    async undo() {
      const { undoCommitLimit } = getLimits(await loadPreferences());
      return new UndoCommit(git, ui, undoCommitLimit).run();
    },
    purge: () => new HistoryPurge(git, ui).run(),
    settings: () =>
      new Settings(ui, {
        read: readGlobalConfig,
        readRepository: loadRepositoryPreferences,
        write: writeConfig,
        resolveConnection: resolveAIConnection,
        testConnection: testAIConnection,
      }).run(),
    reset: async () => new ResetManager(git, ui, (await loadAI())?.summarize).run(),
    async revert() {
      const { revertLogLimit } = getLimits(await loadPreferences());
      return new RevertCommit(git, ui, {
        aiConflictExplainer: (await loadAI())?.conflict,
        logLimit: revertLogLimit,
      }).run();
    },
    diff: () => new DiffViewer(git, ui).run(),
    log: async () => new LogBrowser(git, ui, (await loadAI())?.explain).run(),
    squash: async () => new SquashFlow(git, ui, (await loadAI())?.summarize).run(),
  };
}
