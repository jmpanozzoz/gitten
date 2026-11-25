import { expect, test } from "bun:test";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { bunCommand } from "../support/run-bun";

const fixtures = join(import.meta.dir, "fixtures");
const driver = join(fixtures, "search-terminal.py");
const program = join(fixtures, "prompts-terminal.ts");
const down = "\x1b[B";
const right = "\x1b[C";
const escapeKey = "\x1b";

function run(
  scenario: string,
  steps: { marker: string; keys?: string }[],
  size?: { columns: number; rows: number },
): string {
  const result = Bun.spawnSync(
    [
      "python3",
      driver,
      "scripted",
      JSON.stringify({ steps, ...size }),
      ...bunCommand([program, scenario]),
    ],
    { env: { ...process.env, TERM: "xterm" }, timeout: 12_000 },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  const output = result.stdout.toString();
  expect(output).toContain("\x1b[?25h");
  return stripVTControlCharacters(output);
}

test("real prompts accept edited text and selections, default to No, and mask private input", () => {
  const output = run("answers", [
    { marker: "Write a message", keys: "café\r" },
    { marker: "Edit a message", keys: "\r" },
    { marker: "Allow removal?", keys: "\r" },
    { marker: "Select one option", keys: `${down}\r` },
    { marker: "Select several options", keys: " \r" },
    { marker: "Enter a private value", keys: "typed-private-value\r" },
    { marker: "RESULT" },
  ]);
  expect(output).toContain(
    'RESULT {"text":"café","edited":"keep this","confirmed":false,"selected":"coffee","multiple":["first"],"privateValueAccepted":true}',
  );
  expect(output).not.toContain("typed-private-value");
});

function cancelEveryPrompt(key: string) {
  const output = run("cancellation", [
    { marker: "Cancel a selection", keys: key },
    { marker: "Cancel multiple options", keys: key },
    { marker: "Cancel a text entry", keys: key },
    { marker: "Cancel a private value", keys: key },
    { marker: "Cancel a confirmation", keys: key },
    { marker: "DONE" },
  ]);
  expect(output.match(/CANCELLED (select|multiple|text|secret|confirm)/g)).toEqual([
    "CANCELLED select",
    "CANCELLED multiple",
    "CANCELLED text",
    "CANCELLED secret",
    "CANCELLED confirm",
  ]);
}

test("Escape cancels every standard prompt and restores the terminal", () => {
  cancelEveryPrompt(escapeKey);
});

test("Ctrl+D cancels every standard prompt and restores the terminal", () => {
  cancelEveryPrompt("\x04");
});

test("recovery requires an explicit confirmation to abort and otherwise leaves the operation pending", () => {
  const output = run("recovery", [
    { marker: "Pending Git operation", keys: "\r" },
    { marker: "RECOVERY 1 null" },
    { marker: "Pending Git operation", keys: `${down}\r` },
    { marker: "RECOVERY 2 true" },
    { marker: "Pending Git operation", keys: `${down}${down}\r` },
    { marker: "Abort the active Git operation?", keys: "\r" },
    { marker: "RECOVERY 3 null" },
    { marker: "Pending Git operation", keys: `${down}${down}\r` },
    { marker: "Abort the active Git operation?", keys: `${right}\r` },
    { marker: "RECOVERY 4 false" },
  ]);
  expect(output.match(/RECOVERY \d (null|true|false)/g)).toEqual([
    "RECOVERY 1 null",
    "RECOVERY 2 true",
    "RECOVERY 3 null",
    "RECOVERY 4 false",
  ]);
});

test("search prompts use visible and extra options and preserve selected values", () => {
  const output = run(
    "search",
    [
      { marker: "Esc cancel", keys: "Cafe\u0301\r" },
      { marker: 'VISIBLE "coffee"' },
      { marker: "Esc cancel", keys: "extra entry\r" },
      { marker: 'POOLED "extra"' },
      { marker: "Esc cancel", keys: "\tCafé\t\r" },
      { marker: 'MULTIPLE ["first","coffee"]' },
    ],
    { columns: 0, rows: 0 },
  );
  expect(output).toContain('VISIBLE "coffee"');
  expect(output).toContain('POOLED "extra"');
  expect(output).toContain('MULTIPLE ["first","coffee"]');
  expect(output).toContain("INPUT STILL FLOWING");
});

test("terminal output renders every message level, truncates diff, and distinguishes a failed task", () => {
  const output = run("output", [{ marker: "DONE" }]);
  for (const message of [
    "Start",
    "Repository · main",
    "Info café",
    "Warning",
    "Error",
    "Success",
    "-before",
    "+after",
    "...and 1 more line",
    "SPIN 42",
    "Writing failed.",
    "TASK FAILED",
    "Finished",
  ]) {
    expect(output).toContain(message);
  }
  expect(output).not.toContain("remaining");
});

test("terminal review escapes Unicode layout controls and returns the original selected ref", () => {
  const output = run("unicodeLayout", [
    { marker: "Esc cancel", keys: "\u202e" },
    { marker: "/ [U+202E]", keys: "\r" },
    { marker: "ORIGINAL REF true" },
  ]);
  expect(output).toContain("Repository · café[U+202E]日本語");
  expect(output).toContain("+café[U+202E]日本語[U+2028]continued");
  expect(output).toContain("Review refs · café[U+202E]日本語");
  expect(output).not.toContain("\u202e");
  expect(output).not.toContain("\u2028");
});
