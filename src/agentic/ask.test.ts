import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAskAnswer, nextAskSelection, parseAskInput } from "./ask";

test("structured ask options keep label, value, and description", () => {
  const ask = parseAskInput({
    question: "Which list?",
    options: [
      { label: "Product", value: "product", description: "Weekly recap" },
      { label: "Leads", value: "leads" },
      { label: "", value: "" },
    ],
    multiSelect: true,
    allowCustom: true,
  });
  assert.equal(ask.question, "Which list?");
  assert.equal(ask.multiSelect, true);
  assert.equal(ask.allowCustom, true);
  assert.deepEqual(ask.options, [
    { label: "Product", value: "product", description: "Weekly recap" },
    { label: "Leads", value: "leads" },
  ]);
  assert.deepEqual(ask.choices, ["product", "leads"]);
});

test("plain choices still become selectable options", () => {
  const ask = parseAskInput({ question: "Which John?", choices: ["John Ade", "John B", "John Ade"] });
  assert.equal(ask.multiSelect, false);
  assert.equal(ask.allowCustom, false);
  assert.deepEqual(ask.choices, ["John Ade", "John B"]);
  assert.deepEqual(ask.options, [
    { label: "John Ade", value: "John Ade" },
    { label: "John B", value: "John B" },
  ]);
});

test("a click sends one value, and multi-select waits", () => {
  assert.deepEqual(nextAskSelection([], "product", false), { selected: ["product"], answer: "product" });
  assert.deepEqual(nextAskSelection([], "product", true), { selected: ["product"] });
  assert.deepEqual(nextAskSelection(["product"], "leads", true), { selected: ["product", "leads"] });
  assert.deepEqual(nextAskSelection(["product", "leads"], "product", true), { selected: ["leads"] });
  assert.equal(formatAskAnswer({ values: ["product", "leads"] }), "product, leads");
  assert.equal(formatAskAnswer({ values: ["product"], custom: "finance" }), "product (other: finance)");
  assert.equal(formatAskAnswer({ values: [], custom: "finance" }), "finance");
});
