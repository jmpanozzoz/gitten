import { redactRemoteCredentials } from "../core/domain/remote-display";
import { hasLayoutControl } from "../core/domain/text-layout";

export function terminalText(text: string, singleLine = false): string {
  return Array.from(redactRemoteCredentials(text), (character) => {
    if (character === "\n" || character === "\t") return singleLine ? " " : character;
    const value = character.charCodeAt(0);
    if (hasLayoutControl(character))
      return `[U+${value.toString(16).toUpperCase().padStart(4, "0")}]`;
    return value < 32 || (value >= 127 && value <= 159) ? "�" : character;
  }).join("");
}
