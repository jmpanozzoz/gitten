import { redactRemoteCredentials } from "../core/domain/remote-display";

const credentialPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAuthorization[ \t]*:[ \t]*(?:Bearer|Basic)[ \t]+\S+/i,
  /\b(?:api[-_]?key|access[-_]?token|password|secret)\b["']?[ \t]*[:=][ \t]*["'][^"'\r\n]{8,}["']/i,
  /\b(?:api[-_]?key|access[-_]?token|password|secret)\b[ \t]*=[ \t]*[^\s"'`,;#]{8,}/i,
];

export function containsCredential(text: string): boolean {
  return (
    credentialPatterns.some((pattern) => pattern.test(text)) ||
    redactRemoteCredentials(text) !== text
  );
}

export function assertShareablePrompt(text: string): void {
  if (containsCredential(text)) {
    throw new Error("The request appears to contain sensitive data. Continue locally without AI.");
  }
}
