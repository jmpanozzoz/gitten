import { GoBackSignal } from "../../../src/core/domain/navigation";
import { searchMultiSelect, searchSelect } from "../../../src/ui/search-select";

const options = [
  { value: "first", label: "First option" },
  { value: "coffee", label: "Café nuevo" },
];

try {
  const result =
    process.argv[2] === "multi"
      ? await searchMultiSelect("Pick", options)
      : await searchSelect("Pick", options);
  console.log("RESULT", JSON.stringify(result));
} catch (error) {
  if (!(error instanceof GoBackSignal)) throw error;
  console.log("CANCELLED");
}
