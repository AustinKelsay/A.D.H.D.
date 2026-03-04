import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROMPT_VERSION = "conductor.v1";
const SELF_PATH = fileURLToPath(import.meta.url);
const PROMPT_PATH = path.join(path.dirname(SELF_PATH), "prompts", "conductor.v1.md");

export function getConductorPromptPackage() {
  const promptText = fs.readFileSync(PROMPT_PATH, "utf8");

  return {
    version: PROMPT_VERSION,
    promptPath: "src/intent/prompts/conductor.v1.md",
    promptText
  };
}
