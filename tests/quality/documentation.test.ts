import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDocumentation } from "../../scripts/quality/documentation";

let root: string;
const files = ["AGENTS.md", "ARCHITECTURE.md", "CHANGELOG.md", "CLAUDE.md", "README.md", "LICENSE"];

const write = (file: string, text: string) => writeFileSync(join(root, file), text);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gitten-docs-test-"));
  for (const file of files) write(file, "# Gitten\n");
  write("AGENTS.md", "[Development guide](CLAUDE.md)\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("permits the documentation inventory and validates relative anchors and references", () => {
  write(
    "README.md",
    "[Guide][guide]\n[guide]: CLAUDE.md#gitten\n\n```md\n[example](missing.md)\n```",
  );
  expect(checkDocumentation(root, files)).toEqual([]);
});

test("rejects extra Markdown, missing documents, broken links, and a missing AGENTS cross-reference", () => {
  write("AGENTS.md", "Apply these instructions.\n");
  write("README.md", "[Missing header](CLAUDE.md#fictional)\n[Escape](../outside.md)");
  rmSync(join(root, "LICENSE"));
  const messages = checkDocumentation(root, [...files, "records/temp.MD"]);
  expect(messages.map(({ line, message }) => [line, message])).toEqual([
    [1, "Markdown file outside the documentation allowlist."],
    [1, "AGENTS.md must link to CLAUDE.md."],
    [1, "Broken local link to CLAUDE.md#fictional."],
    [2, "Broken local link to ../outside.md."],
    [1, "Required document is missing."],
  ]);
});

test("checks local anchors and rejects absolute paths and symlinks that leave the checkout", () => {
  const external = mkdtempSync(join(tmpdir(), "gitten-docs-external-"));
  try {
    const externalFile = join(external, "outside.txt");
    writeFileSync(externalFile, "untracked outside document");
    symlinkSync(externalFile, join(root, "alias.txt"));
    write(
      "README.md",
      [
        "# Same heading",
        "## Same heading",
        "[Second heading](#same-heading-1)",
        "~~~md",
        "```md",
        "[Within fence](missing.md)",
        "~~~",
        "[Outside via alias](alias.txt)",
        `[Outside via absolute path](<${externalFile}>)`,
        "[Invalid escape](invalid%G1)",
      ].join("\n"),
    );
    expect(checkDocumentation(root, files).map(({ line }) => line)).toEqual([8, 9, 10]);
  } finally {
    rmSync(external, { recursive: true, force: true });
  }
});
