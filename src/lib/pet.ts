// Study pet rules. Pure functions only (no React, no database), so they are easy
// to test and the same code decides the mood on the server and in the browser.
//
// Two ways to look after the pet:
//   * Feed it by doing studies. Every caption you rate and move past is a meal (it
//     is recorded as a study_caption_navigation_events row, whether or not you
//     hearted it). Go too long without one and the pet gets hungry, then fades
//     away. It comes back with your next caption.
//   * Don't feed it too fast. Five captions in a row, each gone in under a second,
//     and it throws up, losing some fullness. Slow down and it recovers.
//
// The line started at half a second, checked against the real navigation events in
// the course copy of the database (51,576 of them): that caught 109 of 397
// participants at some point, on 5.4% of five-caption windows. It was too hard to
// hit on purpose by hand, so it is now one second. The median time on a caption
// there is over two seconds, so ordinary rating still stays clear of it.
//
// In the types below a "vote" means one of these caption meals.

export const PET_RULES = {
  /** Hours without a vote before each stage. */
  peckishAfterHours: 12,
  hungryAfterHours: 24,
  starvingAfterHours: 48,
  /** At this point the pet has faded away. Any vote brings it back. */
  goneAfterHours: 72,
  /** A vote faster than this was rushed. */
  fastVoteMs: 1000,
  /** The pet is sick when this many of its last `windowSize` votes were rushed. */
  windowSize: 5,
  sickFastCount: 5,
  /** Sickness only shows for this long after the latest vote. */
  sickMemoryMs: 10 * 60 * 1000,
  /** Fullness lost while the pet is sick; it comes back when the pet recovers. */
  sickFullnessCost: 30,
  /** From this many rushed votes the pet looks queasy, a warning before it throws up. */
  queasyFastCount: 3,
} as const;

export type PetMood = "happy" | "peckish" | "hungry" | "starving" | "sick" | "gone";

export type PetVote = {
  /** When the vote was cast (ISO string or epoch ms). */
  at: string | number;
  /** How long the participant looked before voting. null when unknown. */
  timeToVoteMs: number | null;
};

export type PetInput = {
  adoptedAt: string | number;
  /** Recent votes in any order. Only the latest `windowSize` are used. */
  votes: readonly PetVote[];
};

export type PetState = {
  mood: PetMood;
  /** 100 = just fed, 0 = gone. */
  fullness: number;
  hoursSinceFed: number;
  isGone: boolean;
  isSick: boolean;
  /** How many of the latest votes were rushed. */
  rushedVotes: number;
};

const HOUR_MS = 60 * 60 * 1000;

function toMs(value: string | number): number {
  return typeof value === "number" ? value : Date.parse(value);
}

function latestVotes(votes: readonly PetVote[]): { at: number; timeToVoteMs: number | null }[] {
  return votes
    .map((vote) => ({ at: toMs(vote.at), timeToVoteMs: vote.timeToVoteMs }))
    .filter((vote) => Number.isFinite(vote.at))
    .sort((a, b) => b.at - a.at)
    .slice(0, PET_RULES.windowSize);
}

export function isRushed(timeToVoteMs: number | null): boolean {
  return timeToVoteMs !== null && Number.isFinite(timeToVoteMs) && timeToVoteMs < PET_RULES.fastVoteMs;
}

export function computePetState(input: PetInput, now: string | number | Date = Date.now()): PetState {
  const nowMs = now instanceof Date ? now.getTime() : toMs(now);
  const recent = latestVotes(input.votes);
  const adoptedMs = toMs(input.adoptedAt);

  // A pet is fed at adoption, even for someone who voted a lot before adopting it.
  const lastFedMs = Math.max(adoptedMs, recent[0]?.at ?? -Infinity);
  const hoursSinceFed = Math.max(0, (nowMs - lastFedMs) / HOUR_MS);
  const fedFullness = Math.max(0, Math.round(100 * (1 - hoursSinceFed / PET_RULES.goneAfterHours)));
  const isGone = hoursSinceFed >= PET_RULES.goneAfterHours;

  const rushedVotes = recent.filter((vote) => isRushed(vote.timeToVoteMs)).length;
  const isSick =
    !isGone &&
    recent.length >= PET_RULES.windowSize &&
    rushedVotes >= PET_RULES.sickFastCount &&
    nowMs - recent[0].at <= PET_RULES.sickMemoryMs;
  const fullness = isSick ? Math.max(0, fedFullness - PET_RULES.sickFullnessCost) : fedFullness;

  let mood: PetMood;
  if (isGone) mood = "gone";
  else if (isSick) mood = "sick";
  else if (hoursSinceFed >= PET_RULES.starvingAfterHours) mood = "starving";
  else if (hoursSinceFed >= PET_RULES.hungryAfterHours) mood = "hungry";
  else if (hoursSinceFed >= PET_RULES.peckishAfterHours) mood = "peckish";
  else mood = "happy";

  return { mood, fullness, hoursSinceFed, isGone, isSick, rushedVotes };
}

export type PetEvent = "none" | "threw-up" | "recovered" | "revived";

/**
 * Adds one new vote and says what just happened to the pet, so the page can play
 * the right animation. `now` is when the vote was cast.
 */
export function applyVote(
  input: PetInput,
  vote: PetVote,
  now: string | number | Date = Date.now()
): { input: PetInput; state: PetState; event: PetEvent } {
  const nowMs = now instanceof Date ? now.getTime() : toMs(now);
  const before = computePetState(input, nowMs);
  const next: PetInput = {
    adoptedAt: input.adoptedAt,
    votes: [...latestVotes(input.votes), vote],
  };
  const state = computePetState(next, nowMs);

  let event: PetEvent = "none";
  if (before.isGone && !state.isGone) event = "revived";
  else if (!before.isSick && state.isSick) event = "threw-up";
  else if (before.isSick && !state.isSick) event = "recovered";

  return { input: next, state, event };
}

export function petMessage(name: string, state: PetState): string {
  switch (state.mood) {
    case "happy":
      return `${name} is full and happy.`;
    case "peckish":
      return `${name} is getting peckish. A few captions would hit the spot.`;
    case "hungry":
      return `${name} is hungry! Rate some captions to feed them.`;
    case "starving":
      return `${name} is starving and starting to fade. Do a study soon!`;
    case "sick":
      return `Blegh! You fed ${name} too fast and they threw up. Take your time with the next few captions.`;
    case "gone":
      return `${name} has faded away... Rate a caption and they'll come back.`;
  }
}

export function eventMessage(name: string, event: PetEvent): string | null {
  switch (event) {
    case "threw-up":
      return `Blegh! ${name} threw up. You're feeding them too fast.`;
    case "recovered":
      return `${name} is feeling better. Thanks for slowing down!`;
    case "revived":
      return `${name} is back! Thanks for the captions.`;
    default:
      return null;
  }
}
