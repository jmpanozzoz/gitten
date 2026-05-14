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
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue)](https://github.com/jmpanozzoz/gitten/releases)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-f9f1e1?logo=bun)](https://bun.sh)

</div>

---

`gitten` covers the **20% of Git operations that solve 80% of daily friction** — standardized branches, safe cleanup, fast cherry-picks, one-command syncing — all through a clean, interactive terminal UI.

No config files. No dependencies to install. A single binary that just works.

---

## Demo

```
$ gitten

│
◇  🐱 Gitten — Your Git assistant
│
◇  Context: my-api | branch: main · 3 modified · 1 ahead
│
◆  What do you want to do?
│  ● 🌿 New Standardized Branch
│  ○ 🧹 Clean Old Branches
│  ○ 🍒 Quick Cherry Pick
│  ○ 🔽 Pull Latest Changes
│  ○ 🚀 Sync (Stage, Commit & Push)
│  ○ 🔗 Manage Remotes
│  ○ 🚪 Exit
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
◇  ✔ Switched to feat/user-authentication
```

### Sync — diff preview before you commit

```
◆  3 file(s) modified. Stage, commit and push?
│  ● Yes   ○ No
│
⠸  Staging...
◇  +87 −12 lines staged
│
◇  Commit message:
│  feat: add JWT middleware
│
⠸  Committing...
⠸  Pushing...
◇  ✔ Branch pushed successfully.
```

### Pull — clear feedback on what actually changed

```
⠸  Pulling latest changes...
◇  ✔ Pulled successfully. 4 file(s) changed.
        — or —
◇  ℹ Already up to date.
```

### Clean Branches — protected branches never appear

```
◆  Select branches to delete:
│  ◼ feat/old-experiment
│  ◼ fix/typo-header
│  ◻ chore/bump-deps
│       (main, dev, master, current branch are never shown)
│
◆  Also delete from origin?
│  ● Yes   ○ No
│
◇  ✔ 2 branches deleted.
```

---

## Install

### One-liner (macOS & Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/jmpanozzoz/gitten/main/install.sh | bash
```

Detects your OS and architecture, downloads the right binary, installs to `/usr/local/bin/gitten`.

### Homebrew (macOS)

```bash
brew tap jmpanozzoz/gitten
brew install gitten
```

### Verify

```bash
gitten --version
```

**Supported platforms:** macOS Apple Silicon · macOS Intel · Linux x64 · Linux ARM64

### Update

The install script is idempotent — running it again fetches the latest release:

```bash
curl -fsSL https://raw.githubusercontent.com/jmpanozzoz/gitten/main/install.sh | bash
# → Updated: gitten v0.2.1 → gitten v0.3.0
```

---

## Features

| | What it does |
|---|---|
| 🌿 **New Branch** | Enforces `type/kebab-case-name`. Picks from `feat`, `fix`, `hotfix`, `chore`, `docs`. Prevents duplicate names. |
| 🧹 **Clean Branches** | Multi-select local branches to delete. Optionally removes from origin. Never touches `main`, `master`, `dev`, or your current branch. |
| 🍒 **Cherry Pick** | Lists last 15 commits of any branch. Pick one, apply it. Guides you through conflicts — ENTER to continue, ESC to abort. |
| 🔽 **Pull** | Pulls with upstream detection and conflict resolution. Distinguishes "already up to date" from "N files changed". |
| 🚀 **Sync** | Stage → diff preview → commit → push. Auto-detects missing upstream on first push. |
| 🔗 **Manage Remotes** | Add, change URL, or remove remotes interactively. Handles `git init` for brand new repos too. |

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
│   ├── cherry-picker.ts
│   ├── pull-flow.ts
│   ├── sync-flow.ts
│   ├── remote-manager.ts
│   └── ports/            # Interfaces for dependency injection
│       ├── git-client.port.ts
│       └── ui.port.ts
│
├── git/                  # Infrastructure — the "How" (talks to Git)
│   └── git-client.ts
│
└── ui/                   # Presentation — the "How" (talks to the human)
    ├── prompts.ts
    └── theme.ts
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
bun test       # unit tests (no real git process spawned)
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
