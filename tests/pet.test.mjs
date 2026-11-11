import assert from "node:assert/strict";
import test from "node:test";

import { applyVote, computePetState, eventMessage, PET_RULES } from "../src/lib/pet.ts";

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-06T12:00:00Z");
const vote = (minutesAgo, ms = 3000) => ({ at: T0 - minutesAgo * 60 * 1000, timeToVoteMs: ms });
const fresh = { adoptedAt: T0 - 1000, votes: [] };

test("a newly adopted pet is full and happy", () => {
  const s = computePetState(fresh, T0);
  assert.equal(s.mood, "happy");
  assert.equal(s.fullness, 100);
});

test("hunger stages follow the hours since the last vote", () => {
  const at = (hours) => computePetState({ adoptedAt: T0 - 100 * HOUR, votes: [{ at: T0 - hours * HOUR, timeToVoteMs: 3000 }] }, T0).mood;
  assert.equal(at(1), "happy");
  assert.equal(at(13), "peckish");
  assert.equal(at(25), "hungry");
  assert.equal(at(49), "starving");
  assert.equal(at(73), "gone");
});

test("fullness drains to zero when the pet is gone", () => {
  const s = computePetState({ adoptedAt: T0 - 200 * HOUR, votes: [] }, T0);
  assert.equal(s.isGone, true);
  assert.equal(s.fullness, 0);
});

test("an old voter who just adopted is not instantly gone", () => {
  const s = computePetState({ adoptedAt: T0 - 60 * 1000, votes: [{ at: T0 - 500 * HOUR, timeToVoteMs: 3000 }] }, T0);
  assert.equal(s.mood, "happy");
});

test("five rushed votes in a row make the pet sick", () => {
  const votes = [1, 2, 3, 4, 5].map((m) => vote(m, 200));
  const s = computePetState({ adoptedAt: T0 - HOUR, votes }, T0);
  assert.equal(s.mood, "sick");
  assert.equal(s.rushedVotes, 5);
});

test("four rushed votes and one normal one is fine", () => {
  const votes = [vote(1, 200), vote(2, 200), vote(3, 200), vote(4, 200), vote(5, 4000)];
  assert.equal(computePetState({ adoptedAt: T0 - HOUR, votes }, T0).mood, "happy");
});

test("votes of unknown speed are never counted as rushed", () => {
  const votes = [1, 2, 3, 4, 5].map((m) => vote(m, null));
  assert.equal(computePetState({ adoptedAt: T0 - HOUR, votes }, T0).mood, "happy");
});

test("a vote exactly at the limit is not rushed", () => {
  const votes = [1, 2, 3, 4, 5].map((m) => vote(m, PET_RULES.fastVoteMs));
  assert.equal(computePetState({ adoptedAt: T0 - HOUR, votes }, T0).isSick, false);
});

test("skimming at under a second a caption is rushed", () => {
  const votes = [1, 2, 3, 4, 5].map((m) => vote(m, 900));
  assert.equal(computePetState({ adoptedAt: T0 - HOUR, votes }, T0).isSick, true);
});

test("throwing up costs fullness, and recovering gives it back", () => {
  const sick = computePetState({ adoptedAt: T0 - HOUR, votes: [1, 2, 3, 4, 5].map((m) => vote(m / 60, 200)) }, T0);
  assert.equal(sick.isSick, true);
  assert.equal(sick.fullness, 100 - 5 * PET_RULES.rushedFullnessCost);

  const calm = computePetState({ adoptedAt: T0 - HOUR, votes: [1, 2, 3, 4, 5].map((m) => vote(m / 60, 3000)) }, T0);
  assert.equal(calm.fullness, 100);
});

test("each rushed caption lowers fullness right away, and a careful one wins it back", () => {
  const input = { adoptedAt: T0 - HOUR, votes: [1, 2, 3, 4, 5].map((m) => vote(m / 60, 3000)) };
  const rushed = applyVote(input, { at: T0, timeToVoteMs: 200 }, T0);
  assert.equal(rushed.state.fullness, 100 - PET_RULES.rushedFullnessCost);
  assert.equal(rushed.state.isSick, false);

  const twice = applyVote(rushed.input, { at: T0 + 500, timeToVoteMs: 200 }, T0 + 500);
  assert.equal(twice.state.fullness, 100 - 2 * PET_RULES.rushedFullnessCost);

  const careful = applyVote(twice.input, { at: T0 + 4000, timeToVoteMs: 3000 }, T0 + 4000);
  assert.equal(careful.state.fullness, 100 - PET_RULES.rushedFullnessCost);
  const again = applyVote(careful.input, { at: T0 + 7000, timeToVoteMs: 3000 }, T0 + 7000);
  assert.equal(again.state.fullness, 100);
});

test("old rushed captions don't come back when a new careful one arrives", () => {
  const stale = [2, 3, 4, 5].map((m) => vote(24 * 60 + m, 200)); // a day ago
  const input = { adoptedAt: T0 - 48 * HOUR, votes: stale };
  const r = applyVote(input, { at: T0, timeToVoteMs: 3000 }, T0);
  assert.equal(r.state.rushedVotes, 0);
  assert.equal(r.state.fullness, 100);
  assert.equal(r.state.isSick, false);
});

test("sickness wears off after ten minutes", () => {
  const votes = [1, 2, 3, 4, 5].map((m) => vote(m, 200));
  const later = T0 + 11 * 60 * 1000;
  assert.equal(computePetState({ adoptedAt: T0 - HOUR, votes }, later).isSick, false);
});

test("only the five latest votes matter, whatever order they come in", () => {
  const old = [vote(60, 200), vote(61, 200)];
  const recent = [vote(1, 3000), vote(2, 3000), vote(3, 3000), vote(4, 3000), vote(5, 3000)];
  const s = computePetState({ adoptedAt: T0 - 100 * HOUR, votes: [...old, ...recent].reverse() }, T0);
  assert.equal(s.rushedVotes, 0);
});

test("the fifth rushed vote makes the pet throw up, and slowing down recovers it", () => {
  let input = fresh;
  let events = [];
  let t = T0;
  for (let i = 0; i < 5; i++) {
    t += 400;
    const r = applyVote(input, { at: t, timeToVoteMs: 200 }, t);
    input = r.input;
    events.push(r.event);
  }
  assert.deepEqual(events, ["none", "none", "none", "none", "threw-up"]);

  const calm = [];
  for (let i = 0; i < 2; i++) {
    t += 4000;
    const r = applyVote(input, { at: t, timeToVoteMs: 4000 }, t);
    input = r.input;
    calm.push(r.event);
  }
  assert.deepEqual(calm, ["recovered", "none"]);
});

test("the pet keeps throwing up only once per bout", () => {
  let input = { adoptedAt: T0 - HOUR, votes: [1, 2, 3, 4, 5].map((m) => vote(m, 200)) };
  const r = applyVote(input, { at: T0 + 1000, timeToVoteMs: 100 }, T0 + 1000);
  assert.equal(r.event, "none");
  assert.equal(r.state.mood, "sick");
});

test("a vote revives a pet that has faded away", () => {
  const input = { adoptedAt: T0 - 300 * HOUR, votes: [{ at: T0 - 100 * HOUR, timeToVoteMs: 3000 }] };
  assert.equal(computePetState(input, T0).mood, "gone");
  const r = applyVote(input, { at: T0, timeToVoteMs: 3000 }, T0);
  assert.equal(r.event, "revived");
  assert.equal(r.state.mood, "happy");
  assert.equal(r.state.fullness, 100);
});

test("event messages exist for each event and stay quiet for none", () => {
  assert.match(eventMessage("Pip", "threw-up"), /Pip/);
  assert.match(eventMessage("Pip", "revived"), /back/);
  assert.equal(eventMessage("Pip", "none"), null);
});
