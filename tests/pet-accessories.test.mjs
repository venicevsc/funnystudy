import assert from "node:assert/strict";
import test from "node:test";

import {
  equippableAccessory,
  findAccessory,
  isUnlocked,
  newlyUnlocked,
  normalizeAccessory,
  PET_ACCESSORIES,
  unlockHint,
} from "../src/lib/pet-accessories.ts";

const p = (captionsRated, studiesCompleted = 0) => ({ captionsRated, studiesCompleted });

test("a brand-new participant has nothing unlocked", () => {
  assert.equal(PET_ACCESSORIES.filter((a) => isUnlocked(a, p(0))).length, 0);
});

test("caption milestones unlock at exactly their threshold", () => {
  const bow = findAccessory("bow");
  assert.equal(isUnlocked(bow, p(4)), false);
  assert.equal(isUnlocked(bow, p(5)), true);
  assert.equal(isUnlocked(findAccessory("crown"), p(99, 5)), false);
  assert.equal(isUnlocked(findAccessory("crown"), p(100)), true);
});

test("the graduation cap needs a completed study, not captions", () => {
  const grad = findAccessory("grad");
  assert.equal(isUnlocked(grad, p(500, 0)), false);
  assert.equal(isUnlocked(grad, p(0, 1)), true);
});

test("hints say what is still needed", () => {
  assert.equal(unlockHint(findAccessory("shades"), p(10)), "Rate 5 more captions");
  assert.equal(unlockHint(findAccessory("shades"), p(14)), "Rate 1 more caption");
  assert.equal(unlockHint(findAccessory("grad"), p(10)), "Complete a study");
});

test("the fifth caption unlocks the bow tie, and only then", () => {
  assert.deepEqual(newlyUnlocked(p(3), p(4)).map((a) => a.id), []);
  assert.deepEqual(newlyUnlocked(p(4), p(5)).map((a) => a.id), ["bow"]);
  assert.deepEqual(newlyUnlocked(p(5), p(6)).map((a) => a.id), []);
});

test("unknown or locked values are never equipped", () => {
  assert.equal(normalizeAccessory("top-hat"), null);
  assert.equal(normalizeAccessory(undefined), null);
  assert.equal(normalizeAccessory("bow"), "bow");
  assert.equal(equippableAccessory("crown", p(10)), null);
  assert.equal(equippableAccessory("bow", p(10)), "bow");
  assert.equal(equippableAccessory(null, p(500, 5)), null);
});
