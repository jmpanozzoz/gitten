# Gitten development guide

Use Bun 1.4.4 for development and Git for repository operations. Use English for code, UI strings, tests, and commit messages.

## Local checks

Run `bun install --frozen-lockfile` and `bun run dev` to develop. Use `bun run build` to compile the executable. Gitten disables automatic loading of project `.env` files in its supported development command and compiled executable.

Use Bun 1.4.4, Git 2.43.7 or later, Bash 3.2 or later, and Python 3 with PTY support on Linux, macOS, or WSL. Run `bun run quality:doctor` to diagnose local prerequisites and `bun run quality:test` to run the complete suite and validate its JUnit report. Run `bun run quality:check` for the same strict gate as the versioned pre-push hook. `bun run quality:static` runs lint, type, architecture, code-size, and documentation checks. `bun run quality:coverage` checks instrumented coverage and test execution. `bun run quality:check --report` runs the same tests and strict static checks while reporting uncovered code. Run `bun run hooks:install` when the strict gate passes locally. If Git already uses custom hooks, integrate [the versioned hook](.githooks/pre-push) with them.

Add regression tests for changed behavior. Assert what happens to refs, staged files, working files, a remote, or displayed output where those are part of the contract. Cover cancellation and partial failures when the operation can encounter them. Use temporary repositories and mock provider requests.

## Contributions and releases

Branch from `dev` and target `dev` for ordinary pull requests. Release integration merges `dev` into `main`. Use [Conventional Commits](https://www.conventionalcommits.org/) for commits and PR titles, including the release integration PR. Use lowercase imperative English and omit automated co-author lines.

Summarize the change and its purpose in the pull request. List the checks run and their results. Keep the title suitable as the squash commit message used by Release Please to determine version bumps on `main`.

Release Please manages package versions and [CHANGELOG.md](CHANGELOG.md), creates tags immediately, and prepares draft releases. The release workflow uploads the verified assets to the draft and makes it public after checking GitHub's recorded digests.

A push to `release-rehearsal/<name>` runs the release gate and produces signed provenance, checked binaries, and a candidate formula in workflow artifacts. Review those outputs on the exact commit before publishing a release tag.

The repository secret `RELEASE_TOKEN` authorizes Release Please and the Homebrew formula PR. Scope it to this repository with contents and pull-request write access. The formula job uses its workflow token to read the published attestation and the release token to push the formula branch and open its PR.

Use the GitHub Actions `Test` check as the required status for `dev` and `main`. It succeeds after the strict quality gate and the native matrix succeed. Check both jobs on the exact commit under review before changing branch rules.

## Scope

Gitten guides the user through conflicts and leaves editing to their editor. Current scope includes file-level selection, Git repository operations, and optional AI assistance. Interactive rebase editing, hunk editing, hosting-service API integration, and plugins are outside the current scope.

Use [ARCHITECTURE.md](ARCHITECTURE.md) for layer rules, Git safety invariants, and test criteria.
