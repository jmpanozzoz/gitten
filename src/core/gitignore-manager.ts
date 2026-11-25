import { confirmAISend } from "./ai-consent";
import { GoBackSignal } from "./domain/navigation";
import type { AIGitignoreSuggester } from "./ports/ai.port";
import type { IUI } from "./ports/ui.port";
import type { GitignorePort } from "./ports/workflow-git.port";

type GitignoreAction = "add" | "template" | "ai" | "view";

type TemplateName = "node" | "python" | "macos" | "go" | "rust" | "java" | "dotenv";

const TEMPLATES: Record<TemplateName, string[]> = {
  node: [
    "node_modules/",
    "dist/",
    "build/",
    ".env",
    ".env.local",
    ".env.*.local",
    "npm-debug.log*",
    "yarn-debug.log*",
    "yarn-error.log*",
    ".pnp",
    ".pnp.js",
    ".next/",
    ".nuxt/",
    ".cache/",
    "coverage/",
    "*.tsbuildinfo",
  ],
  python: [
    "__pycache__/",
    "*.py[cod]",
    "*$py.class",
    "*.so",
    ".Python",
    "venv/",
    ".venv/",
    "env/",
    ".env",
    "dist/",
    "build/",
    "*.egg-info/",
    ".eggs/",
    ".pytest_cache/",
    ".mypy_cache/",
    ".ruff_cache/",
    "*.log",
  ],
  macos: [".DS_Store", ".AppleDouble", ".LSOverride", "._*", ".Spotlight-V100", ".Trashes"],
  go: ["*.exe", "*.exe~", "*.dll", "*.so", "*.dylib", "*.test", "*.out", "vendor/", "go.sum"],
  rust: ["target/", "Cargo.lock", "*.rs.bk"],
  java: [
    "*.class",
    "*.jar",
    "*.war",
    "*.ear",
    "*.nar",
    "target/",
    ".gradle/",
    "build/",
    ".idea/",
    "*.iml",
    "out/",
  ],
  dotenv: [".env", ".env.*", "!.env.example"],
};

export class GitignoreManager {
  constructor(
    private readonly git: GitignorePort,
    private readonly ui: IUI,
    private readonly aiSuggester?: AIGitignoreSuggester,
  ) {}

  async run(): Promise<void> {
    const aiOption = this.aiSuggester
      ? [{ value: "ai" as const, label: "✨ Suggest patterns with AI" }]
      : [];

    const action = await this.ui.askSelect<GitignoreAction>("Manage .gitignore:", [
      { value: "add", label: "➕ Add pattern" },
      { value: "template", label: "📋 Apply template" },
      ...aiOption,
      { value: "view", label: "👁  View current entries" },
    ]);

    if (action === "add") return this.addPattern();
    if (action === "template") return this.applyTemplate();
    if (action === "ai") return this.suggestWithAI();
    return this.viewCurrent();
  }

  private async addPattern(): Promise<void> {
    const pattern = await this.ui.askText("Pattern to ignore:", ".env");
    if (!pattern.trim()) return;
    if (!isPattern(pattern)) {
      this.ui.warn("Enter one pattern per line. Escape a leading # to match it literally.");
      return;
    }

    const lines = await this.git.readGitignore();

    if (lines.includes(pattern)) {
      this.ui.warn(`"${pattern}" is already in .gitignore.`);
      return;
    }

    const previouslyIgnored = new Set(await this.git.getIgnoredTrackedFiles());
    await this.git.writeGitignore([...lines, pattern], lines);
    this.ui.success(`Added "${pattern}" to .gitignore.`);

    try {
      await this.untrackMatching(pattern, previouslyIgnored);
    } catch (error) {
      if (error instanceof GoBackSignal) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      this.ui.error(
        `The pattern was saved, but removing files from the index did not complete.\n${detail}`,
      );
    }
  }

  private async untrackMatching(
    pattern: string,
    previouslyIgnored: ReadonlySet<string>,
  ): Promise<void> {
    const readMatches = async () =>
      (await this.git.getIgnoredTrackedFiles())
        .filter((file) => !previouslyIgnored.has(file))
        .sort();
    const matches = await readMatches();
    if (matches.length === 0) return;
    const preview = await this.git.getStagedPathDiff(matches);
    this.ui.info(
      `Paths to remove from the index:\n${matches.map((path) => `  ${JSON.stringify(path)}`).join("\n")}`,
    );

    const confirm = await this.ui.askConfirm(
      `${matches.length} tracked file(s) match "${pattern}". Remove from Git index (git rm --cached)?`,
      false,
    );
    if (!confirm) return;
    if (
      (await this.git.getInProgressOperation()) ||
      JSON.stringify(await readMatches()) !== JSON.stringify(matches) ||
      (await this.git.getStagedPathDiff(matches)) !== preview
    ) {
      this.ui.warn(
        "The ignore matches or Git index changed. The pattern was saved and no files were removed.",
      );
      return;
    }

    await this.git.untrackFiles(matches);
    this.ui.success(`Removed ${matches.length} file(s) from Git index.`);
  }

  private async applyTemplate(): Promise<void> {
    const templateName = await this.ui.askSelect<TemplateName>("Choose a template:", [
      { value: "node", label: "Node.js / TypeScript" },
      { value: "python", label: "Python" },
      { value: "macos", label: "macOS" },
      { value: "go", label: "Go" },
      { value: "rust", label: "Rust" },
      { value: "java", label: "Java" },
      { value: "dotenv", label: ".env files only" },
    ]);

    const existing = await this.git.readGitignore();
    const existingSet = new Set(existing);
    const toAdd = TEMPLATES[templateName].filter((line) => !existingSet.has(line));

    if (toAdd.length === 0) {
      this.ui.info("All template entries are already in .gitignore.");
      return;
    }

    await this.git.writeGitignore(
      insertTemplate(existing, TEMPLATES[templateName], toAdd),
      existing,
    );
    this.ui.success(
      `Added ${toAdd.length} new entr${toAdd.length === 1 ? "y" : "ies"} from ${templateName} template.`,
    );
  }

  private async suggestWithAI(): Promise<void> {
    const suggest = this.aiSuggester;
    if (
      !suggest ||
      !(await confirmAISend(this.ui, "tracked filenames and ignore patterns", suggest))
    )
      return;
    const [tracked, existing] = await Promise.all([
      this.git.getTrackedFiles(),
      this.git.readGitignore(),
    ]);

    const suggestions = await this.ui.spin("Asking AI for suggestions...", () =>
      suggest(tracked, existing),
    );

    if (suggestions.length === 0) {
      this.ui.info("AI found no additional patterns to suggest.");
      return;
    }

    const existingSet = new Set(existing);
    const newOnly = [...new Set(suggestions)].filter((s) => isPattern(s) && !existingSet.has(s));

    if (newOnly.length === 0) {
      this.ui.info("No new valid AI patterns to add.");
      return;
    }

    const selected = await this.ui.askMultiSelect(
      `AI suggests ${newOnly.length} new pattern(s) — select to add:`,
      newOnly.map((p) => ({ value: p, label: p })),
    );

    if (selected.length === 0) return;

    await this.git.writeGitignore([...existing, ...selected], existing);
    this.ui.success(`Added ${selected.length} pattern(s) to .gitignore.`);
  }

  private async viewCurrent(): Promise<void> {
    const lines = await this.git.readGitignore();
    const entries = lines.filter((l) => l.trim() && !l.startsWith("#"));

    if (entries.length === 0) {
      this.ui.warn(".gitignore is empty or does not exist.");
      return;
    }

    this.ui.info(
      `.gitignore — ${entries.length} entr${entries.length === 1 ? "y" : "ies"}:\n${entries.map((e) => `  ${e}`).join("\n")}`,
    );
  }
}

function isPattern(pattern: string): boolean {
  return Boolean(pattern.trim()) && !pattern.startsWith("#") && !/[\0\r\n]/u.test(pattern);
}

function insertTemplate(existing: string[], template: string[], additions: string[]): string[] {
  const result = [...existing];
  const present = new Set(existing);
  const missing = new Set(additions);
  for (const [index, line] of template.entries()) {
    if (!missing.has(line)) continue;
    // Keep a missing exclusion ahead of any later exception already in the file.
    const next = template.slice(index + 1).find((entry) => present.has(entry));
    const at = next === undefined ? result.length : result.lastIndexOf(next);
    result.splice(at, 0, line);
  }
  return result;
}
