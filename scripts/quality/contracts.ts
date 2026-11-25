import type { ExecutedCase } from "./test-report";

const integration = "tests/integration/git-client.test.ts";
const config = "tests/config/config.test.ts";
const terminal = "tests/integration/search-terminal.test.ts";
const prompts = "tests/integration/prompts-terminal.test.ts";

type Assertion = readonly [file: string, test: string];
type AdditionalOutcome = "cancel" | "concurrency" | "partial";
type Outcome = "success" | "failure" | AdditionalOutcome;
type Contract = Record<"success" | "failure", Assertion> &
  Partial<Record<AdditionalOutcome, Assertion>>;
export type ContractRegistry = Record<string, Contract>;

const contracts: ContractRegistry = {
  "ai/configuration": {
    success: [config, "replaces an existing settings file from a private temporary file"],
    failure: [config, "reads only validated project preferences and leaves disabled AI disabled"],
  },
  "ai/configuration-write": {
    success: [config, "replaces an existing settings file from a private temporary file"],
    failure: [config, "a failed config write preserves saved bytes and removes temporary files"],
  },
  "ai/transport": {
    success: [
      "tests/core/ai-suggester.test.ts",
      "AI actions share only their documented inputs with the connection bound for consent",
    ],
    failure: [
      "tests/core/ai-suggester.test.ts",
      "disabled AI and invalid endpoints block suggestions before sending any data",
    ],
    cancel: [
      "tests/core/sync-flow.test.ts",
      "Sync stops on cancellation of AI review or suggestion before committing",
    ],
  },
  "ai/request-screening": {
    success: [
      "tests/core/ai-suggester.test.ts",
      "AI still sends approved ordinary references to passwords and keys",
    ],
    failure: [
      "tests/core/ai-suggester.test.ts",
      "AI blocks credentials in commit messages, descriptions, and ignore data before making requests",
    ],
  },
  "ai/settings-credentials": {
    success: [
      "tests/core/settings.test.ts",
      "keeps the existing API key when left blank and never displays it in full",
    ],
    failure: [
      "tests/core/settings.test.ts",
      "editing a custom endpoint retries invalid input and does not reuse credentials for a new endpoint",
    ],
  },
  "git/branch-switch": {
    success: [
      integration,
      "switching from a same-named remote branch sets the selected upstream and stashes untracked files",
    ],
    failure: [
      integration,
      "a refused branch switch leaves staged and untracked changes recoverable in the stash",
    ],
    cancel: [
      "tests/core/branch-switcher.test.ts",
      "aborts without switching when user declines stash on dirty tree",
    ],
    concurrency: [
      "tests/core/branch-switcher.test.ts",
      "does not pull when the upstream changes during fetch or after confirmation",
    ],
  },
  "git/push-destination": {
    success: [
      "tests/integration/remote-api.test.ts",
      "publication requires configured URLs and preserves spaces in a push-only destination",
    ],
    failure: [
      "tests/integration/remote-api.test.ts",
      "remote tracking ignores symbolic and orphan refs and refuses a moved push URL",
    ],
    partial: [
      "tests/integration/remote-api.test.ts",
      "upstream setup reports changes made during a successful push",
    ],
  },
  "git/remote-settings": {
    success: [
      "tests/integration/remote-api.test.ts",
      "remote settings keep option-like names and paths literal",
    ],
    failure: [
      "tests/integration/remote-api.test.ts",
      "remote settings refuse unsafe addresses and preserve the existing configuration",
    ],
  },
  "git/remote-rewrite": {
    success: [
      "tests/integration/remote-api.test.ts",
      "a push preview resolves Git's push URL rewrite to the actual destination",
    ],
    failure: [
      "tests/integration/remote-api.test.ts",
      "publication refuses a push address made ambiguous by a Git URL rewrite",
    ],
  },
  "git/sync": {
    success: [
      integration,
      "Sync previews and commits only selected paths, preserving unrelated staging",
    ],
    failure: [
      integration,
      "a stale Sync preview and a rejected pre-commit hook leave HEAD and index unchanged",
    ],
    cancel: [integration, "Sync cancellation keeps HEAD and the index untouched"],
    concurrency: [
      integration,
      "Sync rejects a branch switched after preview and keeps the original index",
    ],
    partial: [
      integration,
      "Sync reports a rejected push with the selected commit still saved locally",
    ],
  },
  "git/sync-index": {
    success: [
      integration,
      "Sync previews and commits only selected paths, preserving unrelated staging",
    ],
    failure: [
      integration,
      "Sync exposes a recovery index when a completed commit cannot install its index",
    ],
    concurrency: [
      integration,
      "Sync keeps the original index when a hook advances HEAD after committing",
    ],
  },
  "git/commit-integrity": {
    success: [integration, "Sync and Squash keep full SHA-256 commit and recovery IDs"],
    failure: [
      integration,
      "Sync restores the confirmed branch and index if Git creates a commit with a different parent",
    ],
    partial: [
      integration,
      "Squash leaves recovery available when Git commits without reporting its ID",
    ],
  },
  "git/sync-operation": {
    success: [
      integration,
      "Sync previews and commits only selected paths, preserving unrelated staging",
    ],
    failure: [
      integration,
      "Sync leaves a merge started after preview pending with its index intact",
    ],
  },
  "git/worktrees": {
    success: [
      integration,
      "worktree add rejects invalid destinations and safely removes a detached linked checkout",
    ],
    failure: [
      integration,
      "worktree inventory preserves whitespace and prevents occupied or locked mutations",
    ],
  },
  "git/amend": {
    success: [
      integration,
      "message-only amend preserves the commit tree, staged files, and message body",
    ],
    failure: [integration, "Amend refuses staged changes modified after the displayed preview"],
    cancel: [
      "tests/core/amend-flow.test.ts",
      "declining Amend's staged preview leaves both the message and index unchanged",
    ],
    concurrency: [
      "tests/core/amend-flow.test.ts",
      "Amend refuses a changed HEAD after editing the commit subject",
    ],
  },
  "git/amend-verification": {
    success: [
      integration,
      "message-only amend preserves the commit tree, staged files, and message body",
    ],
    failure: [
      integration,
      "message-only amend restores HEAD and the exact index when a hook changes the reviewed tree or message",
    ],
    concurrency: [
      integration,
      "message-only amend leaves a branch switch performed by a hook untouched",
    ],
    partial: [
      integration,
      "message-only amend reports a partial result if a hook blocks recovery of the previous ref",
    ],
  },
  "git/tag-publication": {
    success: [
      integration,
      "Tag publishes the annotated object from the reviewed commit to the selected remote only",
    ],
    failure: [integration, "Tag refuses a replaced annotation and keeps the remote untouched"],
    partial: [
      "tests/core/tag-wizard.test.ts",
      "shows error and keeps local tag when pushTag fails",
    ],
    cancel: ["tests/core/tag-wizard.test.ts", "skips pushing tag when user declines"],
  },
  "git/tag-creation": {
    success: [
      "tests/core/tag-wizard.test.ts",
      "Tag defaults both fields for a breaking change in the body and continues with empty AI notes",
    ],
    failure: [
      "tests/core/tag-wizard.test.ts",
      "Tag stops publication when creation fails and reports the cause",
    ],
  },
  "git/discard-local": {
    success: [
      integration,
      "discardLocalChanges removes uncommitted modifications and untracked files",
    ],
    failure: [
      "tests/integration/reset-discard.test.ts",
      "Discard refuses to overwrite ignored or nested repository paths that block a tracked file",
    ],
    cancel: [
      "tests/core/reset-manager.test.ts",
      "does not discard when user declines confirmation",
    ],
    concurrency: [
      "tests/integration/reset-discard.test.ts",
      "Discard rejects an unverifiable HEAD or a changed branch and leaves reset uncalled",
    ],
    partial: [
      "tests/integration/reset-discard.test.ts",
      "Discard reports remaining paths after restoring tracked files and preserving nested repositories",
    ],
  },
  "git/reset-upstream": {
    success: [
      integration,
      "Reset applies the commit previewed from the configured remote and branch",
    ],
    failure: [
      "tests/core/reset-manager.test.ts",
      "does not offer a destructive reset when the fetch fails",
    ],
    cancel: ["tests/core/reset-manager.test.ts", "does not reset when user declines confirmation"],
    concurrency: [
      integration,
      "Reset leaves a branch moved during recovery creation untouched and reports its saved tip",
    ],
    partial: [
      integration,
      "Reset preserves the recovery ref when a locked index prevents mutation",
    ],
  },
  "git/recovery": {
    success: [
      integration,
      "the status menu continues a resolved cherry-pick and keeps pending work when dismissed",
    ],
    failure: [
      "tests/core/conflict-resolver.test.ts",
      "calls ui.error and does not propagate when onContinue throws",
    ],
    cancel: [
      "tests/core/conflict-resolver.test.ts",
      "leaves the operation pending when the recovery prompt is dismissed",
    ],
    concurrency: [
      integration,
      "recovery leaves a replacement cherry-pick pending when the original abort is confirmed",
    ],
  },
  "git/cherry-pick": {
    success: ["tests/core/cherry-picker.test.ts", "applies multiple commits oldest-first"],
    failure: [
      "tests/core/cherry-picker.test.ts",
      "blocks cherry-pick while another Git operation is pending",
    ],
    cancel: [
      "tests/core/cherry-picker.test.ts",
      "does not apply when the user declines the plan confirmation",
    ],
    concurrency: [
      integration,
      "Cherry-pick leaves both destination branches untouched when confirmation switches HEAD",
    ],
    partial: [
      "tests/core/cherry-picker.test.ts",
      "Cherry-pick reports a partial sequence on a non-conflict error and propagates cancellation",
    ],
  },
  "git/merge-rebase-abort": {
    success: [
      integration,
      "merge and rebase recovery restore the original checkout and preserve unrelated files",
    ],
    failure: [
      integration,
      "merge and rebase abort refuse to change a checkout without a pending operation",
    ],
  },
  "git/conflict-marker-check": {
    success: [
      integration,
      "staged conflict-marker detection distinguishes markers from whitespace",
    ],
    failure: [integration, "staged conflict-marker detection reports an unreadable index"],
  },
  "git/bisect": {
    success: [integration, "Bisect can skip a candidate and continue on a different commit"],
    failure: ["tests/core/bisect-wizard.test.ts", "resets bisect and shows error when start fails"],
    cancel: ["tests/core/bisect-wizard.test.ts", "calls bisectReset when user stops"],
    partial: [
      "tests/core/bisect-wizard.test.ts",
      "Bisect reports both a failed verdict and a failed reset",
    ],
  },
  "git/index-unstage": {
    success: [
      integration,
      "repository status unstages a selected rename without touching unrelated staging or working files",
    ],
    failure: [
      "tests/core/repository-status.test.ts",
      "a Git operation that starts during unstage confirmation leaves the index alone",
    ],
    cancel: [
      "tests/core/repository-status.test.ts",
      "declining an unstage preview keeps both sides of the rename staged",
    ],
    concurrency: [
      integration,
      "repository status refuses to unstage a path restaged during confirmation",
    ],
  },
  "git/pull": {
    success: [
      integration,
      "Pull reports a new empty commit and only reports up to date on the next run",
    ],
    failure: ["tests/core/pull-flow.test.ts", "rethrows unexpected pull errors"],
    cancel: [
      "tests/core/pull-flow.test.ts",
      "cancelling Pull at strategy selection leaves both integration commands uncalled",
    ],
    partial: [
      "tests/core/pull-flow.test.ts",
      "keeps a successful Pull result when summary input is missing, declined, empty, or offline",
    ],
  },
  "git/pull-result": {
    success: [
      "tests/integration/remote-api.test.ts",
      "the first Pull counts files when it gives an unborn checkout its initial commit",
    ],
    failure: [
      "tests/integration/remote-api.test.ts",
      "Pull reports a completed fetch and checkout when a hook removes HEAD",
    ],
    partial: [
      "tests/integration/remote-api.test.ts",
      "Pull reports an updated HEAD and the original error when counting changed paths fails",
    ],
  },
  "git/pull-destination": {
    success: [
      "tests/integration/remote-api.test.ts",
      "the first Pull counts files when it gives an unborn checkout its initial commit",
    ],
    failure: [
      "tests/core/pull-flow.test.ts",
      "Pull without a reviewable upstream fails before asking for a strategy",
    ],
    concurrency: [
      "tests/integration/remote-api.test.ts",
      "Pull previews the effective fetch URL and refuses a changed destination before fetching",
    ],
  },
  "git/revert": {
    success: [
      integration,
      "Revert can abort and resume a real conflict while preserving unrelated files",
    ],
    failure: [
      "tests/core/revert-commit.test.ts",
      "keeps other pending operations untouched and reports non-conflict revert failures",
    ],
    cancel: [
      "tests/core/revert-commit.test.ts",
      "aborts without reverting when user declines confirmation",
    ],
  },
  "git/history": {
    success: [
      integration,
      "Git history preserves Unicode, body lines, and the exact commit in a diff",
    ],
    failure: [integration, "an unborn checkout has an empty log page and no commit to amend"],
  },
  "git/purge": {
    success: [
      "tests/integration/purge.test.ts",
      "Purge verifies a filtered mirror of a historical literal path and preserves the original refs",
    ],
    failure: [
      "tests/integration/purge.test.ts",
      "Purge removes its temporary mirror on filter failure or failed path verification",
    ],
    cancel: [
      "tests/core/history-purge.test.ts",
      "aborts without purging when user declines second confirmation",
    ],
    concurrency: [
      integration,
      "Purge previews deleted paths and rejects a source whose refs changed after confirmation",
    ],
  },
  "git/ignore": {
    success: [
      integration,
      "Gitignore untracks only a new literal match and preserves previous ignores and working files",
    ],
    failure: [
      "tests/core/gitignore-manager.test.ts",
      "ignores blank input and rejects comments or multiline patterns before writing",
    ],
    cancel: [
      "tests/core/gitignore-manager.test.ts",
      "Escape at untrack confirmation keeps the saved pattern without reporting a failure",
    ],
    concurrency: [
      integration,
      "Gitignore leaves a newly staged edit alone when it changed during confirmation",
    ],
    partial: [
      integration,
      "Gitignore reports partial success and keeps staged files when Git cannot lock the index",
    ],
  },
  "git/push-branch": {
    success: [
      integration,
      "Push Branch sends only the previewed commit to the selected remote's configured branch",
    ],
    failure: [
      integration,
      "Push Branch reports a non-fast-forward rejection and leaves the remote branch unchanged",
    ],
    concurrency: [
      integration,
      "Push Branch rejects a stale commit and leaves the remote without refs",
    ],
    partial: [
      "tests/integration/remote-api.test.ts",
      "Push Branch reports a partial multi-URL failure after publishing to the first destination",
    ],
  },
  "git/remote-deletion": {
    success: [
      integration,
      "branch cleanup deletes only the confirmed remote branch through its fetch mapping",
    ],
    failure: [
      integration,
      "branch cleanup refuses to delete a ref advanced on the server after confirmation",
    ],
    cancel: [
      "tests/core/branch-cleaner.test.ts",
      "declines a protected branch before mutating either local or remote refs",
    ],
    partial: [
      "tests/core/branch-cleaner.test.ts",
      "continues after a local deletion fails and reports the exact partial count",
    ],
  },
  "git/force-delete-local-branch": {
    success: [
      "tests/core/branch-cleaner.test.ts",
      "requires explicit permission before forcing an unmerged local branch",
    ],
    failure: [
      "tests/core/branch-cleaner.test.ts",
      "does not offer force deletion when the unmerged branch tip cannot be read",
    ],
    cancel: [
      "tests/core/branch-cleaner.test.ts",
      "declining force deletion leaves the unmerged branch untouched",
    ],
    concurrency: [
      "tests/core/branch-cleaner.test.ts",
      "preserves a moved local branch and reports a rejected force deletion separately",
    ],
  },
  "git/undo": {
    success: [
      integration,
      "Undo follows the first parent of a merge and preserves staged and working files",
    ],
    failure: [integration, "Undo refuses to mistake a shallow boundary for the root"],
    cancel: [
      "tests/core/undo-commit.test.ts",
      "declining Undo leaves the branch and index mutation uncalled",
    ],
    concurrency: [
      integration,
      "Undo preserves both branches when recovery creation switches HEAD at the same commit",
    ],
    partial: [
      integration,
      "mixed Undo restores the original tip if the prepared index cannot be installed",
    ],
  },
  "git/squash": {
    success: [integration, "Squash through the root creates one commit with the confirmed tree"],
    failure: [
      integration,
      "a failed Squash hook restores the original tip and keeps recovery and index intact",
    ],
    cancel: [
      "tests/core/squash-flow.test.ts",
      "declining Squash on a protected branch leaves the refs unchanged",
    ],
    concurrency: [
      integration,
      "Undo and Squash reject a moved branch and retain the confirmed index state",
    ],
    partial: [
      integration,
      "Squash keeps a concurrently advanced branch and reports its recovery ref",
    ],
  },
  "git/stash": {
    success: [
      integration,
      "stash inspection and application use the captured OID and include untracked changes when selected",
    ],
    failure: [integration, "drop and pop reject an index reused by a different stash"],
    cancel: ["tests/core/stash-manager.test.ts", "aborts drop when user declines confirmation"],
    concurrency: [
      integration,
      "Stash preserves the index and working files when a new untracked path appears during review",
    ],
    partial: [
      "tests/core/stash-manager.test.ts",
      "a partial stash drop reports the count and stops on an outdated selection",
    ],
  },
  "git/diff": {
    success: [integration, "Diff separates working, staged, direct-ref and merge-base comparisons"],
    failure: ["tests/core/diff-viewer.test.ts", "ref comparisons require two available refs"],
    cancel: ["tests/core/diff-viewer.test.ts", "cancelling ref selection leaves the diff unread"],
  },
  "quality/pre-push": {
    success: [
      "tests/quality/pre-push.test.ts",
      "pre-push checks committed snapshots, deduplicates refs and blocks invalid commits",
    ],
    failure: [
      "tests/quality/pre-push.test.ts",
      "a missing dependency in a committed snapshot blocks the gate and removes the checkout",
    ],
    cancel: [
      "tests/quality/pre-push.test.ts",
      "cancelling a running snapshot stops its subprocesses and removes its linked checkout",
    ],
  },
  "quality/hook-installation": {
    success: [
      "tests/quality/entrypoints.test.ts",
      "the hook and doctor entry points work against an isolated Git directory",
    ],
    failure: [
      "tests/quality/entrypoints.test.ts",
      "hook installation preserves a configured path and any active legacy hooks",
    ],
  },
  "quality/pre-push-process": {
    success: [
      "tests/quality/pre-push.test.ts",
      "the installed pre-push runs snapshots with tool settings and without ambient credentials",
    ],
    failure: [
      "tests/quality/pre-push.test.ts",
      "the quality subprocess reports spawn failures and honours cancellation before launch",
    ],
    cancel: [
      "tests/quality/pre-push.test.ts",
      "SIGTERM cancels the pre-push entry point even while its input is open",
    ],
  },
  "quality/pre-push-history": {
    success: [
      "tests/quality/pre-push.test.ts",
      "pre-push checks each outgoing commit in order and skips history already on another remote ref",
    ],
    failure: [
      "tests/quality/pre-push.test.ts",
      "pre-push checks a ref target even when the destination already has that commit",
    ],
  },
  "quality/coverage": {
    success: [
      "tests/quality/coverage-gate.test.ts",
      "strict coverage merges the real counters for a branch exercised only in a child",
    ],
    failure: [
      "tests/quality/coverage-gate.test.ts",
      "a subprocess without counters invalidates coverage and removes the previous report",
    ],
  },
  "quality/test-inventory": {
    success: [
      "tests/quality/coverage-gate.test.ts",
      "the coverage inventory includes root TypeScript modules and tests outside the tests directory",
    ],
    failure: [
      "tests/quality/coverage-gate.test.ts",
      "test discovery rejects a suppressed test outside the tests directory",
    ],
  },
  "quality/test-execution": {
    success: [
      "tests/quality/test-report.test.ts",
      "accepts a successful report that includes every expected file",
    ],
    failure: [
      "tests/quality/coverage-gate.test.ts",
      "the quality gate rejects conditional and expected-failure tests",
    ],
  },
  "quality/architecture": {
    success: [
      "tests/quality/static.test.ts",
      "detects runtime cycles, while permitting type imports through ports",
    ],
    failure: [
      "tests/quality/static.test.ts",
      "the real static gate returns a failing status for a cross-layer dependency",
    ],
  },
  "quality/report-freshness": {
    success: [
      "tests/quality/coverage-gate.test.ts",
      "strict coverage merges the real counters for a branch exercised only in a child",
    ],
    failure: [
      "tests/quality/coverage-gate.test.ts",
      "a coverage setup failure clears both reports before running tests",
    ],
  },
  "release/packaging": {
    success: [
      "tests/quality/release-workflow.test.ts",
      "release checksums contain the five binaries and reject a missing asset before replacing the manifest",
    ],
    failure: [
      "tests/quality/release-workflow.test.ts",
      "Homebrew verifies the release identity before reading hashes and updates both formula entries atomically",
    ],
  },
  "release/rehearsal": {
    success: [
      "tests/quality/release-workflow.test.ts",
      "release rehearsal verifies the exact branch and all five binaries before producing a formula",
    ],
    failure: [
      "tests/quality/release-workflow.test.ts",
      "release rehearsal verifies the exact branch and all five binaries before producing a formula",
    ],
  },
  "release/publication": {
    success: [
      "tests/quality/release-workflow.test.ts",
      "release publication keeps an incomplete draft private and leaves an already published release untouched",
    ],
    failure: [
      "tests/quality/release-workflow.test.ts",
      "release publication keeps an incomplete draft private and leaves an already published release untouched",
    ],
  },
  "terminal/search": {
    success: [terminal, "searches pasted Unicode with spaces in a real terminal"],
    failure: [terminal, "the selector rejects piped input with an explicit terminal error"],
    cancel: [terminal, "Escape cancels and restores the cursor and terminal attributes"],
  },
  "terminal/review-text": {
    success: [
      prompts,
      "terminal review escapes Unicode layout controls and returns the original selected ref",
    ],
    failure: [
      "tests/core/terminal-text.test.ts",
      "hides embedded remote credentials from Git errors and keeps host and ref visible",
    ],
  },
  "terminal/startup": {
    success: [
      terminal,
      "the real CLI opens the menu in a Git checkout and exits through the searched action",
    ],
    failure: [
      terminal,
      "the real CLI exits before opening the menu when Git is below the minimum version",
    ],
  },
  "repository/initialization": {
    success: [terminal, "startup links the requested remote to the newly initialized repository"],
    failure: [
      "tests/core/app.test.ts",
      "reports a genuine initialization failure instead of announcing completion",
    ],
    cancel: [terminal, "Escape before initialization leaves the directory unchanged"],
    partial: [
      terminal,
      "failed remote setup reports a partial result and leaves the repository usable",
    ],
  },
  "terminal/prompts": {
    success: [
      prompts,
      "real prompts accept edited text and selections, default to No, and mask private input",
    ],
    failure: [
      prompts,
      "terminal output renders every message level, truncates diff, and distinguishes a failed task",
    ],
    cancel: [prompts, "Ctrl+D cancels every standard prompt and restores the terminal"],
  },
};

export function contractGaps(
  cases: readonly ExecutedCase[],
  expected: ContractRegistry = contracts,
): string[] {
  const evidence = new Set(
    cases
      .filter(({ assertions }) => assertions > 0)
      .map(({ file, name }) => evidenceKey(file, name)),
  );
  const gaps: string[] = [];
  for (const [contract, outcomes] of Object.entries(expected)) {
    for (const [outcome, [file, name]] of Object.entries(outcomes) as [Outcome, Assertion][]) {
      if (!evidence.has(evidenceKey(file, name)))
        gaps.push(`${contract}/${outcome} · ${file} · ${name}`);
    }
  }
  return gaps;
}

function evidenceKey(file: string, name: string): string {
  return `${file}\0${name}`;
}
