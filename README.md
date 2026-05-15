<div align="center">

```
 ██████╗ ██╗████████╗████████╗███████╗███╗   ██╗
██╔════╝ ██║╚══██╔══╝╚══██╔══╝██╔════╝████╗  ██║
██║  ███╗██║   ██║      ██║   █████╗  ██╔██╗ ██║
██║   ██║██║   ██║      ██║   ██╔══╝  ██║╚██╗██║
╚██████╔╝██║   ██║      ██║   ███████╗██║ ╚████║
 ╚═════╝ ╚═╝   ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═══╝
```

**Git, the way it should feel.**

[![Latest Release](https://img.shields.io/github/v/release/jmpanozzoz/gitten?label=version&color=brightgreen)](https://github.com/jmpanozzoz/gitten/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue)](https://github.com/jmpanozzoz/gitten/releases)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-f9f1e1?logo=bun)](https://bun.sh)

</div>

---

`gitten` covers the **20% of Git operations that solve 80% of daily friction** — standardized branches, safe cleanup, fast cherry-picks, one-command syncing — all through a clean, interactive terminal UI.

No config files. No dependencies to install. A single binary that just works.

---

## Install

### macOS & Linux

```bash
curl -fsSL https://raw.githubusercontent.com/jmpanozzoz/gitten/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/jmpanozzoz/gitten/main/install.ps1 | iex
```

### Homebrew (macOS)

```bash
brew tap jmpanozzoz/gitten
brew install gitten
```

**Supported platforms:** macOS Apple Silicon · macOS Intel · Linux x64 · Linux ARM64 · Windows x64

### Verify & update

```bash
gitten --version
```

The install script is idempotent — running it again fetches the latest release and shows the delta:

```
  └  Updated v0.4.0 → v0.5.0. Run: gitten
```

---

## Demo

```
│
◇  🐱 Gitten — Your Git assistant
│
│  my-api · main · +87 −12 · 3 files
│
◆  What do you want to do?
│  ● 🚀 Sync
│  ○ 🔽 Pull
│  ○ 🌿 New Branch
│  ○ 🔀 Switch Branch
│  ○ 📦 Stash
│  ○ 🍒 Cherry Pick
│  ○ 🧹 Clean Branches
│  ○ ⋯  More
│  ○ 🚪 Exit
```

### Sync — staged diff preview, AI-assisted commit message

```
⠸  Staging...
◇  +87 −12 lines staged
│
│  +import { jwtMiddleware } from "./middleware/jwt";
│  +app.use("/api", jwtMiddleware);
│  -// TODO: add auth
│
◇  Commit message:
│  feat: add JWT middleware
│
⠸  Committing...
⠸  Pushing...
◇  ✓ Pushed to origin/feat/auth
```

### Switch Branch — real-time search filter

```
◆  Switch to branch
│  / feat_
│
│    dev
│  ❯ feat/login-page          ← matches highlighted
│    feat/user-profile
│
└  ↑↓ navigate  ·  Enter select  ·  Esc cancel
```

### New Branch — enforced naming, zero typos

```
◆  Branch type?
│  ● feat   ○ fix   ○ hotfix   ○ chore   ○ docs
│
◇  Short description:
│  user authentication
│
⠸  Creating branch...
◇  ✓ Switched to feat/user-authentication
```

### Pull — clear feedback on what actually changed

```
⠸  Pulling latest changes...
◇  ✓ Pulled. 4 file(s) changed.
       — or —
◇  ℹ Already up to date.
```

### Clean Branches — protected branches never appear

```
◆  Select branches to delete  2 selected
│  / feat_
│
│  ● feat/old-experiment
│  ❯○ feat/user-profile
│  ● fix/typo-header
│       (main, dev, master, current branch never shown)
│
└  Space toggle  ·  Enter confirm  ·  Esc cancel
```

---

## Features

### Main menu

| | What it does |
|---|---|
| 🚀 **Sync** | Stage → diff preview → optional AI code review → AI commit message → push. Auto-detects missing upstream. |
| 🔽 **Pull** | Pulls with upstream detection. Distinguishes "already up to date" from "N files changed". |
| 🌿 **New Branch** | Enforces `type/kebab-case-name`. AI-suggested names. Prevents duplicates. |
| 🔀 **Switch Branch** | Real-time search filter across all local branches. Stashes uncommitted work if needed. |
| 📦 **Stash** | Apply, pop, or drop stashes interactively. |
| 🍒 **Cherry Pick** | Lists last 15 commits of any branch. Guides through conflicts — ENTER continue, ESC abort. |
| 🧹 **Clean Branches** | Multi-select with search filter. Optionally removes from origin. Protected branches never shown. |

### More menu

| | What it does |
|---|---|
| 🗂️ **Worktrees** | List, add, and remove git worktrees. Work on multiple branches in parallel in separate directories. |
| ↩ **Undo Commit** | Search and select how far back to reset. Soft or mixed mode. |
| ⚡ **Reset** | Discard all local changes or reset to remote HEAD. |
| 🔗 **Remotes** | Add, change URL, or remove remotes. Handles `git init` for new repos. |
| 🙈 **.gitignore** | Add patterns from templates or AI-generated suggestions. |
| 🔥 **Purge History** | Remove files from the entire git history (irreversible). Real-time search filter for large repos. |
| ⚙️ **Settings** | Configure the AI provider (Anthropic / OpenAI) for smart suggestions. |

**What gitten deliberately does NOT do:** interactive rebase, hunk-level staging, GitHub API integration, config files. Sharp focus, zero configuration.

---

## Quick Guide

Five minutes to know everything. Open `gitten` and follow these flows:

---

### Starting a new piece of work

```
gitten → 🌿 New Branch
```

Pick a type (`feat`, `fix`, `hotfix`, `chore`, `docs`), type a short description.
gitten names the branch for you: `feat/user-authentication`.

**Why:** consistent names mean consistent history. `feat/`, `fix/` prefixes let release automation infer version bumps automatically.

---

### Saving and sharing your work

```
gitten → 🚀 Sync
```

Select the files you want to include, review the diff preview, type a commit message (or let AI suggest one), confirm push.
If the branch has no upstream yet, gitten sets it automatically.

**Best practice:** commit messages in [Conventional Commits](https://www.conventionalcommits.org/) format (`feat: add login`, `fix: correct redirect`). gitten uses them to calculate the next version number.

---

### Getting the latest changes

```
gitten → 🔽 Pull
```

Pulls and tells you exactly what changed ("4 files changed" or "already up to date").

**When to do it:** before starting new work and before pushing if you've been working for a while.

---

### Moving between branches

```
gitten → 🔀 Switch Branch
```

Type to filter. All local branches shown with last activity date. If you have uncommitted changes, gitten asks whether to stash them first.

---

### Picking a single commit from another branch

```
gitten → 🍒 Cherry Pick
```

Choose the source branch, pick one commit from the last 15. If there's a conflict, gitten pauses and waits: ENTER to continue, ESC to abort.

**When to use it:** a fix was made on `main` and you need it on your feature branch without merging everything.

---

### Cleaning up old branches

```
gitten → 🧹 Clean Branches
```

Multi-select with search filter. `main`, `master`, `dev`, `develop`, and the current branch never appear. Optionally delete from origin too.

**Best practice:** clean up after every PR merge. One branch per feature.

---

### Fixing the last commit

```
gitten → ⋯ More → ✏️ Amend Last Commit
```

Three modes: message only, add staged files, or both. Use it when you forgot a file or have a typo in the commit message.

**Important:** only amend commits that haven't been pushed yet, or that you're OK force-pushing (own branch only).

---

### Creating a release

```
gitten → ⋯ More → 🏷️ Tag / Release
```

gitten reads your commits since the last tag, infers the version bump (patch/minor/major from `fix:`/`feat:`/`feat!:`), pre-fills the suggested version, creates the annotated tag, and optionally pushes it.

**This is how releases work in this project:** the tag push triggers CI which builds and publishes the binaries automatically.

---

### Finding when a bug was introduced

```
gitten → ⋯ More → 🔎 Find Bug Commit (Bisect)
```

Select the last commit you know was working. gitten does a binary search: it checks out commits and asks "does this have the bug?" until it finds the exact commit that introduced it. Resets HEAD automatically when done.

**When to use it:** you know a bug exists now but not when it appeared. Faster than manual `git log` archaeology.

---

### Working on multiple things in parallel

```
gitten → ⋯ More → 🗂️ Worktrees
```

Add a worktree: choose a directory path and a branch. That branch opens in a separate directory — you can run both codebases simultaneously without stashing anything.

**When to use it:** you're in the middle of a feature and an urgent hotfix arrives. Add a worktree for `hotfix/payment-crash`, fix it there, push, and come back to your feature without touching your current work.

---

### Undoing a commit

```
gitten → ⋯ More → ↩ Undo Commit
```

Pick how far back to go. Soft reset (keeps changes staged) or mixed reset (keeps changes in working tree).

**Soft vs mixed:** use soft when you want to recommit with a different message or split into multiple commits. Use mixed when you want to review and re-stage everything from scratch.

---

### AI features (requires Settings configuration)

All AI features are **optional and clearly prompted** — gitten never calls AI without asking first.

| Prompt | What it does |
|---|---|
| "Generate commit message with AI?" | Analyzes the staged diff and suggests a conventional commit message |
| "Review staged diff with AI?" | Flags potential bugs, hardcoded values, security issues before you commit |
| In Branch Creator | Suggests a branch name slug from your description |
| In .gitignore Manager | Suggests patterns based on your tracked files |

Configure under: `gitten → ⋯ More → ⚙️ Settings`

---

## Architecture

Clean Architecture with strict Single Responsibility. Each layer has exactly one reason to change.

```
src/
├── index.ts              # Entry point — version flag + error boundaries
├── app.ts                # Composition root — wires all layers, drives menu loop
│
├── core/                 # Business logic — the "What"
│   ├── branch-creator.ts
│   ├── branch-cleaner.ts
│   ├── branch-switcher.ts
│   ├── cherry-picker.ts
│   ├── pull-flow.ts
│   ├── sync-flow.ts
│   ├── stash-manager.ts
│   ├── amend-flow.ts
│   ├── undo-commit.ts
│   ├── reset-manager.ts
│   ├── remote-manager.ts
│   ├── gitignore-manager.ts
│   ├── history-purge.ts
│   ├── worktree-manager.ts
│   ├── settings.ts
│   ├── ai-suggester.ts
│   └── ports/            # Interfaces for dependency injection
│       ├── git-client.port.ts
│       └── ui.port.ts
│
├── git/                  # Infrastructure — the "How" (talks to Git)
│   └── git-client.ts
│
└── ui/                   # Presentation — the "How" (talks to the human)
    ├── prompts.ts
    ├── search-select.ts  # Real-time search component
    ├── theme.ts
    └── go-back.ts
```

`core/` depends on `git/` and `ui/` only through interfaces — every class is independently testable with mocks.

---

## Development

**Requirements:** [Bun](https://bun.sh) v1.2+

```bash
git clone https://github.com/jmpanozzoz/gitten.git
cd gitten
bun install
bun run dev    # hot reload
bun test       # 156 unit tests, no real git process spawned
bun run build  # compile to ./gitten binary
```

Tests follow TDD: write the failing test first, make it green, refactor. All core logic is unit-tested with mocked Git and UI dependencies.

---

## Contributing

1. Branch off `dev` — never off `main`
2. Write tests first — Red → Green → Refactor
3. `bun test` must pass with zero failures
4. Open a PR targeting `dev` with a [Conventional Commits](https://www.conventionalcommits.org/) title

---

## License

MIT — see [LICENSE](LICENSE) for details.
