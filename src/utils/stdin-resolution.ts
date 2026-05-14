import * as readline from "node:readline";

export function stdinResolution(): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    process.stdin.setRawMode(true);
    process.stdin.once("data", (key: Buffer) => {
      rl.close();
      process.stdin.setRawMode(false);
      resolve(key[0] !== 0x1b);
    });
  });
}
