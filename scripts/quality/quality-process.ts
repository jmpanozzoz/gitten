import { type ChildProcess, spawn } from "node:child_process";

interface QualityProcess {
  cwd: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}

export async function runQualityProcess(
  args: string[],
  { cwd, env, signal }: QualityProcess,
): Promise<void> {
  signal.throwIfAborted();
  const processGroup = process.platform !== "win32";
  const child = spawn(process.execPath, ["--no-env-file", ...args], {
    cwd,
    env,
    detached: processGroup,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const result = new Promise<{ code: number | null; exitSignal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, exitSignal) => resolve({ code, exitSignal }));
    },
  );
  const cancel = () => stopQualityProcess(child, processGroup);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const { code, exitSignal } = await result;
    signal.throwIfAborted();
    if (exitSignal) throw new Error(`bun ${args.join(" ")} was terminated by ${exitSignal}.`);
    if (code !== 0) throw new Error(`bun ${args.join(" ")} failed with exit code ${code}.`);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export function stopQualityProcess(
  child: Pick<ChildProcess, "pid" | "kill">,
  processGroup: boolean,
  kill: (pid: number, signal: NodeJS.Signals) => void = process.kill,
): void {
  if (child.pid === undefined) return;
  try {
    if (processGroup) kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      console.error("Could not stop the quality process.", error);
    }
  }
}
