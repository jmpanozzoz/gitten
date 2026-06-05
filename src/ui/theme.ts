import pc from "picocolors";

export const theme = {
  success: (msg: string) => pc.green(msg),
  warn: (msg: string) => pc.yellow(msg),
  error: (msg: string) => pc.red(msg),
  info: (msg: string) => pc.cyan(msg),
  muted: (msg: string) => pc.gray(msg),
  bold: (msg: string) => pc.bold(msg),
  highlight: (msg: string) => pc.magenta(msg),
  accent: (msg: string) => pc.cyan(msg),
  dim: (msg: string) => pc.dim(msg),
  bright: (msg: string) => pc.white(msg),
  additions: (n: number) => pc.green(`+${n}`),
  deletions: (n: number) => pc.red(`−${n}`),
  diffAdd: (line: string) => pc.green(line),
  diffRemove: (line: string) => pc.red(line),
};
