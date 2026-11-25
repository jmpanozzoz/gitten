import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localGit } from "../../scripts/quality/push-snapshot";
import { createGitClient } from "../../src/git/git-client";
import { runBun } from "../support/run-bun";

const program = join(import.meta.dir, "fixtures/purge.ts");
const historical = "-old [1].txt";
const filterFixture = [
  "#!/bin/sh",
  "set -eu",
  'if [ "$1" = --version ]; then test "$FILTER_MODE" != missing; exit; fi',
  'test "$#" -eq 2 && test "$1" = --invert-paths && test "$2" = "$EXACT_FILTER"',
  'printf "%s" "$PWD" > "$FILTER_CALL"',
  'case "$FILTER_MODE" in',
  '  failure) echo "fixture filter failed" >&2; exit 7 ;;',
  "  unchanged) exit 0 ;;",
  "  success)",
  '    git for-each-ref --format="%(refname)" | while IFS= read -r ref; do',
  '      git update-ref "$ref" "$REPLACEMENT"',
  "    done",
  "    git remote remove origin ;;",
  "esac",
  "",
].join("\n");

function buildFixture(root: string) {
  const source = join(root, "source");
  const bin = join(root, "bin");
  const copies = join(root, "copies");
  for (const dir of [source, bin, copies]) mkdirSync(dir);
  const call = join(root, "call");
  localGit(source, ["init", "-q", "--initial-branch=main"]);
  localGit(source, ["config", "user.name", "Gitten fixture"]);
  localGit(source, ["config", "user.email", "fixture@example.invalid"]);
  writeFileSync(join(source, "README.md"), "preserve this\n");
  localGit(source, ["add", "README.md"]);
  localGit(source, ["commit", "-qm", "clean root"]);
  writeFileSync(join(source, historical), "fixture content only");
  localGit(source, ["add", "--", historical]);
  localGit(source, ["commit", "-qm", "add historical path"]);
  const added = localGit(source, ["rev-parse", "HEAD"]);
  localGit(source, ["tag", "old", added]);
  localGit(source, ["rm", "--", historical]);
  localGit(source, ["commit", "-qm", "now absent from current tree"]);
  mkdirSync(join(source, historical));
  writeFileSync(join(source, historical, "keep.txt"), "preserve this descendant");
  localGit(source, ["add", "--", historical]);
  localGit(source, ["commit", "-qm", "create a directory with the former file name"]);
  const original = localGit(source, ["rev-parse", "HEAD"]);
  const tree = localGit(source, ["rev-parse", "HEAD^{tree}"]);
  const replacement = localGit(source, ["commit-tree", tree, "-m", "fixture filtered tree"]);
  localGit(source, ["branch", "fixture-clean", replacement]);
  writeFileSync(join(bin, "git-filter-repo"), filterFixture, { mode: 0o755 });
  return {
    source,
    copies,
    call,
    original,
    added,
    replacement,
    run: (mode: string, paths = [historical]) =>
      runBun([program, ...paths], source, {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TMPDIR: copies,
        FILTER_MODE: mode,
        FILTER_CALL: call,
        EXACT_FILTER: "--path-regex=\\A-old \\[1\\]\\.txt\\Z",
        REPLACEMENT: replacement,
      }),
  };
}

function withFixture(run: (fixture: ReturnType<typeof buildFixture>) => void) {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "gitten-purge-fixture-")));
  try {
    run(buildFixture(temporary));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

test("Purge verifies a filtered mirror of a historical literal path and preserves the original refs", () => {
  withFixture(({ run, source, call, original, added, replacement }) => {
    const result = run("success");
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    const mirror = result.stdout
      .toString()
      .trim()
      .replace(/^COPY /, "");
    expect(readFileSync(call, "utf8")).toBe(mirror);
    expect(localGit(mirror, ["rev-parse", "refs/heads/main", "refs/tags/old"])).toBe(
      `${replacement}\n${replacement}`,
    );
    expect(localGit(mirror, ["log", "--all", "--format=", "--name-only", "--", historical])).toBe(
      `${historical}/keep.txt`,
    );
    expect(localGit(mirror, ["show", `HEAD:${historical}/keep.txt`])).toBe(
      "preserve this descendant",
    );
    expect(localGit(mirror, ["show", "HEAD:README.md"])).toBe("preserve this");
    expect(localGit(source, ["rev-parse", "HEAD", "refs/tags/old"])).toBe(`${original}\n${added}`);
    expect(localGit(source, ["show", `refs/tags/old:${historical}`])).toBe("fixture content only");
  });
});

test("Purge removes its temporary mirror on filter failure or failed path verification", () => {
  withFixture(({ run, source, copies, original }) => {
    for (const [mode, message] of [
      ["failure", "fixture filter failed"],
      ["unchanged", "Filtered paths remain reachable"],
    ]) {
      const result = run(mode!);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(message!);
      expect(readdirSync(copies)).toEqual([]);
      expect(localGit(source, ["rev-parse", "HEAD"])).toBe(original);
    }
  });
});

test("Purge rejects missing tools, invalid paths and a mirror that would omit a hidden ref", () => {
  withFixture(({ run, source, copies }) => {
    expect(run("missing").stderr.toString()).toContain("Filter tool unavailable.");
    expect(run("success", ["../elsewhere"]).stderr.toString()).toContain(
      "Choose exact repository-relative file paths",
    );
    expect(run("success", []).stderr.toString()).toContain(
      "Choose exact repository-relative file paths",
    );
    localGit(source, ["branch", "hidden"]);
    localGit(source, ["config", "uploadpack.hideRefs", "refs/heads/hidden"]);
    expect(run("success").stderr.toString()).toContain(
      "The verified mirror differs from the previewed refs.",
    );
    expect(readdirSync(copies)).toEqual([]);
  });
});

test("Purge previews files from a root commit and files introduced only in a merge", async () => {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "gitten-purge-merge-")));
  try {
    const { source } = buildFixture(temporary);
    localGit(source, ["config", "log.showRoot", "false"]);
    localGit(source, ["checkout", "-qb", "peer"]);
    writeFileSync(join(source, "peer.txt"), "unrelated peer change");
    localGit(source, ["add", "peer.txt"]);
    localGit(source, ["commit", "-qm", "peer change"]);
    localGit(source, ["checkout", "-q", "main"]);
    localGit(source, ["merge", "--no-ff", "--no-commit", "peer"]);
    writeFileSync(join(source, "merge-only.txt"), "file first committed during the merge");
    localGit(source, ["add", "merge-only.txt"]);
    localGit(source, ["commit", "-qm", "merge adds its own file"]);
    const result = await createGitClient(source).describePurge([
      "README.md",
      "merge-only.txt",
      "absent.txt",
    ]);
    expect(result.absent).toEqual(["absent.txt"]);
    expect(result.refs).toContain(`${localGit(source, ["rev-parse", "HEAD"])} refs/heads/main`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
