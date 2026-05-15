import type { AIConfig } from "../config/config";
import type { BranchType } from "./ports/ui.port";

const MAX_DIFF_CHARS = 6000;

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
  return callAI(BRANCH_SYSTEM_PROMPT, `Type: ${type}\nDescription: ${description}`, config);
}

export async function suggestCommitMessage(
  diff: string,
  config: AIConfig
): Promise<string | null> {
  const truncated = diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + "\n...(truncated)" : diff;
  return callAI(COMMIT_SYSTEM_PROMPT, `Staged diff:\n\`\`\`\n${truncated}\n\`\`\``, config);
}

export async function suggestGitignorePatterns(
  trackedFiles: string[],
  existingPatterns: string[],
  config: AIConfig
): Promise<string[]> {
  const prompt = `Tracked files:\n${trackedFiles.slice(0, 100).join("\n")}\n\nCurrent .gitignore:\n${existingPatterns.join("\n")}`;
  const result = await callAI(GITIGNORE_SYSTEM_PROMPT, prompt, config);
  if (!result) return [];
  return result.split("\n").map((l) => l.trim()).filter(Boolean);
}

async function callAI(systemPrompt: string, userMessage: string, config: AIConfig): Promise<string | null> {
  try {
    const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
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
        max_tokens: 150,
        temperature: 0.3,
      }),
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}
