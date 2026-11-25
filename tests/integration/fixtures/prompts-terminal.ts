import { GoBackSignal } from "../../../src/core/domain/navigation";
import { UI } from "../../../src/ui/prompts";

const ui = new UI();
const options = [
  { value: "first", label: "First\noption" },
  { value: "coffee", label: "Café option" },
];

async function answers() {
  const text = await ui.askText("Write a message");
  const edited = await ui.askText("Edit a message", "Placeholder\nline", "keep\nthis");
  const confirmed = await ui.askConfirm("Allow removal?");
  const selected = await ui.askSelect("Select one option", options);
  const multiple = await ui.askMultiSelect("Select several options", options);
  const secret = await ui.askSecret("Enter a private value");
  console.log(
    "RESULT",
    JSON.stringify({
      text,
      edited,
      confirmed,
      selected,
      multiple,
      privateValueAccepted: secret === "typed-private-value",
    }),
  );
}

async function cancellation() {
  const prompts = {
    select: () => ui.askSelect("Cancel a selection", options),
    multiple: () => ui.askMultiSelect("Cancel multiple options", options),
    text: () => ui.askText("Cancel a text entry"),
    secret: () => ui.askSecret("Cancel a private value"),
    confirm: () => ui.askConfirm("Cancel a confirmation"),
  };
  for (const [name, ask] of Object.entries(prompts)) {
    try {
      await ask();
      throw new Error(`Prompt ${name} did not cancel`);
    } catch (error) {
      if (!(error instanceof GoBackSignal)) throw error;
      console.log("CANCELLED", name);
    }
  }
  console.log("DONE");
}

async function recovery() {
  for (let index = 1; index <= 4; index++) {
    console.log(`RECOVERY ${index}`, JSON.stringify(await ui.waitForConflictResolution()));
  }
}

async function search() {
  process.stdin.resume();
  console.log(
    "VISIBLE",
    JSON.stringify(await ui.askSearchSelect("Search visible options", options)),
  );
  if (process.stdin.readableFlowing) console.log("INPUT STILL FLOWING");
  process.stdin.pause();
  console.log(
    "POOLED",
    JSON.stringify(
      await ui.askSearchSelect("Search all options", options, [
        { value: "extra", label: "Extra\nentry" },
      ]),
    ),
  );
  console.log(
    "MULTIPLE",
    JSON.stringify(await ui.askSearchMultiSelect("Search several options", options)),
  );
}

async function output() {
  ui.intro("Start");
  ui.context("Repository · main");
  ui.info("Info café");
  ui.warn("Warning");
  ui.error("Error");
  ui.success("Success");
  ui.showDiff("-before\n+after\nremaining", 2);
  console.log("SPIN", await ui.spin("Reading...", async () => 42));
  try {
    await ui.spin("Writing…", async () => {
      throw new Error("disk unavailable");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "disk unavailable") throw error;
    console.log("TASK FAILED");
  }
  ui.outro("Finished");
  console.log("DONE");
}

async function unicodeLayout() {
  const name = "café\u202e日本語";
  ui.context(`Repository · ${name}`);
  ui.showDiff(`-before\n+${name}\u2028continued`);
  const answer = await ui.askSearchSelect("Review refs", [
    { value: "ordinary", label: "ordinary" },
    { value: name, label: name },
  ]);
  console.log(`ORIGINAL REF ${answer === name}`);
}

const scenario = process.argv[2];
const suites = { answers, cancellation, recovery, search, output, unicodeLayout };
if (!Object.hasOwn(suites, scenario ?? "")) throw new Error("Unknown prompt fixture");
await suites[scenario as keyof typeof suites]();
