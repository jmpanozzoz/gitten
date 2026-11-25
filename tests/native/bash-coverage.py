"""Measure executed command lines in the Bash installer and require a complete report."""

import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory

from tree_sitter import Language, Parser
import tree_sitter_bash


ROOT = Path(__file__).resolve().parents[2]
COMMANDS = frozenset({
    "command",
    "declaration_command",
    "test_command",
    "variable_assignment",
    "variable_assignments",
    "unset_command",
    "case_statement",
    "for_statement",
    "c_style_for_statement",
    "select_statement",
})
TRACE = """set -o functrace
trap 'if [[ ${BASH_SOURCE[0]-} == "$GITTEN_BASH_SOURCE" ]]; then printf "%s\\n" "$LINENO" >> "$GITTEN_BASH_TRACE"; fi' DEBUG
"""


def executable_spans(source):
    parser = Parser(Language(tree_sitter_bash.language()))
    tree = parser.parse(source.read_bytes())
    if tree.root_node.has_error:
        raise RuntimeError(f"Could not parse {source.name} for coverage.")
    pending = [tree.root_node]
    commands = {}
    while pending:
        node = pending.pop()
        pending.extend(node.named_children)
        if node.type in COMMANDS:
            start = node.start_point.row + 1
            end = node.end_point.row + 1
            commands.setdefault(start, set()).update((start, end))
    if not commands:
        raise RuntimeError(f"No executable lines found in {source.name}.")
    return commands


def measure(source, exercise):
    inventory = executable_spans(source)
    with TemporaryDirectory(prefix="gitten-bash-coverage-") as directory:
        workspace = Path(directory)
        trace = workspace / "trace"
        bootstrap = workspace / "trace.bash"
        bootstrap.write_text(TRACE)
        env = {
            **os.environ,
            "BASH_ENV": str(bootstrap),
            "GITTEN_BASH_SOURCE": str(source),
            "GITTEN_BASH_TRACE": str(trace),
        }
        exercise(source, workspace, env)
        executed = set(map(int, trace.read_text().splitlines()))
    missing = sorted(start for start, lines in inventory.items() if executed.isdisjoint(lines))
    name = source.relative_to(ROOT)
    for number in missing:
        print(f"{name}:{number}: executable line was never traced")
    print(f"{name} executable Bash lines: {len(inventory) - len(missing)}/{len(inventory)}", flush=True)
    return bool(missing)


def exercise_installer(source, workspace, env):
    subprocess.run(
        ["bash", str(ROOT / "tests/native/install-sh.test.sh")],
        check=True,
        cwd=ROOT,
        env=env,
    )


def exercise_hook(source, workspace, env):
    bash = shutil.which("bash")
    git = shutil.which("git")
    toolbox = workspace / "bin"
    toolbox.mkdir()
    checkout = (workspace / "checkout").resolve()
    subprocess.run([git, "init", "--quiet", str(checkout)], check=True)
    env["PATH"] = str(toolbox)
    destination = str(workspace / "remote.git")
    args = [bash, str(source), "origin", destination]
    absent = subprocess.run(args, cwd=checkout, env=env, capture_output=True, text=True)
    if absent.returncode != 1 or "pre-push requires Bun" not in absent.stderr:
        raise RuntimeError("Pre-push did not report missing Bun.")
    (toolbox / "git").symlink_to(git)
    runner = toolbox / "bun"
    runner.write_text(
        '#!/bin/sh\nprintf "%s\\n" "$@"\n'
        'while IFS= read -r update; do printf "%s\\n" "$update"; done\n'
        'exit "${FIXTURE_GATE_STATUS:-0}"\n'
    )
    runner.chmod(0o755)
    updates = [
        "refs/heads/main " + "a" * 40 + " refs/heads/main " + "0" * 40,
        "refs/heads/dev " + "b" * 40 + " refs/heads/dev " + "0" * 40,
    ]
    handed_off = subprocess.run(
        args, cwd=checkout, env=env, input="\n".join(updates) + "\n", capture_output=True, text=True,
        check=True,
    )
    expected = ["--no-env-file", str(checkout / "scripts/quality/pre-push.ts"), "origin", destination, *updates]
    if handed_off.stdout.splitlines() != expected:
        raise RuntimeError("Pre-push Bash wrapper changed the invocation or Git input.")
    rejected = subprocess.run(
        args, cwd=checkout, env={**env, "FIXTURE_GATE_STATUS": "7"},
        input="", capture_output=True, text=True,
    )
    if rejected.returncode != 7:
        raise RuntimeError("Pre-push Bash wrapper hid the gate failure.")


if __name__ == "__main__":
    installer_status = measure(ROOT / "install.sh", exercise_installer)
    hook_status = measure(ROOT / ".githooks/pre-push", exercise_hook)
    raise SystemExit(installer_status or hook_status)
