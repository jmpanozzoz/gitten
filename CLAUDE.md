Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.
- `Bun.$\`cmd\`` instead of execa for shell commands.

---

# Gitten — Git Facilitator CLI

## What is this?

A terminal CLI that covers the 20% of Git operations that solve 80% of daily friction. Compiled to a single binary via `bun build --compile`. UX inspiration: Claude Code's terminal interface — clean, linear, minimal, opinionated.

## Tech Stack

| Concern | Library |
|---|---|
| Prompts / spinners | `@clack/prompts` |
| Colors | `picocolors` |
| Git operations | `simple-git` |
| Runtime & build | Bun |
| Tests | `bun test` |

Never use `inquirer`, `chalk`, `execa`, `child_process`, or `ora`. Those are replaced by the stack above.

---

## Architecture — Clean Architecture + SRP

Each file has one reason to change. Layer boundaries are strict:

```
index.ts                  # Entry point (repo root): uncaught error handler, --version, → app.ts
src/
├── app.ts                # Composition root: repo/lock checks, context, menu loop, DI wiring
│
├── core/                 # BUSINESS LOGIC — the "What" (one class per file unless noted)
│   ├── ports/            #   DI interfaces (see Ports section)
│   │   ├── git-client.port.ts  # IGitClient
│   │   ├── ui.port.ts          # IUI
│   │   └── ai.port.ts          # AI callback types (suggester/reviewer/explainer/…)
│   ├── branch-creator.ts # Standardize + create branch (feat/, fix/, …); optional AI name
│   ├── branch-cleaner.ts # Local+remote delete; protected branches shown behind confirm
│   ├── branch-switcher.ts# Switch branch, auto-stash on dirty, behind-check
│   ├── cherry-picker.ts  # Single-commit cherry-pick + conflict handling; optional AI explain
│   ├── sync-flow.ts      # Stage (multi-file select) → commit → push; optional AI msg + review
│   ├── pull-flow.ts      # Merge/rebase pull + conflict handling; optional AI summary
│   ├── stash-manager.ts  # Apply/pop/drop/push stashes with diff preview
│   ├── remote-manager.ts # Init repo, list/add/update/remove remotes
│   ├── gitignore-manager.ts # Add pattern, apply templates; optional AI suggestions
│   ├── amend-flow.ts     # Amend message/files/both; optional AI message
│   ├── undo-commit.ts    # Soft/mixed reset to an earlier commit
│   ├── revert-commit.ts  # Inverse-commit revert + conflict handling
│   ├── reset-manager.ts  # Discard local changes or reset to remote; optional AI summary
│   ├── history-purge.ts  # Purge files from history (git filter-repo)
│   ├── tag-wizard.ts     # Infer semver bump, create annotated tag; optional AI changelog
│   ├── bisect-wizard.ts  # Binary search for a bad commit; optional AI explain
│   ├── worktree-manager.ts # List/add/remove worktrees
│   ├── diff-viewer.ts    # Compare branches, render diff
│   ├── conflict-resolver.ts # Shared conflict pause/continue/abort (used by 3+ flows)
│   ├── settings.ts       # Configure AI provider + limits; test AI connection
│   ├── ai-suggester.ts   # AI functions (no class): commit/branch/review/explain/summarize
│   └── protected-branches.ts # PROTECTED_BRANCHES set: main/master/dev/develop
│
├── git/                  # INFRASTRUCTURE — the "How" (talks to Git)
│   └── git-client.ts     # GitClient implements IGitClient; wraps simple-git (~50 methods)
│
├── ui/                   # PRESENTATION — the "How" (talks to the human)
│   ├── prompts.ts        # UI class wraps @clack/prompts; guards every prompt with isCancel()
│   ├── search-select.ts  # Custom searchable select / multiselect
│   ├── spinner-vocab.ts  # Themed animated spinner messages
│   ├── diff-renderer.ts  # Syntax-highlighted diff output
│   ├── go-back.ts        # GoBackSignal (thrown on cancel, caught by the menu loop)
│   └── theme.ts          # Centralized color palette via picocolors (ONLY file importing pc)
│
├── config/               # Persisted config in ~/.gitten.json
│   ├── config.ts         # AIConfig/LimitsConfig types + read/write/getActive helpers
│   └── providers.ts      # AI_PROVIDERS list (OpenAI, Anthropic, Groq, OpenRouter, xAI, Ollama, custom)
│
└── utils/
    ├── stdin-resolution.ts # Wait for ENTER/ESC during conflicts
    └── update-checker.ts   # Check GitHub Releases for a newer version

tests/
├── core/                 # One *.test.ts per core module (+ app.test.ts, sync-flow-ai/-review)
├── integration/
│   └── git-client.test.ts  # GitClient against a real temp git repo
├── utils/
│   └── update-checker.test.ts
└── mocks/
    ├── git-client.mock.ts  # implements IGitClient
    └── ui.mock.ts          # implements IUI
```

**Rules:**
- `core/` imports from `git/` and `ui/` — never the reverse.
- `git/` and `ui/` know nothing about each other.
- `app.ts` is the only file that wires all layers together.
- No layer-crossing shortcuts. If `branch-creator.ts` needs to show a message, it calls `ui/prompts.ts`, not `console.log` directly.

---

## UI/UX — Look & Feel

Modeled after Claude Code's terminal style. Linear, structured, no excessive decoration.

All user-facing strings are in **English** (see Language Convention). Real menu shape:

```
│
◇  🐱 Gitten — Your Git assistant
│
◇  repo-backend · feat/new-login · 2 ahead · +12 −3 · 4 files
│
◆  What do you want to do?
│  / type to filter...
│  ❯ 🚀 Sync
│    🔽 Pull
│    🌿 New Branch
│    🔀 Switch Branch
│    📦 Stash
│    🍒 Cherry Pick
│    🧹 Clean Branches
│    ⋯  More        (✏️ Amend · ↩ Revert · 🏷️ Tag · 🔎 Bisect · 🔍 Diff · 🗂️ Worktrees ·
│                     ⏪ Undo · ⚡ Reset · 🔗 Remotes · 🙈 .gitignore · 🔥 Purge · ⚙️ Settings)
│    🚪 Exit
```

The main menu uses a custom **searchable** select (`ui/search-select.ts`) — type to filter by label or hint. The menu runs in a loop; cancelling a sub-flow throws `GoBackSignal`, which the loop catches to return to the menu.

- Use `clack.intro`, `clack.outro`, `clack.select`, `clack.multiselect`, `clack.text`, `clack.spinner`, `clack.confirm`, `clack.log.warn`, `clack.log.error`, `clack.log.success`.
- All color definitions live in `theme.ts` only. No inline `pc.green(...)` outside of theme helpers.
- Spinners for every async operation. Never let the terminal appear frozen.
- Warnings in yellow, errors in red, success in green. Use theme constants, not magic strings.

---

## Features — Scope, Limits & Guardrails

The app ships **23 core flows**, each a class in `core/` wired into the menu in `app.ts`:
Sync, Pull, New Branch, Switch Branch, Stash, Cherry Pick, Clean Branches (main menu) and
Amend, Revert, Tag, Bisect, Diff, Worktrees, Undo, Reset, Remotes, .gitignore, Purge,
Settings (under "More"), plus shared infrastructure (conflict-resolver, ai-suggester).
The four flows documented in detail below are representative — they carry the canonical
guardrail patterns every other flow follows; see each module + its test for the rest.

**AI is optional and opt-in.** When an AI provider is configured in Settings (`~/.gitten.json`),
`app.ts` injects the matching `ai-suggester` callback into the flows that support it (commit
message + review for Sync, branch name, gitignore patterns, amend message, commit explanation,
commit summaries). Every AI call is wrapped in try/catch and never blocks the flow — if AI is
off or errors, the flow proceeds with its non-AI default.

### Global Guardrails (`app.ts`)

- **Git repo check:** On startup, `git-client.ts` checks `process.cwd()` for `.git`. If absent → offer to `git init`, otherwise exit cleanly.
- **Index lock:** If `.git/index.lock` exists → suggest `rm -f .git/index.lock`, do not crash with a stacktrace.
- **Protected branches:** `PROTECTED_BRANCHES` (`main`, `master`, `dev`, `develop`) are guarded across destructive flows (clean, amend, revert, sync).

---

### 🌿 New Branch (`branch-creator.ts`)

**Does:**
1. Ask branch type: `feat | fix | hotfix | chore | docs`
2. Ask short description (free text)
3. Build name: lowercase, spaces→hyphens, prefix with `type/`
4. `git checkout -b <name>`

**Does NOT:**
- Push the branch automatically.
- Auto-stash uncommitted changes.

**Guardrails:**
- Empty name → loop, ask again.
- Branch already exists locally → warn and abort (do not force).
- Final name is always lowercase with hyphens only (strip special chars).

**Example:** type=`feat`, desc=`"User Login "` → `feat/user-login`

---

### 🧹 Clean Branches (`branch-cleaner.ts`)

**Does:**
1. List local branches + remote-only branches (current branch excluded).
2. Show searchable multiselect with last-activity labels.
3. Delete selected local branches.
4. Ask if remote branches should also be deleted.
5. Execute remote deletes if confirmed.

**Does NOT:**
- Force-delete remote branches if the user lacks permissions (surface the error, move on).
- Analyze merge status (user decides visually).

**Guardrails:**
- **Never list the current branch (`HEAD`).**
- **Protected branches** (`main`, `master`, `dev`, `develop`) **are shown** in the list but, if any
  is selected, the flow requires an **explicit extra confirmation** before deleting it. This is the
  intended behavior (power users sometimes need to prune a stale `develop`); it is **not** a hard
  filter. See `branch-cleaner.ts` and its test for the canonical contract.
- Delete failures → yellow warning per branch, continue with the rest (no full abort).

---

### 🍒 Cherry Pick (`cherry-picker.ts`)

**Does:**
1. Ask source branch.
2. Show the recent commits of that branch (short hash + subject). The count is configurable via
   Settings (`cherryPickLogLimit`, default 30).
3. User selects one or more commits (multiselect).
4. Confirm the apply plan, then `git cherry-pick` each selected commit **oldest-first** (so original order is preserved).
5. On conflict (per commit): hand off to the shared `conflict-resolver.ts` — pause, wait for ENTER (continue) or ESC (abort).
   - ENTER → `git cherry-pick --continue`, then proceed to the next commit.
   - ESC → `git cherry-pick --abort`, and the remaining commits are skipped.

**Does NOT:**
- Implement an in-terminal conflict resolver (it pauses for the user's editor, it does not merge for them).
- Reorder or edit commits — they are applied in their original (chronological) order only.

---

### 🚀 Sync (`sync-flow.ts`)

**Does:**
1. Fetch silently, read `git status`.
2. If modified files exist: let the user multi-select which to stage (default all), show a diff
   preview, ask for a commit message (optional AI suggestion), `git commit`, `git push`.
3. If branch has no upstream: auto-run `git push -u origin <current-branch>`.

**Does NOT:**
- Stage individual hunks (file-level selection only — hunk-level is for Lazygit/Sublime Merge).

**Guardrails:**
- Committing on a protected branch warns first.
- No remote upstream → detect on push error → auto push with `-u origin`.
- Remote has unpulled changes → detect push rejection → tell the user to pull first → abort safely.
- Nothing to commit → inform the user and skip to push if the branch needs syncing.

---

## TDD Strategy

**Order of implementation:** Write tests before the implementation file exists.

Cycle: Red → Green → Refactor.

**Test anatomy (always):**
1. **Arrange:** Mock `git-client` and `ui/prompts` dependencies.
2. **Act:** Call the core function under test.
3. **Assert:** Verify the output string AND that the git mock was called with exact args N times.

**Example — `branch-creator.test.ts`:**
```ts
import { test, expect, mock } from "bun:test";

test("sanitizes branch name and calls checkoutLocalBranch once", async () => {
  const mockGit = { checkoutLocalBranch: mock(() => Promise.resolve()), getBranches: mock(() => ({ all: [] })) };
  const mockUi = { askBranchType: mock(() => "feat"), askBranchName: mock(() => "Login de Usuario ") };

  await createStandardBranch(mockGit, mockUi);

  expect(mockGit.checkoutLocalBranch).toHaveBeenCalledTimes(1);
  expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith("feat/login-de-usuario");
});
```

**Critical test cases (must exist):**
- `branch-cleaner`: the current branch (HEAD) never appears; protected branches appear but require an extra confirmation before deletion.
- `branch-creator`: Empty input loops; duplicate branch name aborts.
- `cherry-picker`: ESC during conflict calls `cherry-pick --abort`.
- `sync-flow`: Missing upstream triggers `push -u origin`.

---

## Binary Compilation & Distribution

Build command (add to `package.json` scripts):

```json
"scripts": {
  "build": "bun build ./src/index.ts --compile --outfile gitten",
  "dev": "bun --hot ./src/index.ts",
  "test": "bun test"
}
```

The output is a self-contained binary named `gitten`. No Node/Bun required on the target machine.

### Multi-platform targets

CI (GitHub Actions) must build four targets on every release tag and publish them to GitHub Releases:

| Target | Flag |
|---|---|
| macOS ARM (Apple Silicon) | `--target=bun-darwin-arm64` |
| macOS x64 (Intel) | `--target=bun-darwin-x64` |
| Linux x64 | `--target=bun-linux-x64` |
| Linux ARM64 | `--target=bun-linux-arm64` |
| Windows x64 | `--target=bun-windows-x64` |

Asset naming convention: `gitten-darwin-arm64`, `gitten-darwin-x64`, `gitten-linux-x64`, `gitten-linux-arm64`, `gitten-windows-x64.exe`.

### Install script (`install.sh`)

The repo must include an `install.sh` at the root. It is the single artifact users download. Responsibilities:

1. Detect OS (`uname -s`) and architecture (`uname -m`).
2. Resolve the correct asset name from the matrix above.
3. Download the binary from the latest GitHub Release (`https://github.com/<owner>/gitten/releases/latest/download/<asset>`).
4. Place it at `/usr/local/bin/gitten` (fallback: `~/.local/bin/gitten` if no write access).
5. `chmod +x` and verify with `gitten --version`.

**One-liner for users:**

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/gitten/main/install.sh | bash
```

The `install.sh` must be idempotent (running it twice is safe), print clear progress messages, and exit with a non-zero code on any failure — never silently succeed with a broken install.

---

## OOP Guidelines

- Each feature `core/` module exports a **class** (e.g. `BranchCreator`, `BranchCleaner`, `CherryPicker`, `SyncFlow`). The two infrastructure modules are the documented exception: `conflict-resolver.ts` exports a `resolveConflict` function and `ai-suggester.ts` exports stateless AI functions.
- Constructor receives `IGitClient` and `IUI` interfaces — plus any optional AI callback (typed in `ai.port.ts`) — via dependency injection. No direct instantiation of dependencies inside business logic.
- `git-client.ts` exports a `GitClient` class wrapping `simple-git`.
- `ui/prompts.ts` exports a `UI` class wrapping `@clack/prompts`.
- `app.ts` is the composition root: instantiates `GitClient` and `UI`, injects them into each core class, wires the menu.

This makes every class independently testable with mocks.

---

## Ports (Interfaces for DI)

`core/` must depend on **interfaces**, never on concrete classes. Define ports in `src/core/ports/`:

```
src/core/ports/
├── git-client.port.ts   # IGitClient interface
├── ui.port.ts           # IUI interface
└── ai.port.ts           # AI callback function types
```

`IGitClient` exposes everything `core/` needs across all 23 flows (~50 methods) — branches,
remotes, commits, cherry-pick, revert, merge/pull, push, staging, diffs, stash, tags, bisect,
worktrees, reset, gitignore, tracking, history purge, conflict detection, plus repo/context
helpers (`checkIsRepo`, `hasIndexLock`, `getRepoContext`). `simple-git`'s full API must not leak
into business logic — add a typed method here rather than passing raw `simple-git` calls through.

`IUI` exposes the prompt + feedback primitives used by core: `intro`, `outro`, `cancel`,
`askSelect`, `askMultiSelect`, `askSearchSelect`, `askSearchMultiSelect`, `askText`, `askConfirm`,
`spin`, `success`, `warn`, `error`, `info`, `context`.

`ai.port.ts` defines the optional AI callback types (e.g. `AICommitSuggester`, `AICommitReviewer`,
`AICommitExplainer`, `AICommitSummarizer`, `AIMessageImprover`, `AIBranchSuggester`,
`AIGitignoreSuggester`). Flows accept these as optional constructor args so they stay testable and
AI-agnostic; `app.ts` builds them from `ai-suggester.ts` + the active config and injects them.

The concrete `GitClient` and `UI` classes implement these interfaces. Mocks in `tests/mocks/`
(`git-client.mock.ts`, `ui.mock.ts`) also implement them — TypeScript will enforce the contract.

---

## Cancellation Handling (@clack/prompts)

`@clack/prompts` returns a `symbol` (not a string) when the user presses `Ctrl+C` or `ESC`. **Every** prompt call must be guarded with `isCancel()` immediately after, or the code will silently pass a symbol into string operations and produce broken output.

**Rule: wrap every prompt result before using it.**

```ts
import { text, isCancel } from "@clack/prompts";

const name = await text({ message: "Branch description:" });
if (isCancel(name)) {
  clack.cancel("Operation cancelled.");
  process.exit(0);
}
```

This guard must exist in every method of `UI` that wraps a clack prompt. The `IUI` interface methods should return `Promise<T>` (already unwrapped/validated), so `core/` never sees a raw clack result and never needs to call `isCancel()` itself. Cancellation is handled entirely inside the `UI` class.

---

## Versioning

This project uses **Semantic Versioning** (`MAJOR.MINOR.PATCH`) managed automatically by [`release-please`](https://github.com/googleapis/release-please).

### How it works

`release-please` watches every commit that lands on `main` and maintains a **Release PR** automatically. When that PR is merged, it:
1. Bumps `package.json` version
2. Updates `CHANGELOG.md`
3. Creates a git tag → triggers the existing `release.yml` workflow → publishes binaries

**No manual tagging. No manual version bumps.**

### Commit → version mapping

| Commit prefix | Bump | Example |
|---|---|---|
| `fix:` | patch `0.1.x` | `fix: correct getLog query` |
| `feat:` | minor `0.x.0` | `feat: remote management` |
| `feat!:` or `BREAKING CHANGE:` in footer | major `x.0.0` | `feat!: redesign CLI interface` |
| `chore:`, `docs:`, `test:`, `refactor:` | none (no release) | housekeeping commits |

### Rules for commit messages

- Always use [Conventional Commits](https://www.conventionalcommits.org/) format: `type(optional-scope): description`
- The description must be in English, lowercase, imperative mood ("add" not "added")
- `release-please` reads commit messages on `main` — commits that land via squash merge use the PR title, so **PR titles must also follow Conventional Commits format**

### Critical: `dev → main` PR title

The PR that merges `dev` into `main` **must** have a conventional commit title. Release-please cannot parse generic titles like `"Dev (#6)"` and will produce zero commits, skipping the release entirely.

Use the highest-impact prefix present in the batch:

```
feat: remote management, pull flow, menu loop and UX improvements
```

If multiple features landed, pick `feat:`. If only fixes, pick `fix:`. Never use freeform titles on the `dev → main` PR.

---

## Branching Strategy

- `main` — stable, released code only. Never commit directly.
- `dev` — integration branch. All feature branches merge here via PR.
- `feat/*` — new features (e.g. `feat/branch-creator`).
- `hotfix/*` — urgent fixes on top of `main`, merged back into both `main` and `dev`.
- `test/*` — experimental branches, never merged unless promoted to `feat/*`.

**Rules:**
- Always branch off `dev`, never off `main`.
- All PRs target `dev`. Never open a PR directly to `main`.
- Branch names must follow the prefixes above — no freeform names.
- `main` only receives merges from `dev` when cutting a release.

---

## Git Commits

This is a public repository. **Never add AI co-author lines** (`Co-Authored-By: Claude`, `Co-Authored-By: GitHub Copilot`, or any similar attribution) to commit messages. Commits must look like they came from the human author only.

---

## Language Convention

Everything is in English — no exceptions.

| Context | Language |
|---|---|
| Source code (identifiers, types, interfaces) | English |
| Comments and inline docs | English |
| Terminal UI strings (labels, prompts, confirmations, success/error messages) | English |
| `git` error messages surfaced to the user | English |
| Test descriptions (`test("...")`) | English |

`gitten` is a public, open-source tool targeting any developer worldwide. All user-facing strings in `@clack/prompts` calls, spinner messages, warnings, and success/error feedback must be written in English.

---

## What NOT to Build (Explicit Out-of-Scope)

Still firmly out of scope:
- No interactive conflict resolver inside the terminal. `conflict-resolver.ts` only pauses for the
  user's editor and then continues/aborts — it never merges hunks for them.
- No `git rebase -i` interactive flows. (Pull offers a rebase *strategy*; that is the limit.)
- **No GitHub/GitLab API integration (no PRs, no issues).** This is a deliberate product boundary.
- No hunk-level staging (Sync does file-level multi-select; hunks are for Lazygit/Sublime Merge).
- No plugin system.

Reality has moved past the original v1 list — keep these notes accurate:
- **Config file exists:** global config lives in `~/.gitten.json` (AI provider + limits), managed via
  Settings. A **per-repo `.gittenrc` is roadmap, not yet built** — do not assume it exists.
- **Multi-commit cherry-pick is supported** — select multiple commits; they apply oldest-first, conflicts handled per commit.
- **File-level staging exists** in Sync (multi-select), but not hunk-level.

Keep it sharp. The moment a feature requires more than ~100 lines in a single function, it's out of scope.
