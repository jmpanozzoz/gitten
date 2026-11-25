import { containsCredential } from "./shareable-text";

const MAX_DIFF_CHARS = 6000;
const sensitivePath =
  /(?:^|[/\s"])(?:\.env(?:\.[^/\s"]+)?|id_(?:rsa|ed25519)|[^/\s"]+\.(?:key|p12))(?=$|[\s"])/i;

export function shareableDiff(diff: string): string {
  if (containsCredential(diff)) throw sensitiveDiffError();
  for (const line of diff.split("\n")) {
    const header =
      line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ");
    if (header && sensitivePath.test(line)) throw sensitiveDiffError();
  }
  return diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n...(truncated)` : diff;
}

function sensitiveDiffError(): Error {
  return new Error("The diff appears to contain sensitive data. Continue locally without AI.");
}
