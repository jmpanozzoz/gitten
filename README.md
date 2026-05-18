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

## Table of Contents

- [Why gitten?](#why-gitten)
- [Install](#install)
- [Demo](#demo)
- [Quickstart — gitten vs native Git](#quickstart--gitten-vs-native-git)
- [Features](#features)
- [Quick Guide](#quick-guide)
- [Architecture](#architecture)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Why gitten?

Git is powerful. It is also a command-line tool designed by kernel engineers for kernel engineers, and its daily-use ergonomics show it.

Here is what the average developer types before lunch on a normal workday:

```bash
git checkout -b feat/user-auth        # hope the name format is right
git add .
git diff --staged                     # review what I'm about to commit
git commit -m "feat: add user auth"   # conventional commits? which prefix again?
git push                              # "fatal: no upstream branch" — now what?
git push --set-upstream origin feat/user-auth
git log other-branch --oneline        # need to cherry-pick that one fix
git cherry-pick a3f91bc
# CONFLICT — now manually editing files + running git cherry-pick --continue
git branch                            # which branches can I delete?
git branch -d feat/old-thing
git push origin --delete feat/old-thing   # don't forget the remote!
```

That is 12 commands to do 4 conceptual operations. Each one requires you to remember flags, formats, and sequences — and one wrong move means a conflict, a broken branch, or accidental data loss.

**gitten collapses each of those operations into a single interactive flow:**

- Type `gitten`, pick from a menu, answer two questions, done.
- Branch names are enforced and formatted for you.
- Diff preview before every commit.
- Missing upstream is detected and fixed automatically.
- Protected branches (`main`, `dev`, `master`) can never be accidentally deleted.
- Conflicts are guided step-by-step — no googling the recovery command.

It is not a replacement for Git. It is the interface Git never had.

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

## Quickstart — gitten vs native Git

This section walks through the most common daily workflows side by side. Each example shows what you would type in raw Git and what you do in gitten instead.

> **TL;DR:** gitten replaces multi-step command sequences with a single interactive flow. You answer questions; gitten runs the commands.

---

### 1 · Start a new piece of work

**With raw Git:**
```bash
# You have to remember the naming convention yourself
git checkout -b feat/user-authentication
# Did I spell it right? Is the format correct? Did I use the right prefix?
```

**With gitten:**
```
gitten → 🌿 New Branch
  ◆  Branch type?   ● feat
  ◇  Description:   user authentication
  ✓  Switched to feat/user-authentication
```

**What gitten handles for you:**
- Enforces `type/kebab-case` format automatically.
- Lowercases and strips special characters from your description.
- Warns you if the branch already exists instead of silently overwriting.
- AI can suggest the branch name slug from a free-text description.

---

### 2 · Save and share your work

**With raw Git:**
```bash
git add .
git diff --staged        # manually review what you're committing
git commit -m "..."      # remember conventional commits format
git push
# Fatal: The current branch has no upstream branch.
git push --set-upstream origin feat/user-authentication
```

That's 4–5 commands in the best case, 6 when the upstream is missing (which it always is on a new branch).

**With gitten:**
```
gitten → 🚀 Sync
  ◇  +42 −3 lines staged
  │  +import { jwtMiddleware } ...    ← diff preview built-in
  ◇  Commit message: feat: add JWT middleware
  ✓  Pushed to origin/feat/user-authentication
```

**What gitten handles for you:**
- Stages all changes.
- Shows a diff preview before you commit — no `git diff --staged` needed.
- Detects a missing upstream and runs `push -u origin` automatically.
- Detects if the remote has unpulled changes and tells you to pull first instead of silently failing.
- AI can generate a conventional commit message from the diff.

---

### 3 · Get the latest changes

**With raw Git:**
```bash
git pull
# 2 files changed, 14 insertions(+), 3 deletions(-)
# Already up to date.
# (both outputs look similar, easy to miss which one you got)
```

**With gitten:**
```
gitten → 🔽 Pull
  ✓  Pulled. 4 file(s) changed.
      — or —
  ℹ  Already up to date.
```

The difference is cosmetic but meaningful: gitten makes the two states visually distinct so you always know whether something actually changed.

---

### 4 · Switch branches with uncommitted work

**With raw Git:**
```bash
git stash                          # save work-in-progress manually
git checkout other-branch
# ... do stuff ...
git checkout feat/user-authentication
git stash pop                      # remember to restore — easy to forget
```

**With gitten:**
```
gitten → 🔀 Switch Branch
  ◆  You have uncommitted changes. Stash them?  ● Yes
  / feat_                          ← type to filter all branches
  ✓  Switched to feat/login-page
  ✓  Stash restored automatically on return
```

**What gitten handles for you:**
- Real-time search filter across all branches — no more typing full names.
- Detects uncommitted work and offers to stash it before switching.
- Stash is restored when you come back, so nothing is silently lost.

---

### 5 · Grab a single commit from another branch

**With raw Git:**
```bash
git log other-branch --oneline     # find the hash — scroll through history
# a3f91bc feat: fix payment rounding error
git cherry-pick a3f91bc
# CONFLICT (content): Merge conflict in src/payment.ts
# After fixing: git cherry-pick --continue   — or —   git cherry-pick --abort
```

The sequence itself is not hard — but remembering `--continue` vs `--abort` under pressure, while you have a conflict open, is annoying.

**With gitten:**
```
gitten → 🍒 Cherry Pick
  ◆  Source branch:  fix/payment-rounding
  ◆  Pick a commit:
     a3f91bc  feat: fix payment rounding error   ← last 15 shown
  ⚠  Conflict detected. Resolve it, then:
     ENTER to continue  ·  ESC to abort
  ✓  Cherry-pick applied.
```

**What gitten handles for you:**
- Lists the last 15 commits of any branch — no hash hunting.
- Pauses on conflict with clear instructions instead of leaving you with a broken state.
- ENTER runs `cherry-pick --continue`, ESC runs `cherry-pick --abort`.

---

### 6 · Delete old branches safely

**With raw Git:**
```bash
git branch                         # list everything
git branch -d feat/old-thing       # local delete
git push origin --delete feat/old-thing   # remote delete (easy to forget)
# Repeat for every branch you want to clean up
# Nothing stops you from deleting main or dev
```

**With gitten:**
```
gitten → 🧹 Clean Branches
  ◆  Select branches to delete  (main, dev, master, current: never shown)
  │  ● feat/old-experiment
  │  ● fix/typo-header
  ◇  Also delete from origin?  ● Yes
  ✓  Deleted 2 local + 2 remote branches.
```

**What gitten handles for you:**
- `main`, `master`, `dev`, `develop`, and the current branch are **hard-filtered** — they never appear in the list.
- Multi-select with a search filter — clean 10 branches in one pass.
- Remote deletion is a single follow-up question, not a separate command per branch.
- Per-branch errors are warnings, not full aborts — if one remote delete fails (e.g. no permissions), the rest still complete.

---

### 7 · Find which commit introduced a bug

**With raw Git:**
```bash
git bisect start
git bisect bad                     # mark current commit as broken
git bisect good v1.2.0             # mark a known-good commit
# Git checks out a midpoint commit
# You test manually, then:
git bisect good    # or:   git bisect bad
# Repeat 6–10 times
git bisect reset                   # don't forget this or your HEAD is detached
```

This works — but the ceremony of `bisect start / bad / good / reset` is a lot to remember for something you use once a month.

**With gitten:**
```
gitten → ⋯ More → 🔎 Find Bug Commit (Bisect)
  ◆  Last known-good commit:  v1.2.0 · "release: version 1.2.0"
  ⠸  Checking out midpoint...
  ◆  Does this commit have the bug?  ○ Yes  ● No
  (repeat ~5 times)
  ✓  Bug introduced in: a3f91bc  "feat: add discount rounding"
  ✓  HEAD reset to original branch.
```

**What gitten handles for you:**
- `bisect start / bad / good` are hidden — you just answer "does the bug exist here?".
- `bisect reset` runs automatically when done.
- The culprit commit is shown with its message, not just the hash.

---

### 8 · Work on two things at once

**With raw Git:**
```bash
# Scenario: you're deep in a feature and an urgent hotfix arrives
git stash                          # save current work
git checkout main
git checkout -b hotfix/payment-crash
# fix the bug
git commit -m "fix: prevent payment crash on null user"
git push
git checkout feat/my-feature       # back to the feature
git stash pop
# Two terminal tabs, constant context switching
```

**With gitten:**
```
gitten → ⋯ More → 🗂️ Worktrees
  ◆  Add worktree
  ◇  Directory:  ../gitten-hotfix
  ◇  Branch:     hotfix/payment-crash
  ✓  Worktree created at ../gitten-hotfix
```

Now `../gitten-hotfix` is a second working copy of the repo, checked out on the hotfix branch. You can run both simultaneously in separate terminal tabs — no stashing, no context switching.

---

### 9 · Undo a commit you just made

**With raw Git:**
```bash
git log --oneline                  # find the commit above the one you want to undo
git reset --soft HEAD~1            # soft: keeps changes staged
# or:
git reset HEAD~1                   # mixed: keeps changes unstaged
# or:
git reset --hard HEAD~1            # hard: DELETES the changes — no undo
```

The three modes of `git reset` are frequently confused. `--hard` in particular has deleted more work than any other single command in Git's history.

**With gitten:**
```
gitten → ⋯ More → ↩ Undo Commit
  ◆  Reset to which commit?
     HEAD~1  "feat: add JWT middleware"   ← selected
  ◆  Mode?
     ● Soft (keep changes staged)
     ○ Mixed (keep changes, unstage)
  ✓  Reset complete. Your changes are preserved.
```

`--hard` is not offered. If you want to discard all changes, that is a separate "Reset" flow with an explicit confirmation step.

---

### Summary — commands vs clicks

| Operation | Raw Git (commands) | gitten (steps) |
|---|---|---|
| New branch with correct naming | 1 command + mental format lookup | 2 prompts |
| Stage → diff → commit → push | 4–5 commands (6 for new branches) | 1 flow, 1 confirmation |
| Switch branch with stash | 3 commands, manual pop later | 1 menu pick + 1 confirm |
| Cherry-pick with conflict handling | 2 commands + manual recovery | 1 flow, guided pause |
| Delete N branches + remotes | 2 commands × N | multi-select + 1 confirm |
| Bisect to find bad commit | 5+ commands + manual loop | guided yes/no loop |
| Worktrees for parallel work | 2 commands + mental bookkeeping | 2 prompts |
| Undo commit (safe modes only) | 1 command (but --hard danger lurks) | 2 prompts, --hard hidden |

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
bun test       # 279 unit tests, no real git process spawned
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
