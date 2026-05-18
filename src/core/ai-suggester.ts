import type { AIConfig } from "../config/config";
import type { BranchType } from "./ports/ui.port";

const MAX_DIFF_CHARS = 6000;
const CALL_TIMEOUT_MS = 20_000;

const MAX_TOKENS = {
  branch: 60,
  commit: 120,
  amend: 120,
  review: 500,
  gitignore: 300,
  explain: 80,
  summarize: 200,
  test: 5,
} as const;

const BRANCH_SYSTEM_PROMPT = `You are a git branch name slug generator. Given a branch type and description, output a concise slug.

Rules:
- Output ONLY the slug — no type prefix, no explanation
- Lowercase letters, numbers, and hyphens only
- Maximum 40 characters
- Be concise — remove filler words, abbreviate where obvious
- Example: type=feat, description="add user authentication with google oauth" → "oauth-user-auth"`;

const COMMIT_SYSTEM_PROMPT = `You are a git commit message generator. Given a staged diff, output a single conventional commit message.

Rules:
- Format: type: description  (e.g. "feat: add user login")
- Types: feat, fix, chore, docs, refactor, test, style
- Max 72 characters total
- Lowercase, imperative mood
- No period at the end
- Output ONLY the commit message — nothing else`;

const AMEND_SYSTEM_PROMPT = `You are a git commit message improver. Given an existing commit message, rewrite it to follow conventional commits format.

Rules:
- Format: type: description  (e.g. "feat: add user login")
- Types: feat, fix, chore, docs, refactor, test, style
- Max 72 characters total
- Lowercase, imperative mood
- No period at the end
- Keep the same intent, just fix the format and wording
- Output ONLY the improved commit message — nothing else`;

const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer. Given a staged git diff, identify concrete issues only.

Rules:
- Report only real problems: bugs, hardcoded secrets or values, missing error handling, obvious security issues, forgotten TODOs/FIXMEs
- One finding per line, no numbering, no bullet points
- Max 5 findings
- If nothing is wrong, output exactly: OK
- Be brief — max 10 words per finding`;

const GITIGNORE_SYSTEM_PROMPT = `You are a .gitignore expert. Given a list of tracked files and the current .gitignore content, suggest additional patterns that should be ignored for this project.

Rules:
- Output one pattern per line
- Only suggest patterns not already in the .gitignore
- Focus on secrets, build artifacts, IDE files, OS files
- Output ONLY the patterns — no explanation, no blank lines`;

export async function suggestBranchName(
  type: BranchType,
  description: string,
  config: AIConfig
): Promise<string | null> {
  return callAI(BRANCH_SYSTEM_PROMPT, `Type: ${type}\nDescription: ${description}`, config, MAX_TOKENS.branch);
}

export async function suggestCommitMessage(
  diff: string,
  config: AIConfig
): Promise<string | null> {
  const truncated = diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + "\n...(truncated)" : diff;
  return callAI(COMMIT_SYSTEM_PROMPT, `Staged diff:\n\`\`\`\n${truncated}\n\`\`\``, config, MAX_TOKENS.commit);
}

export async function suggestAmendMessage(
  currentMessage: string,
  config: AIConfig
): Promise<string | null> {
  return callAI(AMEND_SYSTEM_PROMPT, `Existing message: ${currentMessage}`, config, MAX_TOKENS.amend);
}

export async function reviewStagedDiff(
  diff: string,
  config: AIConfig
): Promise<string[]> {
  const truncated = diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + "\n...(truncated)" : diff;
  try {
    const result = await callAI(REVIEW_SYSTEM_PROMPT, `Staged diff:\n\`\`\`\n${truncated}\n\`\`\``, config, MAX_TOKENS.review);
    if (!result || result.trim() === "OK") return [];
    return result.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function suggestGitignorePatterns(
  trackedFiles: string[],
  existingPatterns: string[],
  config: AIConfig
): Promise<string[]> {
  const prompt = `Tracked files:\n${trackedFiles.slice(0, 100).join("\n")}\n\nCurrent .gitignore:\n${existingPatterns.join("\n")}`;
  try {
    const result = await callAI(GITIGNORE_SYSTEM_PROMPT, prompt, config, MAX_TOKENS.gitignore);
    if (!result) return [];
    return result.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const EXPLAIN_COMMIT_SYSTEM_PROMPT = `You are a git commit analyst. Given a commit diff, explain in one concise sentence what it does and why.

Rules:
- One sentence, max 80 characters
- Start with a verb (e.g. "Fixes", "Adds", "Removes", "Refactors")
- Focus on intent, not mechanics
- Output ONLY the explanation — nothing else`;

const SUMMARIZE_COMMITS_SYSTEM_PROMPT = `You are a changelog generator. Given a list of commit messages, produce a concise bullet-point summary.

Rules:
- Max 5 bullets, using "•" as the bullet character
- Group related changes together
- Focus on user-facing impact
- Omit trivial chore/style commits unless they are the only ones
- Output ONLY the bullet points — no headers, no blank lines`;

export async function explainCommitDiff(diff: string, config: AIConfig): Promise<string | null> {
  const truncated = diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + "\n...(truncated)" : diff;
  return callAI(EXPLAIN_COMMIT_SYSTEM_PROMPT, `Commit diff:\n\`\`\`\n${truncated}\n\`\`\``, config, MAX_TOKENS.explain);
}

export async function summarizeCommits(messages: string[], config: AIConfig): Promise<string | null> {
  const prompt = messages.map((m, i) => `${i + 1}. ${m}`).join("\n");
  return callAI(SUMMARIZE_COMMITS_SYSTEM_PROMPT, `Commit messages:\n${prompt}`, config, MAX_TOKENS.summarize);
}

export async function testAIConnection(config: AIConfig): Promise<void> {
  await callAI("Reply with exactly: OK", "Test", config, MAX_TOKENS.test);
}

async function callAI(
  systemPrompt: string,
  userMessage: string,
  config: AIConfig,
  maxTokens: number
): Promise<string | null> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${CALL_TIMEOUT_MS / 1000}s — is ${config.baseUrl} reachable?`);
    }
    throw new Error(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(await classifyHttpError(response));
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string; code?: number };
  };

  if (data.error) {
    throw new Error(data.error.message ?? `API error ${data.error.code ?? "unknown"}`);
  }

  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function classifyHttpError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch { /* fall through to status-based message */ }

  switch (response.status) {
    case 401: return "Invalid API key — check your credentials in Settings";
    case 403: return "Access denied — verify your API key has the right permissions";
    case 404: return "Model not found — check the model name in Settings";
    case 429: return "Rate limit hit — wait a moment and try again";
    case 500:
    case 502:
    case 503: return `Provider error (${response.status}) — the AI service may be down`;
    default:  return `HTTP ${response.status}`;
  }
}
