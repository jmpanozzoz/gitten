import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { StaticDiagnostic } from "./static-diagnostic";

const requiredDocs = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "CLAUDE.md",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
];
const markdownDocs = new Set(requiredDocs.filter(isMarkdown));

export function checkDocumentation(root: string, tracked: string[]): StaticDiagnostic[] {
  const issues: StaticDiagnostic[] = [];
  for (const path of tracked.filter(isMarkdown)) {
    if (!markdownDocs.has(path)) {
      issues.push(
        docIssue(join(root, path), 1, "Markdown file outside the documentation allowlist."),
      );
    }
  }
  for (const path of requiredDocs) {
    const file = join(root, path);
    if (!existsSync(file)) issues.push(docIssue(file, 1, "Required document is missing."));
    else if (isMarkdown(path)) issues.push(...checkLinks(root, file));
  }
  return issues;
}

function isMarkdown(file: string): boolean {
  return extname(file).toLowerCase() === ".md";
}

function checkLinks(root: string, file: string): StaticDiagnostic[] {
  const lines = linesOutsideCode(readFileSync(file, "utf8"));
  const issues = lines.flatMap(({ text, line }) =>
    linkTargets(text).flatMap((target) => {
      if (external(target)) return [];
      return validLink(root, file, target)
        ? []
        : [docIssue(file, line, `Broken local link to ${target}.`)];
    }),
  );
  if (relative(root, file) === "AGENTS.md") {
    const guides = lines.some(({ text }) => linkTargets(text).includes("CLAUDE.md"));
    if (!guides) issues.push(docIssue(file, 1, "AGENTS.md must link to CLAUDE.md."));
  }
  return issues;
}

function linesOutsideCode(text: string): { text: string; line: number }[] {
  let fence = "";
  return text.split("\n").flatMap((raw, index) => {
    const marker = raw.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
      return [];
    }
    return fence ? [] : [{ text: raw.replace(/`+[^`]*`+/g, ""), line: index + 1 }];
  });
}

function linkTargets(text: string): string[] {
  const inline = [...text.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)];
  const reference = text.match(/^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/);
  return [...inline, ...(reference ? [reference] : [])].map((match) => match[1] ?? match[2]!);
}

function external(target: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//");
}

function validLink(root: string, origin: string, target: string): boolean {
  const parts = target.split("#");
  try {
    const decoded = decodeURIComponent(parts[0]!);
    if (isAbsolute(decoded)) return false;
    const file = decoded ? resolve(dirname(origin), decoded) : origin;
    if (!isWithin(root, file) || !existsSync(file)) return false;
    if (!isWithin(realpathSync(root), realpathSync(file))) return false;
    const fragment = parts[1];
    return (
      !fragment ||
      !isMarkdown(file) ||
      anchors(readFileSync(file, "utf8")).has(decodeURIComponent(fragment))
    );
  } catch {
    return false;
  }
}

function isWithin(root: string, file: string): boolean {
  const path = relative(root, file);
  return !isAbsolute(path) && path.split(/[\\/]/)[0] !== "..";
}

function anchors(contents: string): Set<string> {
  const used = new Set<string>();
  for (const { text } of linesOutsideCode(contents)) {
    const title = text.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*$/)?.[1];
    if (!title) continue;
    const slug = title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-");
    let key = slug;
    let ordinal = 0;
    while (used.has(key)) key = `${slug}-${++ordinal}`;
    used.add(key);
  }
  return used;
}

function docIssue(file: string, line: number, message: string): StaticDiagnostic {
  return { file, line, rule: "documentation", message };
}
