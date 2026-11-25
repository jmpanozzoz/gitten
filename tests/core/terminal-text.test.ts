import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { renderDiff } from "../../src/ui/diff-renderer";
import { terminalText } from "../../src/ui/terminal-text";

test("terminal labels neutralize control characters and keep Unicode visible", () => {
  const source = `café${String.fromCharCode(27)}plan\nstatus\tready${String.fromCharCode(127)}`;
  expect(terminalText(source, true)).toBe("café�plan status ready�");
  expect(terminalText(source)).toBe("café�plan\nstatus\tready�");
});

test("terminal output exposes direction controls and line separators while preserving Unicode text", () => {
  const literal = "cafe\u0301 日本語 العربية 👩‍💻";
  expect(terminalText(`${literal}\u061c\u202e\u2069\u2028\u2029`)).toBe(
    `${literal}[U+061C][U+202E][U+2069][U+2028][U+2029]`,
  );
  expect(terminalText(`${literal}\n\t`, true)).toBe(`${literal}  `);
});

test("hides embedded remote credentials from Git errors and keeps host and ref visible", () => {
  expect(
    terminalText(
      "cannot access 'https://build:never-print-me@example.test/repo?ref=main&token=very-secret#head'",
    ),
  ).toBe("cannot access 'https://example.test/repo?ref=main&token=[redacted]#head'");
  expect(terminalText("ssh://git@git.example.test/repo git@git.example.test:repo")).toBe(
    "ssh://git.example.test/repo git@git.example.test:repo",
  );
});

test("renders diff headers and changed lines and reports exactly how many lines are hidden", () => {
  const lines = ["--- a/menu", "+++ b/menu", "@@ -1 +1 @@", "-before", "+after", " context"];
  const diff = `${lines.join("\n")}\n`;
  expect(stripVTControlCharacters(renderDiff(diff))).toBe(lines.join("\n"));
  expect(stripVTControlCharacters(renderDiff(diff, 5))).toBe(
    `${lines.slice(0, 5).join("\n")}\n...and 1 more line`,
  );
  expect(stripVTControlCharacters(renderDiff(diff, 4))).toBe(
    `${lines.slice(0, 4).join("\n")}\n...and 2 more lines`,
  );
});
