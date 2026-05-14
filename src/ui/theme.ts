import pc from "picocolors";

export const theme = {
  success: (msg: string) => pc.green(msg),
  warn: (msg: string) => pc.yellow(msg),
  error: (msg: string) => pc.red(msg),
  info: (msg: string) => pc.cyan(msg),
  muted: (msg: string) => pc.gray(msg),
  bold: (msg: string) => pc.bold(msg),
  highlight: (msg: string) => pc.magenta(msg),
};
