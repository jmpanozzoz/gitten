import { emitKeypressEvents, type Key } from "node:readline";
import { GoBackSignal } from "../core/domain/navigation";
import { fit, searchLines } from "./search-renderer";
import { type SearchOption, type SearchOptions, searchKey, searchState } from "./search-state";
import { theme } from "./theme";

export async function searchSelect<T>(
  message: string,
  options: SearchOption<T>[],
  pool?: SearchOption<T>[],
): Promise<T> {
  const [selected] = await runSelection({ message, options, pool, multiple: false });
  return selected.value;
}

export async function searchMultiSelect<T>(
  message: string,
  options: SearchOption<T>[],
): Promise<T[]> {
  const selected = await runSelection({ message, options, multiple: true });
  return selected.map(({ value }) => value);
}

// In single mode Enter is accepted only when a highlighted option exists.
function runSelection<T>(
  options: SearchOptions<T> & { multiple: false },
): Promise<[SearchOption<T>]>;
function runSelection<T>(options: SearchOptions<T>): Promise<SearchOption<T>[]>;
async function runSelection<T>(options: SearchOptions<T>): Promise<SearchOption<T>[]> {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || !output.isTTY) throw new Error("An interactive terminal is required.");

  const state = searchState(options);
  const render = new SearchFrame(output);
  const restore = { raw: input.isRaw, flowing: input.readableFlowing };
  return new Promise((resolve, reject) => {
    const draw = () => render.draw(searchLines(state, output.columns || 80, output.rows || 24));

    function cleanup(): void {
      input.removeListener("keypress", onKey);
      input.removeListener("end", cancel);
      output.removeListener("resize", draw);
      input.setRawMode(restore.raw);
      if (!restore.flowing) input.pause();
      render.finish();
    }

    function cancel(): void {
      cleanup();
      reject(new GoBackSignal());
    }

    function onKey(character: string, key: Key): void {
      const outcome = searchKey(state, character, key);
      if (!outcome) {
        draw();
        return;
      }
      if (outcome.kind === "cancel") {
        cancel();
        return;
      }
      cleanup();
      render.selected(options, outcome.options);
      resolve(outcome.options);
    }

    emitKeypressEvents(input);
    input.setRawMode(true);
    input.on("keypress", onKey);
    input.once("end", cancel);
    output.on("resize", draw);
    input.resume();
    draw();
  });
}

class SearchFrame {
  private rows = 0;

  constructor(private readonly output: typeof process.stdout) {
    output.write("\x1b[?25l");
  }

  private clear(): void {
    if (this.rows > 0) this.output.write(`\x1b[${this.rows}A\x1b[J`);
  }

  draw(lines: string[]): void {
    this.clear();
    this.output.write(`${lines.join("\n")}\n`);
    this.rows = lines.length;
  }

  finish(): void {
    this.clear();
    this.output.write("\x1b[?25h");
  }

  selected<T>(options: SearchOptions<T>, selected: SearchOption<T>[]): void {
    const summary = options.multiple ? `${selected.length} item(s) selected` : selected[0]!.label;
    const line = fit(`◇  ${options.message} · ${summary}`, this.output.columns || 80);
    this.output.write(`${theme.success(line)}\n`);
  }
}
