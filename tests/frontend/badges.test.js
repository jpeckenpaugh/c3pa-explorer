import test from "node:test";
import assert from "node:assert/strict";
import { labelColor, labelDescription, badge, kindBadge, catBadge, LABEL_COLORS } from "../../frontend/js/components/badges.js";

test("labelColor() returns mapped color or default fallback", () => {
  assert.equal(labelColor("Categories of Personal Information Collected"), "#0d6efd");
  assert.equal(labelColor("Description of Right to Delete"), "#e11d48");
  assert.equal(labelColor("Unknown Label"), "#6c757d");
});

test("labelDescription() returns description or empty string", () => {
  assert.ok(labelDescription("Updated Privacy Policy").includes("Policy-change notices"));
  assert.equal(labelDescription("Non Existent Label"), "");
});

test("badge() generates HTML badge element with background color", () => {
  const result = badge("Others");
  assert.equal(result, '<span class="badge" style="background:#64748b">Others</span>');
});

test("kindBadge() formats sentence and fragment unit kinds", () => {
  assert.equal(kindBadge({ unit_kind: "sentence" }), '<span class="badge text-bg-success">sentence</span>');
  assert.equal(
    kindBadge({ unit_kind: "fragment", fragment_type: "heading" }),
    '<span class="badge text-bg-secondary">fragment &middot; heading</span>'
  );
});

test("catBadge() formats label categories", () => {
  assert.equal(catBadge("single_label"), '<span class="badge text-bg-primary">single_label</span>');
  assert.equal(catBadge("multi_label"), '<span class="badge text-bg-warning">multi_label</span>');
  assert.equal(catBadge("unlabeled"), '<span class="badge text-bg-light text-dark border">unlabeled</span>');
  assert.equal(catBadge("not-eligible"), '<span class="badge text-bg-secondary">not-eligible</span>');
});
