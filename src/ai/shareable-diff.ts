const MAX_DIFF_CHARS = 6000;
const secretLike = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAuthorization\s*:\s*Bearer\s+\S+/i,
  /\b(?:api[-_]?key|access[-_]?token|password|secret)\b["']?\s*[:=]\s*["'][^"']{8,}["']/i,
];
const sensitivePath =
  /(?:^|[/\s"])(?:\.env(?:\.[^/\s"]+)?|id_(?:rsa|ed25519)|[^/\s"]+\.(?:key|p12))(?=$|[\s"])/i;

export function shareableDiff(diff: string): string {
  for (const line of diff.split("\n")) {
    const header =
      line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ");
    if ((header && sensitivePath.test(line)) || secretLike.some((pattern) => pattern.test(line))) {
      throw new Error("The diff appears to contain sensitive data. Continue locally without AI.");
    }
  }
  return diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n...(truncated)` : diff;
}
