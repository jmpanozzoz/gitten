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

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue)](https://github.com/jmpanozzoz/gitten/releases)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/jmpanozzoz/gitten/pulls)

</div>

---

`gitten` applies the Pareto principle to your Git workflow. It covers the **20% of operations that solve 80% of daily friction** — standardized branches, safe cleanup, fast cherry-picks, and one-command syncing — all through a clean, interactive terminal UI.

No config files. No dependencies to install. A single binary that just works.

---

## Features

| Command | What it does |
|---|---|
| 🌿 **New Branch** | Enforces `type/kebab-case-name` naming. Picks from `feat`, `fix`, `hotfix`, `chore`, `docs`. |
| 🧹 **Clean Branches** | Multi-select local branches to delete. Optionally removes them from origin too. Never touches `main`, `master`, `dev`, or your current branch. |
| 🍒 **Cherry Pick** | Lists the last 15 commits of any branch. Pick one, apply it. Guides you through conflicts without losing your work. |
| 🚀 **Sync** | Stage everything → commit (with your message or a default) → push. Auto-detects missing upstreams and pushes with `-u` on first push. |

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/jmpanozzoz/gitten/main/install.sh | bash
```

That's it. The script detects your OS and architecture, downloads the right binary from the latest release, and drops it at `/usr/local/bin/gitten`.

**Supported platforms:**
- macOS (Apple Silicon & Intel)
- Linux (x64 & ARM64)

**Verify the install:**
```bash
gitten --version
```

---

## Usage

Run `gitten` from any Git repository:

```
$ gitten

│
◇  🐱 Gitten — Your Git assistant
│
◇  📍 Context: my-project | branch: main
│
◆  What do you want to do?
│  ○ 🌿 New Standardized Branch
│  ○ 🧹 Clean Old Branches
│  ○ 🍒 Quick Cherry Pick
│  ● 🚀 Sync (Stage, Commit & Push)
│  ○ 🚪 Exit
```

### New Branch

```
◆  Branch type:
│  ● feat  ○ fix  ○ hotfix  ○ chore  ○ docs

◇  Short description:
│  user authentication

◒  Creating branch feat/user-authentication...
◇  ✅ Done. You are now on feat/user-authentication.
```

### Clean Branches

```
◆  Select branches to delete:
│  ◼ feat/old-experiment
│  ◼ fix/typo-header
│  ◻ chore/deps-update

◆  Also delete from origin?
│  ● Yes  ○ No

◒  Deleting branches...
◇  ✅ 2 branches deleted (local + remote).
```

---

## Architecture

`gitten` is built with Clean Architecture and strict Single Responsibility:

```
src/
├── index.ts              # Entry point
├── app.ts                # Orchestrator + main menu
├── core/                 # Business logic (the "What")
│   ├── branch-creator.ts
│   ├── branch-cleaner.ts
│   ├── cherry-picker.ts
│   └── sync-flow.ts
├── git/                  # Infrastructure (talks to Git)
│   └── git-client.ts
└── ui/                   # Presentation (talks to the human)
    ├── prompts.ts
    └── theme.ts
```

Each layer has one reason to change. Swapping the prompt library? Only `ui/` changes. Swapping `simple-git`? Only `git/` changes.

---

## Development

**Requirements:** [Bun](https://bun.sh) v1.2+

```bash
# Clone
git clone https://github.com/jmpanozzoz/gitten.git
cd gitten

# Install dependencies
bun install

# Run in dev mode (hot reload)
bun run dev

# Run tests
bun test

# Build binary
bun run build
```

Tests follow a strict TDD approach. All core logic is unit-tested with mocked Git and UI dependencies.

---

## Contributing

1. Fork the repo and create a branch from `main`.
2. Write tests first (TDD — Red → Green → Refactor).
3. Make sure `bun test` passes with no failures.
4. Open a pull request with a clear description of what and why.

Please keep pull requests focused. One feature or fix per PR.

---

## License

MIT — see [LICENSE](LICENSE) for details.
