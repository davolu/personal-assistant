import assert from "node:assert/strict";
import { test } from "node:test";
import { measureKeyboard } from "./mobile-viewport";

const phone = { innerWidth: 390, innerHeight: 844, visualHeight: 844, offsetTop: 0, baselineWidth: 0, baselineHeight: 0, focused: false };

test("a full screen starts closed and remembers its height", () => {
  const next = measureKeyboard(phone);
  assert.equal(next.open, false);
  assert.equal(next.inset, 0);
  assert.equal(next.baselineHeight, 844);
  assert.equal(next.baselineWidth, 390);
  assert.equal(next.height, 844);
});

test("the URL bar does not count as a keyboard", () => {
  const next = measureKeyboard({ ...phone, innerHeight: 788, visualHeight: 788, baselineWidth: 390, baselineHeight: 844 });
  assert.equal(next.open, false);
  assert.equal(next.inset, 0);
  assert.equal(next.baselineHeight, 788);
});

test("Android resizes-content still counts as a keyboard when the width stays put", () => {
  const next = measureKeyboard({ ...phone, innerHeight: 430, visualHeight: 430, baselineWidth: 390, baselineHeight: 844 });
  assert.equal(next.open, true);
  assert.equal(next.height, 430);
  assert.equal(next.top, 0);
  assert.equal(next.inset, 414);
  assert.equal(next.baselineHeight, 844);
});

test("iOS keeps the shell on the visual viewport while the layout stays tall", () => {
  const next = measureKeyboard({ ...phone, visualHeight: 430, offsetTop: 160, baselineWidth: 390, baselineHeight: 844 });
  assert.equal(next.open, true);
  assert.equal(next.top, 160);
  assert.equal(next.height, 430);
  assert.equal(next.inset, 414);
});

test("focus opens the keyboard before the viewport has resized", () => {
  const next = measureKeyboard({ ...phone, baselineWidth: 390, baselineHeight: 844, focused: true });
  assert.equal(next.open, true);
  assert.equal(next.inset, 0);
  assert.equal(next.baselineHeight, 844);
  assert.equal(next.height, 844);
});

test("rotating the phone updates the baseline instead of hiding the tab bar", () => {
  const next = measureKeyboard({ ...phone, innerWidth: 844, innerHeight: 390, visualHeight: 390, baselineWidth: 390, baselineHeight: 844 });
  assert.equal(next.open, false);
  assert.equal(next.baselineWidth, 844);
  assert.equal(next.baselineHeight, 390);
});

test("non-finite sizes stay closed", () => {
  const next = measureKeyboard({ ...phone, innerHeight: Number.NaN, visualHeight: Number.POSITIVE_INFINITY, baselineHeight: Number.NaN });
  assert.equal(next.open, false);
  assert.equal(next.height, 0);
});
