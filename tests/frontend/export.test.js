import test from "node:test";
import assert from "node:assert/strict";
import { validatePartitions, moveFieldItem, moveAllFieldItems, ALL_EXPORT_FIELDS } from "../../frontend/js/components/exportModal.js";

test("validatePartitions() accepts valid partition splits summing to 100", () => {
  const result2 = validatePartitions(80, 0, 20);
  assert.equal(result2.valid, true);
  assert.equal(result2.sum, 100);

  const result3 = validatePartitions(70, 15, 15);
  assert.equal(result3.valid, true);
  assert.equal(result3.sum, 100);
});

test("validatePartitions() rejects invalid partition splits not summing to 100", () => {
  const invalidResult = validatePartitions(80, 10, 20);
  assert.equal(invalidResult.valid, false);
  assert.equal(invalidResult.sum, 110);
  assert.ok(invalidResult.message.includes("Partition percentages must sum to 100"));
});

test("moveFieldItem() transfers items between panels correctly", () => {
  const available = ["unit_id", "doc_id"];
  const selected = ["unit_text"];

  moveFieldItem(available, selected, "doc_id");
  assert.deepEqual(available, ["unit_id"]);
  assert.deepEqual(selected, ["unit_text", "doc_id"]);
});

test("moveAllFieldItems() transfers all items between panels correctly", () => {
  const available = ["unit_id", "doc_id"];
  const selected = [];

  moveAllFieldItems(available, selected);
  assert.deepEqual(available, []);
  assert.deepEqual(selected, ["unit_id", "doc_id"]);
});

