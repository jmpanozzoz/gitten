export type MainOption =
  | "branch"
  | "switch"
  | "clean"
  | "cherry"
  | "pull"
  | "sync"
  | "stash"
  | "push"
  | "status"
  | "more"
  | "exit";
export type MoreOption =
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
  | "log"
  | "squash";

export const moreOptions: { value: MoreOption; label: string; hints?: string[] }[] = [
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
    value: "squash",
    label: "🗜️  Squash",
    hints: ["combine", "fold", "collapse", "merge commits", "fixup", "rewrite", "tidy"],
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

export const mainOptions: { value: MainOption; label: string; hints?: string[] }[] = [
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
  {
    value: "status",
    label: "📋 Repository Status",
    hints: ["recovery", "index", "stage", "unstage", "pending", "continue", "abort"],
  },
  { value: "push", label: "⬆  Push Branch", hints: ["publish", "remote", "upload"] },
  { value: "more", label: "⋯  More" },
  { value: "exit", label: "🚪 Exit" },
];
