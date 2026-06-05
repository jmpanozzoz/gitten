import type { AIGitignoreSuggester } from "./ports/ai.port";
import type { IGitClient } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

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
    private readonly git: IGitClient,
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
    if (action === "view") return this.viewCurrent();
  }

  private async addPattern(): Promise<void> {
    const pattern = await this.ui.askText("Pattern to ignore:", ".env");
    if (!pattern.trim()) return;

    const lines = await this.git.readGitignore();

    if (lines.includes(pattern)) {
      this.ui.warn(`"${pattern}" is already in .gitignore.`);
      return;
    }

    await this.git.writeGitignore([...lines, pattern]);
    this.ui.success(`Added "${pattern}" to .gitignore.`);

    await this.untrackMatching(pattern);
  }

  private async untrackMatching(pattern: string): Promise<void> {
    const tracked = await this.git.getTrackedFiles();
    const glob = new Bun.Glob(pattern);
    const matches = tracked.filter((f) => glob.match(f));

    if (matches.length === 0) return;

    const confirm = await this.ui.askConfirm(
      `${matches.length} tracked file(s) match "${pattern}". Remove from Git index (git rm --cached)?`,
    );
    if (!confirm) return;

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

    await this.git.writeGitignore([...existing, ...toAdd]);
    this.ui.success(
      `Added ${toAdd.length} new entr${toAdd.length === 1 ? "y" : "ies"} from ${templateName} template.`,
    );
  }

  private async suggestWithAI(): Promise<void> {
    const [tracked, existing] = await Promise.all([
      this.git.getTrackedFiles(),
      this.git.readGitignore(),
    ]);

    const suggestions = await this.ui.spin("Asking AI for suggestions...", () =>
      this.aiSuggester!(tracked, existing),
    );

    if (suggestions.length === 0) {
      this.ui.info("AI found no additional patterns to suggest.");
      return;
    }

    const existingSet = new Set(existing);
    const newOnly = suggestions.filter((s) => !existingSet.has(s));

    if (newOnly.length === 0) {
      this.ui.info("All AI suggestions are already in .gitignore.");
      return;
    }

    const selected = await this.ui.askMultiSelect(
      `AI suggests ${newOnly.length} new pattern(s) — select to add:`,
      newOnly.map((p) => ({ value: p, label: p })),
    );

    if (selected.length === 0) return;

    await this.git.writeGitignore([...existing, ...selected]);
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
