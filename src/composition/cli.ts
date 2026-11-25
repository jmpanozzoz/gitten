import { terminalText } from "../ui/terminal-text";

interface Cli {
  args: string[];
  version: string;
  interactive: boolean;
  gitPrerequisiteIssue: () => string | undefined;
  start: () => Promise<number>;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

const usage =
  "Usage: gitten [--help | --version]\nRun without flags to open the interactive Git menu.";

export async function runCli(cli: Cli): Promise<number> {
  const [argument] = cli.args;
  switch (cli.args.length === 1 ? argument : undefined) {
    case "--help":
    case "-h":
      cli.stdout(usage);
      return 0;
    case "--version":
    case "-v":
      cli.stdout(`gitten v${cli.version}`);
      return 0;
  }

  if (cli.args.length > 0) {
    cli.stderr(usage);
    return 2;
  }
  if (!cli.interactive) {
    cli.stderr("An interactive terminal is required. Run gitten --help for usage.");
    return 2;
  }
  return startInteractive(cli);
}

async function startInteractive(cli: Cli): Promise<number> {
  const issue = cli.gitPrerequisiteIssue();
  if (issue) {
    cli.stderr(issue);
    return 1;
  }
  try {
    return await cli.start();
  } catch (error) {
    cli.stderr(
      `Unexpected error: ${terminalText(error instanceof Error ? error.message : String(error))}`,
    );
    return 1;
  }
}
