import type { AskOption } from "./types";

export const ASK_USER_TOOL = {
  name: "ask_user",
  description:
    "Ask the user one question when you are stuck or several real options remain. The run pauses until they answer. You decide when to ask. Pass options when you have real choices. Set multiSelect if more than one can apply, and allowCustom if they may type their own answer.",
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string" },
      choices: { type: "array", items: { type: "string" }, description: "Plain labels. Prefer options when a choice needs its own value or description." },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
            description: { type: "string" },
          },
          required: ["label", "value"],
        },
      },
      multiSelect: { type: "boolean" },
      allowCustom: { type: "boolean" },
    },
    required: ["question"],
  },
};

export type AskPrompt = {
  question: string;
  options: AskOption[];
  choices: string[];
  multiSelect: boolean;
  allowCustom: boolean;
};

const MAX_OPTIONS = 6;

export function parseAskInput(input: object | null | undefined): AskPrompt {
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const question = String(record.question ?? "What should I do next?").trim().slice(0, 500) || "What should I do next?";
  const options = normalizeOptions(record);
  return {
    question,
    options,
    choices: options.map((option) => option.value),
    multiSelect: record.multiSelect === true,
    allowCustom: record.allowCustom === true,
  };
}

export function formatAskAnswer(input: { values: string[]; custom?: string }): string {
  const picked = input.values.map((value) => value.trim()).filter(Boolean);
  const custom = (input.custom ?? "").trim();
  if (picked.length && custom) return `${picked.join(", ")} (other: ${custom})`;
  if (picked.length) return picked.join(", ");
  return custom;
}

/** Single-select submits immediately. Multi-select only updates the selection. */
export function nextAskSelection(current: string[], value: string, multiSelect: boolean): { selected: string[]; answer?: string } {
  if (!multiSelect) return { selected: [value], answer: value };
  const selected = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  return { selected };
}

function normalizeOptions(record: Record<string, unknown>): AskOption[] {
  const structured = Array.isArray(record.options) ? record.options.map(toOption).filter((option): option is AskOption => option !== null) : [];
  if (structured.length) return dedupe(structured).slice(0, MAX_OPTIONS);
  const choices = Array.isArray(record.choices) ? record.choices : [];
  return dedupe(
    choices
      .map((item) => String(item).trim())
      .filter(Boolean)
      .map((choice) => ({ label: choice.slice(0, 120), value: choice.slice(0, 200) }))
  ).slice(0, MAX_OPTIONS);
}

function toOption(item: unknown): AskOption | null {
  if (typeof item === "string") {
    const text = item.trim();
    return text ? { label: text.slice(0, 120), value: text.slice(0, 200) } : null;
  }
  if (!item || typeof item !== "object") return null;
  const record = item as { label?: unknown; value?: unknown; description?: unknown };
  const label = String(record.label ?? record.value ?? "").trim();
  const value = String(record.value ?? record.label ?? "").trim();
  if (!label || !value) return null;
  const description = typeof record.description === "string" ? record.description.trim().slice(0, 240) : "";
  return description
    ? { label: label.slice(0, 120), value: value.slice(0, 200), description }
    : { label: label.slice(0, 120), value: value.slice(0, 200) };
}

function dedupe(options: AskOption[]): AskOption[] {
  const seen = new Set<string>();
  const unique: AskOption[] = [];
  for (const option of options) {
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    unique.push(option);
  }
  return unique;
}
