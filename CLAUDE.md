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
src/
├── index.ts              # Entry point: uncaught error handler → app.ts
├── app.ts                # Orchestrator: validates context, renders Main Menu
│
├── core/                 # BUSINESS LOGIC — the "What"
│   ├── branch-creator.ts # Branch name standardization logic (feat/, fix/, …)
│   ├── branch-cleaner.ts # Safe-to-delete filter, local+remote delete flow
│   ├── cherry-picker.ts  # Commit selection + cherry-pick + conflict handling
│   └── sync-flow.ts      # Stage all → commit → push with upstream detection
│
├── git/                  # INFRASTRUCTURE — the "How" (talks to Git)
│   └── git-client.ts     # Wraps simple-git: checkIsRepo, getBranches, etc.
│
└── ui/                   # PRESENTATION — the "How" (talks to the human)
    ├── prompts.ts         # Wraps @clack/prompts: select, multiselect, text, spinner
    └── theme.ts           # Centralized color palette via picocolors

tests/
├── core/
│   ├── branch-creator.test.ts
│   ├── branch-cleaner.test.ts
│   ├── cherry-picker.test.ts
│   └── sync-flow.test.ts
└── mocks/
    ├── git-client.mock.ts
    └── prompts.mock.ts
```

**Rules:**
- `core/` imports from `git/` and `ui/` — never the reverse.
- `git/` and `ui/` know nothing about each other.
- `app.ts` is the only file that wires all layers together.
- No layer-crossing shortcuts. If `branch-creator.ts` needs to show a message, it calls `ui/prompts.ts`, not `console.log` directly.

---

## UI/UX — Look & Feel

Modeled after Claude Code's terminal style. Linear, structured, no excessive decoration.

```
│
◇  🐱 Gitten CLI — Tu asistente de Git
│
◇  📍 Contexto: repo-backend | rama: feat/nuevo-login
│
◆  ¿Qué quieres hacer hoy?
│  ○ 🌿 Nueva Rama Estandarizada
│  ● 🧹 Limpiar Ramas Viejas
│  ○ 🍒 Cherry Pick Rápido
│  ○ 🚀 Sync (Stage, Commit & Push)
│  ○ 🚪 Salir
```

- Use `clack.intro`, `clack.outro`, `clack.select`, `clack.multiselect`, `clack.text`, `clack.spinner`, `clack.confirm`, `clack.log.warn`, `clack.log.error`, `clack.log.success`.
- All color definitions live in `theme.ts` only. No inline `pc.green(...)` outside of theme helpers.
- Spinners for every async operation. Never let the terminal appear frozen.
- Warnings in yellow, errors in red, success in green. Use theme constants, not magic strings.

---

## Features — Scope, Limits & Guardrails

### Global Guardrails (`app.ts`)

- **Git repo check:** On startup, `git-client.ts` checks `process.cwd()` for `.git`. If absent → friendly error + `process.exit(1)`.
- **Index lock:** If `.git/index.lock` exists → suggest `rm -f .git/index.lock`, do not crash with a stacktrace.

---

### 🌿 Nueva Rama (`branch-creator.ts`)

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

**Example:** type=`feat`, desc=`"Login de Usuario "` → `feat/login-de-usuario`

---

### 🧹 Limpiar Ramas (`branch-cleaner.ts`)

**Does:**
1. Fetch all local branches.
2. Show multiselect.
3. Delete selected local branches.
4. Ask if remote branches should also be deleted.
5. Execute remote deletes if confirmed.

**Does NOT:**
- Force-delete remote branches if the user lacks permissions (surface the error, move on).
- Analyze merge status (user decides visually).

**Guardrails:**
- **Hard-filter — never show:** `main`, `master`, `dev`, `develop`, current branch (`HEAD`).
- Delete failures → yellow warning per branch, continue with the rest (no full abort).

---

### 🍒 Cherry Pick (`cherry-picker.ts`)

**Does:**
1. Ask source branch.
2. Show last 15 commits of that branch (short hash + subject).
3. User picks one.
4. Execute `git cherry-pick <hash>`.
5. On conflict: pause with spinner message, wait for ENTER (continue) or ESC (abort).
   - ENTER → `git cherry-pick --continue`
   - ESC → `git cherry-pick --abort`

**Does NOT:**
- Implement an in-terminal conflict resolver.
- Allow multi-commit selection (single commit only — Pareto).

---

### 🚀 Sync Rápido (`sync-flow.ts`)

**Does:**
1. Read `git status`.
2. If modified files exist: `git add .`, ask for commit message (default: `chore: update`), `git commit`, `git push`.
3. If branch has no upstream: auto-run `git push -u origin <current-branch>`.

**Does NOT:**
- Stage individual files or hunks (that's for Lazygit/Sublime Merge).

**Guardrails:**
- No remote upstream → detect on push error → auto push with `-u origin`.
- Remote has unpulled changes → detect push rejection → show: *"El remoto tiene cambios nuevos. Ejecuta un pull primero."* → abort safely.
- Nothing to commit → inform the user and skip to push if branch needs syncing.

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
- `branch-cleaner`: `main`, `master`, `dev`, `develop` and HEAD never appear in the list.
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

Asset naming convention: `gitten-darwin-arm64`, `gitten-darwin-x64`, `gitten-linux-x64`, `gitten-linux-arm64`.

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

- Each `core/` module exports a **class** (e.g. `BranchCreator`, `BranchCleaner`, `CherryPicker`, `SyncFlow`).
- Constructor receives `IGitClient` and `IUI` interfaces (dependency injection — no direct instantiation of dependencies inside business logic).
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
└── ui.port.ts           # IUI interface
```

`IGitClient` exposes only what `core/` actually needs (e.g. `checkIsRepo`, `getBranches`, `checkoutLocalBranch`, `deleteLocalBranch`, `deleteRemoteBranch`, `getLogs`, `cherryPick`, `getStatus`, `addAll`, `commit`, `push`). `simple-git`'s full API must not leak into business logic.

`IUI` exposes the prompt primitives used by core (e.g. `askText`, `askSelect`, `askMultiSelect`, `askConfirm`, `showSpinner`, `showSuccess`, `showWarning`, `showError`).

The concrete `GitClient` and `UI` classes implement these interfaces. Mocks in `tests/mocks/` also implement them — TypeScript will enforce the contract.

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

- No interactive conflict resolver inside the terminal.
- No `git rebase` interactive flows.
- No GitHub/GitLab API integration (no PRs, no issues).
- No file-level or hunk-level staging.
- No configuration file (`.gittenrc`, etc.) for v1.
- No plugin system.
- No multi-commit cherry-pick.

Keep it sharp. The moment a feature requires more than ~100 lines in a single function, it's out of scope for v1.
