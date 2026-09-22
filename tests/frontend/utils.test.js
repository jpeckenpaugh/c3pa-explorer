import test from "node:test";
import assert from "node:assert/strict";
import { esc, highlightMatch } from "../../frontend/js/core/utils.js";

test("esc() escapes HTML special characters", () => {
  assert.equal(esc('<script>alert("xss & \'1\'")</script>'), '&lt;script&gt;alert(&quot;xss &amp; &#39;1&#39;&quot;)&lt;/script&gt;');
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(123), "123");
});

test("highlightMatch() wraps matched query in mark tags", () => {
  const text = "California Consumer Privacy Act";
  const query = "Privacy";
  const result = highlightMatch(text, query);
  assert.equal(result, 'California Consumer <mark class="bg-warning-subtle text-dark px-1 rounded">Privacy</mark> Act');
});

test("highlightMatch() handles regex special characters safely in query", () => {
  const text = "Item (1.a) is privacy policy.";
  const query = "(1.a)";
  const result = highlightMatch(text, query);
  assert.equal(result, 'Item <mark class="bg-warning-subtle text-dark px-1 rounded">(1.a)</mark> is privacy policy.');
});

test("highlightMatch() returns escaped text when query is empty", () => {
  assert.equal(highlightMatch("<b>Test</b>", ""), "&lt;b&gt;Test&lt;/b&gt;");
});
