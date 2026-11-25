# Gitten architecture

## Layers

- `index.ts`, `src/app.ts`, and `src/composition/` own CLI status codes, application startup, menus, and dependency wiring.
- `src/core/` owns workflows. It uses application modules, pure models in `src/core/domain/`, and interfaces in `src/core/ports/`. Each workflow receives only its Git operations. Sync and Pull share push, upstream, and recovery capabilities where needed. The full Git client is assembled by the adapter and wired by composition. Port declarations may use domain models. The domain has no terminal, Git, filesystem, or network effects.
- `src/git/`, `src/ui/`, `src/ai/`, `src/config/`, and `src/utils/` supply adapters. Adapters use the domain and ports. Composition wires concrete adapters together. The Git client assembles repository, index, operation, history, rewrite, stash, purge, and remote capabilities.
- `scripts/quality/` owns validation. Tests can use the module or adapter under test. Application production sources cannot depend on tests or tooling.

The interactive CLI and development doctor check the Git executable on `PATH` against the same minimum version before running repository commands. The CLI prints help and version without invoking Git.

Sync owns commit creation through its selection and verification flow. The Git adapter exposes staged review and operation-specific mutations. Integration tests prepare repositories directly with Git and assert the resulting application behavior.

Cancelling the first initialization prompt exits without creating a repository. Once Git initializes it, cancelling remote setup keeps the local repository. A remote setup failure reports the partial result and exits with status 1 so the user can inspect Remotes and retry.

## Git operations and privacy

Sync prepares a temporary index for the selected paths and shows the resulting diff. It revalidates the selection during commit and preserves unrelated staged content. If the commit succeeds and the index update fails, Sync keeps a recovery index and reports its path. Sync and Push Branch preview the exact commit, destination ref, and push URLs. Tag publishes the annotated object from the reviewed commit. Amend rechecks HEAD and the displayed staged diff before writing. Purge verifies the selected refs and removes paths in a fresh mirror. The original checkout is the backup. Clean Branches previews the resolved remote ref and requires its exact commit before deletion. Undo and Squash select an inclusive range on the first-parent history, verify the full commit IDs, and keep the previous tip under `refs/gitten/recovery`.

Reset verifies the confirmed upstream and saves the previous commit under `refs/gitten/recovery` before changing the working tree and index. It reports that ref even when the reset fails after it is saved. Reset stops if an untracked or ignored path obstructs the destination. The recovery ref preserves committed history. The destructive confirmation covers uncommitted tracked changes.

Message-only Amend uses a temporary index and compares the resulting tree, parents, and message with the approved content. If a hook changes the result, Amend compares the ref with the created commit before restoring the prior tip. It preserves the original index and reports both commit IDs if restoration fails. Staged-only Amend preserves the existing message verbatim.

Repository Status separates working files from staged files. It shows the staged diff for the selected paths, includes both sides of a rename, and rechecks the diff before unstaging. Recovery compares the pending operation's Git markers and HEAD after confirmation. Dismissing the prompt leaves Git state unchanged. Pull compares the previous and new HEAD and distinguishes an unchanged branch from an advance with an identical file tree. The terminal neutralizes control characters and redacts remote URL credentials before rendering external text. Direction controls and Unicode line separators appear as visible code points in reviews. Selectors retain the original value for Git operations.

Repository Status resumes Bisect through the same configured action as the menu.

The .gitignore editor preserves existing rules and checks for intervening edits before replacing the file. Git determines the newly ignored tracked paths. The editor shows them before removing them from the index, checks the matches and staged content again, and reports a saved pattern separately from the result of the index update.

A remote write that fails with multiple push URLs warns that one or more destinations may already have changed. The local branch cleaner shows the exact tip before forcing an unmerged deletion and rechecks it after confirmation.

Branch switching fetches the configured upstream of the selected branch. It rechecks that upstream after fetching and after the pull confirmation. A stash created before checkout remains available for recovery if the checkout fails.

Cherry-pick verifies the destination branch after the user confirms the ordered commits. A failed sequence reports the number of commits already applied.

Remote settings pass names and addresses as literal arguments to Git and preserve spaces and ordinary Unicode in paths. Adding or changing an address rejects control characters, including invisible direction controls. Publication requires an explicit fetch or push URL and rejects those controls in both configured and effective destinations. The first Pull into an unborn branch counts the tracked paths in the new checkout. Stash statistics include binary files in the file count.

Pull reports a partial result when Git finishes the command and HEAD or the changed paths cannot be verified.

Sync treats commit counts as provisional if fetching fails or the branch or upstream changes during fetch. Stash rechecks the staged, unstaged, and included untracked paths before writing. A conflicting pop reports the working-tree failure and keeps the stash available. The Git adapter treats a nonzero exit status as failure, including when Git reports the cause only on standard output or exits silently.

Sync checks for a pending Git operation before previewing and again just before committing. Git operation and recovery checks read markers from the current worktree's Git directory, including when its path contains a newline. Undo and Squash recheck the branch and pending operations after saving the recovery ref. Rollback compares the current tip with the expected commit to preserve concurrent updates.

Sync and Squash use full SHA-1 or SHA-256 commit IDs. Final verification reads the original commit objects and checks their trees and parents before reporting success.

Purge verifies the mirror against the previewed refs before filtering exact file paths. If a directory shares a former file's name, the directory contents are preserved. Include each historical name of a renamed file. A failed filter or verification discards its temporary mirror. The original repository remains available as the backup. Credential exposure requires rotation and separate cleanup of remotes and other clones.

Settings manages AI connections and saved profiles in user configuration. Project `.gittenrc` may configure branch prefixes and history limits. Effective Settings identifies which preferences come from the project file, user configuration, or defaults. Environment credentials require matching `GITTEN_AI_PROVIDER` and `GITTEN_AI_BASE_URL`. AI requests need explicit consent for the data and destination. The action uses the same connection that was bound for consent. Disabled suggestions block requests, while an explicitly approved connection test sends fixed test text. Diff screening is conservative and can block otherwise valid inputs that resemble secrets.

## Quality gate

The static check limits functions and methods to 50 source lines, classes to 200, cyclomatic complexity to 10, control nesting to 3, and function parameters to 4. Line counts exclude blanks and comments. Cyclomatic complexity includes branches and short-circuit operators. The same check rejects cross-layer dependencies and runtime cycles.

The coverage gate checks exact statement, function, branch, and line counts for each executable TypeScript file in its inventory. The suite must execute every expected test file without focused tests, skips, or TODOs. The gate matches registered [behavior contracts](scripts/quality/contracts.ts) against actual JUnit cases with assertions. A contract names success and failure evidence and includes cancellation, concurrency, and partial failure where applicable. The native matrix requires exact Bash installer line counts from Bash traces and the parsed command inventory, PowerShell installer command counts from Pester, and Ruby line counts for the two Homebrew formula branches. Installer suites assert that a failed update preserves the existing executable.

The static and coverage checks share the Git file inventory. It includes executable `.ts`, `.tsx`, `.mts`, and `.cts` files throughout the repository. Declaration files, test suites, and helpers under `tests/` stay outside production coverage. Test discovery includes Bun's dot and underscore suffixes throughout the repository. Production imports must stay outside test modules, including test files alongside production modules. The test gate rejects conditional execution and expected-failure modes.

| Native entry point | Successful outcomes | Failure and recovery outcomes |
| --- | --- | --- |
| [Bash installer](tests/native/install-sh.test.sh) | Supported asset selection, both checksum commands, an authenticated manifest, destination selection, installation by file and stdin, PATH hint when needed, and version and help from the compiled binary. | Missing parser or verifier, unavailable or malformed release metadata, missing, duplicate, incomplete, or altered manifest, failed download or replacement, absent or ambiguous checksum, bad binary digest or version, unsupported host, unusable destination, interruption, and cleanup. |
| [PowerShell installer](tests/native/install-ps1.test.ps1) | First install, authenticated manifest, atomic replacement, default destination, direct invocation, and idempotent PATH registration. | Unavailable release or download, invalid tag, missing, duplicate, incomplete, or altered manifest, absent or ambiguous checksum, bad binary digest or version, unsupported architecture, preservation of the previous executable, and cleanup. |
| [Pre-push wrapper](tests/native/bash-coverage.py) | Runs the gate with the original input and propagates its status. | Fails with a diagnostic when Bun is unavailable. |
| [Homebrew formula](tests/native/formula.test.rb) | Both macOS architectures select the matching archive and install the expected version. | The version check rejects a mismatched binary. |

Pre-push validates every commit introduced by the ref updates and each ref's target commit in isolated checkouts. It compares the outgoing history to the destination's advertised refs and checks shared commits once, in parent-first order. A shallow checkout must expose the full outgoing range up to an already published commit. Each checkout installs dependencies from its lockfile and runs the strict gate. CI invokes the same strict quality command.

Hook installation verifies the worktree root and executable wrapper. It preserves an explicit hooks path and existing legacy hooks. Running it again validates the wrapper without writing duplicate settings.

The pre-push hook passes only the environment settings needed by snapshot tools. Cancellation interrupts ref input and stops a running check before the temporary checkout is removed.

The shared quality command discards earlier test and coverage reports before running static checks. Direct coverage runs clear both reports before preparing instrumentation.

CI runs the strict gate with the runner's Git and with Git 2.43.7 built from a checksum-pinned source archive for local repository tests. The native matrix verifies the installer and hook coverage with macOS system Bash 3.2 and checks the Windows installer under both Windows PowerShell 5.1 and PowerShell 7.

## Release verification

The [release workflow](.github/workflows/release.yml) collects the binaries produced by the [native matrix](.github/workflows/native.yml) after quality and native verification pass. It generates a manifest for the five expected binaries and attests the manifest and binaries. Release Please creates the tag alongside a draft release. Publication uploads the complete package to the draft and checks GitHub's recorded asset names, upload states, and digests before making it public. Retries verify existing published assets without replacing them. Coverage reports are separate workflow artifacts.

The Bash and PowerShell installers obtain the tag and the manifest's SHA-256 digest from the fixed GitHub Releases API URL over HTTPS with redirects disabled. Bash disables the local curl configuration. Both installers download the manifest to a temporary file and verify its bytes against the API digest before requesting the binary. They verify the selected binary against the authenticated manifest and run it for its expected version before replacing an existing installation. This path trusts authenticated GitHub API metadata. The [Homebrew update workflow](.github/workflows/update-homebrew.yml) also verifies the manifest's GitHub attestation for the exact release tag before applying the two macOS checksums. The Homebrew formula uses pinned checksums.

The [local release rehearsal](tests/quality/release-workflow.test.ts) runs the workflow's checksum and formula steps with temporary files and a simulated attestation verifier. It covers the five expected binaries, refusal of an invalid verification result, and preservation of the previous files when an expected input is missing. CI supplies the native binaries and GitHub supplies the signed attestation during release.

The hosted rehearsal runs from `release-rehearsal/*` branches. It checks the signed manifest against the exact workflow, ref, and commit, then checks all five downloaded binaries before generating the Homebrew formula. The candidate formula and release assets are workflow artifacts. Only a release tag can publish release assets and open the formula PR.
