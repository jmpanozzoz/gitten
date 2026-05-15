<div align="center">

```
 ██████╗ ██╗████████╗████████╗███████╗███╗   ██╗
██╔════╝ ██║╚══██╔══╝╚══██╔══╝██╔════╝████╗  ██║
██║  ███╗██║   ██║      ██║   █████╗  ██╔██╗ ██║
██║   ██║██║   ██║      ██║   ██╔══╝  ██║╚██╗██║
╚██████╔╝██║   ██║      ██║   ███████╗██║ ╚████║
 ╚═════╝ ╚═╝   ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═══╝
```

**Your opinionated Git assistant for the terminal.**

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

### Sync — AI-assisted commit message, diff preview

```
◆  3 file(s) modified. Stage, commit and push?
│
◇  Commit message:
│  feat: add JWT middleware
│
⠸  Staging...
◇  +87 −12 lines staged
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
| 🚀 **Sync** | Stage → diff preview → AI commit message → push. Auto-detects missing upstream. |
| 🔽 **Pull** | Pulls with upstream detection. Distinguishes "already up to date" from "N files changed". |
| 🌿 **New Branch** | Enforces `type/kebab-case-name`. AI-suggested names. Prevents duplicates. |
| 🔀 **Switch Branch** | Real-time search filter across all local branches. Stashes uncommitted work if needed. |
| 📦 **Stash** | Apply, pop, or drop stashes interactively. |
| 🍒 **Cherry Pick** | Lists last 15 commits of any branch. Guides through conflicts — ENTER continue, ESC abort. |
| 🧹 **Clean Branches** | Multi-select with search filter. Optionally removes from origin. Protected branches never shown. |

### More menu

| | What it does |
|---|---|
| ↩ **Undo Commit** | Search and select how far back to reset. Soft or mixed mode. |
| ⚡ **Reset** | Discard all local changes or reset to remote HEAD. |
| 🔗 **Remotes** | Add, change URL, or remove remotes. Handles `git init` for new repos. |
| 🙈 **.gitignore** | Add patterns from templates or AI-generated suggestions. |
| 🔥 **Purge History** | Remove a file from the entire git history (irreversible). |
| ⚙️ **Settings** | Configure the AI provider (Anthropic / OpenAI) for smart suggestions. |

**What gitten deliberately does NOT do:** interactive rebase, hunk-level staging, GitHub API integration, config files. Sharp focus, zero configuration.

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
│   ├── undo-commit.ts
│   ├── reset-manager.ts
│   ├── remote-manager.ts
│   ├── gitignore-manager.ts
│   ├── history-purge.ts
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
