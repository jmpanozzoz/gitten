# Gitten

Gitten is an interactive terminal tool for common Git work. It supports selective commits through Sync, merge and rebase through Pull, branch cleanup, cherry-pick, stash, and worktrees. Run it inside a Git repository or use its startup prompt to initialize one.

## Install

Git 2.43.7 or later is required. Get the binary for your platform from [Gitten releases](https://github.com/jmpanozzoz/gitten/releases/latest). Releases target macOS arm64 and x64, Linux arm64 and x64, and Windows x64. The [Bash 3.2+ installer](install.sh) requires `jq`, `curl`, and `sha256sum` or `shasum`. Both it and the [PowerShell 5.1+ installer](install.ps1) require a release with a SHA-256 manifest recorded by GitHub. The [Homebrew formula](Formula/gitten.rb) pins its own checksums.

```sh
gitten --version
gitten --help
gitten
```

## Use

Type to filter the menu. Use the arrow keys to move, Enter to confirm, and Escape or Ctrl+D to return. In a searchable multi-select, use Tab to toggle the highlighted item. Sync previews the selected files before committing and asks separately about pushing. **Push Branch** previews the destination and publishes the selected branch head. **Repository Status** shows staged, unstaged, and untracked files, lets you inspect or unstage selected paths, and offers recovery when a Git operation is pending. **Switch Branch** can create a local branch that tracks a selected remote branch. **Diff** compares the index, working files, or two branches. **Log** lets you browse older commits and page through their diffs.

AI assistance is optional. Gitten asks before sending each request and shows the destination and kind of data. Configure the connection from **More → Settings**.

For development commands and release conventions, see [CLAUDE.md](CLAUDE.md). See [ARCHITECTURE.md](ARCHITECTURE.md) for data handling and quality checks. [Changelog](CHANGELOG.md) · [MIT license](LICENSE)
