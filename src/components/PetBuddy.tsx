"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  applyVote,
  computePetState,
  eventMessage,
  isRushedVote,
  PET_MAX_HP,
  PET_RULES,
  petMessage,
  type PetInput,
  type PetMood,
  type PetVote,
} from "@/lib/pet";
import {
  isUnlocked,
  newlyUnlocked,
  PET_ACCESSORIES,
  unlockHint,
  type PetAccessoryId,
  type PetProgress,
} from "@/lib/pet-accessories";
import type { PetSnapshot } from "@/lib/pet-data";

export type AccessoryAction = (accessoryId: string) => Promise<{ ok: boolean; message?: string }>;

/** Fired by the vote flow after each vote is saved, so the pet can react live. */
export const PET_VOTE_EVENT = "funnystudy:pet-vote";

/**
 * `rated` is true when the caption was liked or disliked before moving on. Only
 * skipped captions can count as rushed.
 */
export function announcePetVote(vote: { timeToVoteMs: number; rated?: boolean }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PetVote>(PET_VOTE_EVENT, {
      detail: { at: Date.now(), timeToVoteMs: vote.timeToVoteMs, rated: vote.rated === true },
    })
  );
}

/** Fired the moment a caption is liked or disliked (or the reaction is taken back). */
export const PET_REACT_EVENT = "funnystudy:pet-react";
export type PetReactionKind = "like" | "dislike" | "clear";

export function announcePetReaction(kind: PetReactionKind) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ kind: PetReactionKind }>(PET_REACT_EVENT, { detail: { kind } }));
}

const BODY_COLOR: Record<PetMood, string> = {
  happy: "#fbbf24",
  peckish: "#fbbf24",
  hungry: "#f5b84a",
  starving: "#d6b36b",
  sick: "#a3e635",
  gone: "#cbd5e1",
};

const QUEASY_COLOR = "#d4e157";

function Face({ mood, queasy }: { mood: PetMood; queasy: boolean }) {
  const ink = "#1f1300";
  if (queasy && mood !== "gone" && mood !== "sick") {
    return (
      <g stroke={ink} strokeWidth="2.5" strokeLinecap="round" fill="none">
        {/* Spirals that grow outward from each eye's centre. */}
        <path d="M38 46m0-1.5a1.5 1.5 0 1 1-1.5 1.5a3 3 0 1 1 3 3a4.5 4.5 0 1 1-4.5-4.5a6 6 0 1 1 6 6" />
        <path d="M62 46m0-1.5a1.5 1.5 0 1 1-1.5 1.5a3 3 0 1 1 3 3a4.5 4.5 0 1 1-4.5-4.5a6 6 0 1 1 6 6" />
        <path d="M40 67c3-3 6 3 10 0s7 3 10 0" />
      </g>
    );
  }
  if (mood === "gone") {
    return (
      <g stroke={ink} strokeWidth="3" strokeLinecap="round">
        <path d="M33 40l10 10M43 40l-10 10M57 40l10 10M67 40l-10 10" />
        <path d="M42 66h16" />
      </g>
    );
  }
  if (mood === "sick") {
    return (
      <g stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M32 46c2-6 10-6 11 0s-9 6-7 0M57 46c2-6 10-6 11 0s-9 6-7 0" />
        <path d="M40 67c3-4 6 4 10 0s7 4 10 0" />
      </g>
    );
  }
  const eyes = (
    <g fill={ink}>
      <circle cx="38" cy={mood === "starving" ? 50 : 46} r={mood === "starving" ? 4 : 5} />
      <circle cx="62" cy={mood === "starving" ? 50 : 46} r={mood === "starving" ? 4 : 5} />
    </g>
  );
  const mouth: Record<"happy" | "peckish" | "hungry" | "starving", string> = {
    happy: "M38 60q12 14 24 0",
    peckish: "M40 66h20",
    hungry: "M40 69q10-8 20 0",
    starving: "M41 70q9-12 18 0",
  };
  return (
    <>
      {eyes}
      <path d={mouth[mood]} stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
    </>
  );
}

const INK = "#1f1300";

/** Drawn in the pet's own coordinates (0-100 wide, head top at y=12). */
function AccessoryArt({ id }: { id: PetAccessoryId }) {
  switch (id) {
    case "bow":
      return (
        <g stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
          <path d="M50 90L33 79v22zM50 90l17-11v22z" fill="#ef4444" />
          <circle cx="50" cy="90" r="4.5" fill="#b91c1c" />
        </g>
      );
    case "shades":
      return (
        <g>
          <rect x="27" y="38" width="22" height="15" rx="5" fill={INK} />
          <rect x="51" y="38" width="22" height="15" rx="5" fill={INK} />
          <path d="M49 43h2" stroke={INK} strokeWidth="3" />
          <path d="M31 42l6-1M55 42l6-1" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        </g>
      );
    case "party":
      return (
        <g stroke={INK} strokeWidth="3" strokeLinejoin="round" transform="rotate(-8 50 18)">
          <path d="M33 19L50 -20l17 39z" fill="#a78bfa" />
          <path d="M42 2h16M37 11h26" stroke="#fde68a" strokeWidth="3" strokeLinecap="round" />
          <circle cx="50" cy="-21" r="4.5" fill="#fbbf24" />
        </g>
      );
    case "grad":
      return (
        <g stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
          <path d="M35 16v10c9 6 21 6 30 0V16z" fill="#374151" />
          <path d="M50 -4l36 13-36 13-36-13z" fill="#1f2937" />
          <path d="M82 11v17" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" />
          <circle cx="82" cy="30" r="3.5" fill="#fbbf24" />
        </g>
      );
    case "crown":
      return (
        <g stroke={INK} strokeWidth="3" strokeLinejoin="round">
          <path d="M29 21l4-26 11 14 6-18 6 18 11-14 4 26z" fill="#fbbf24" />
          <circle cx="50" cy="14" r="2.6" fill="#ef4444" stroke="none" />
          <circle cx="38" cy="15" r="2" fill="#38bdf8" stroke="none" />
          <circle cx="62" cy="15" r="2" fill="#38bdf8" stroke="none" />
        </g>
      );
  }
}

/** A small icon of one accessory for the wardrobe buttons. */
function AccessoryIcon({ id, locked }: { id: PetAccessoryId; locked: boolean }) {
  return (
    <svg viewBox="5 -26 90 134" width="34" height="50" aria-hidden className={locked ? "opacity-40 grayscale" : ""}>
      {/* A faint body behind it so hats and glasses read as worn. */}
      <path
        d="M50 12c24 0 38 18 38 42 0 22-14 44-38 44S12 76 12 54C12 30 26 12 50 12z"
        fill="currentColor"
        opacity="0.12"
      />
      <AccessoryArt id={id} />
    </svg>
  );
}

export function PetCreature({
  mood,
  size,
  accessory = null,
  throwingUp = false,
  celebrating = false,
  queasy = false,
  tossCount = 0,
  reaction = null,
  reactionKey = 0,
}: {
  mood: PetMood;
  size: number;
  /** The pet's answer to a like or dislike, played once per `reactionKey`. */
  reaction?: "like" | "dislike" | null;
  reactionKey?: number;
  /** The unlocked item the pet is wearing. */
  accessory?: PetAccessoryId | null;
  throwingUp?: boolean;
  celebrating?: boolean;
  /** Close to throwing up: swirly eyes and a green tinge. */
  queasy?: boolean;
  /** Goes up by one per rushed caption; each change flings the pet around once. */
  tossCount?: number;
}) {
  const bodyColor = queasy && mood !== "sick" && mood !== "gone" ? QUEASY_COLOR : BODY_COLOR[mood];
  const tossClass = tossCount === 0 ? "" : tossCount % 2 === 0 ? "pet-toss-left" : "pet-toss-right";
  const motion =
    mood === "sick"
      ? "pet-wobble"
      : mood === "happy" || celebrating
        ? "pet-bounce"
        : mood === "gone"
          ? "pet-float"
          : "";
  return (
    <svg
      viewBox="0 -26 100 136"
      width={size}
      height={size * 1.36}
      role="img"
      aria-label={`Your pet looks ${mood === "gone" ? "faded away" : mood}`}
      className={`${motion} overflow-visible`}
      style={{ opacity: mood === "gone" ? 0.45 : mood === "starving" ? 0.8 : 1 }}
    >
      <ellipse cx="50" cy="104" rx="26" ry="4" fill="currentColor" opacity="0.15" />
      {/* Keyed on reactionKey so every like or dislike plays its own little reaction. */}
      <g key={`reaction-${reactionKey}`} className={`pet-body ${reaction === "like" ? "pet-hop" : reaction === "dislike" ? "pet-shrug" : ""}`}>
      {/* Keyed on tossCount so every rushed caption restarts the fling. */}
      <g key={tossCount} className={`pet-body ${tossClass}`}>
        <path
          d="M50 12c24 0 38 18 38 42 0 22-14 44-38 44S12 76 12 54C12 30 26 12 50 12z"
          fill={bodyColor}
          stroke="#1f1300"
          strokeWidth="3"
        />
        <path d="M30 20c-6-8-4-14 2-16 2 6 4 10 6 14M70 20c6-8 4-14-2-16-2 6-4 10-6 14" fill={bodyColor} stroke="#1f1300" strokeWidth="3" strokeLinejoin="round" />
        <Face mood={mood} queasy={queasy} />
        {mood === "sick" || queasy ? <circle cx="76" cy="36" r="3" fill="#bef264" opacity="0.8" /> : null}
        {accessory ? <AccessoryArt id={accessory} /> : null}
      </g>
      </g>
      {reaction === "like" ? (
        <g key={`hearts-${reactionKey}`} fill="#fb7185" stroke="#be123c" strokeWidth="1.5" strokeLinejoin="round">
          <g transform="translate(24 8)"><path className="pet-heart pet-heart-1" d="M0 -3c-3-5-9-1-5 4l5 5 5-5c4-5-2-9-5-4z" /></g>
          <g transform="translate(50 -4)"><path className="pet-heart pet-heart-2" d="M0 -3c-3-5-9-1-5 4l5 5 5-5c4-5-2-9-5-4z" /></g>
          <g transform="translate(76 8)"><path className="pet-heart pet-heart-3" d="M0 -3c-3-5-9-1-5 4l5 5 5-5c4-5-2-9-5-4z" /></g>
        </g>
      ) : null}
      {reaction === "dislike" ? (
        <g key={`bubble-${reactionKey}`} transform="translate(80 0)">
          <g className="pet-bubble">
            <circle r="13" fill="#e0e7ff" stroke="#4f46e5" strokeWidth="2" />
            <text textAnchor="middle" dominantBaseline="central" fontSize="14">{"\u{1F44E}"}</text>
          </g>
        </g>
      ) : null}
      {throwingUp ? (
        <g fill="#84cc16" stroke="#3f6212" strokeWidth="1.5">
          <ellipse className="pet-vomit pet-vomit-1" cx="50" cy="72" rx="5" ry="6" />
          <ellipse className="pet-vomit pet-vomit-2" cx="44" cy="72" rx="4" ry="5" />
          <ellipse className="pet-vomit pet-vomit-3" cx="57" cy="72" rx="4" ry="5" />
        </g>
      ) : null}
    </svg>
  );
}

type PetToast = { id: number; text: string; tone: "loss" | "good" | "info" };

function useLivePet(initial: PetSnapshot) {
  const inputRef = useRef<PetInput>({ adoptedAt: initial.adoptedAt, votes: initial.votes });
  const progressRef = useRef<PetProgress>(initial.progress);
  const hpRef = useRef(computePetState({ adoptedAt: initial.adoptedAt, votes: initial.votes }, initial.asOf).fullness);
  const [state, setState] = useState(() =>
    computePetState({ adoptedAt: initial.adoptedAt, votes: initial.votes }, initial.asOf)
  );
  const [progress, setProgress] = useState<PetProgress>(initial.progress);
  const [toast, setToast] = useState<PetToast | null>(null);
  const [throwingUp, setThrowingUp] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [tossCount, setTossCount] = useState(0);
  const [pop, setPop] = useState<FullnessPop | null>(null);
  const [reaction, setReaction] = useState<{ id: number; kind: "like" | "dislike" } | null>(null);
  const reactionIdRef = useRef(0);
  const popIdRef = useRef(0);
  const toastIdRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  const showToast = (text: string, tone: PetToast["tone"], ms: number) => {
    // Only this toast's timer may clear this toast; with quick skipping an older
    // timer would otherwise wipe the newest message.
    const id = ++toastIdRef.current;
    setToast({ id, text, tone });
    timersRef.current.push(window.setTimeout(() => setToast((current) => (current?.id === id ? null : current)), ms));
  };

  // A fresh page load hands us fresh data; start over from it.
  useEffect(() => {
    inputRef.current = { adoptedAt: initial.adoptedAt, votes: initial.votes };
    progressRef.current = initial.progress;
    const next = computePetState(inputRef.current);
    hpRef.current = next.fullness;
    setState(next);
    setProgress(initial.progress);
  }, [initial]);

  // Hunger and sickness change with the clock even when nothing is clicked, and
  // losing HP to hunger deserves the same notice as losing it to rushing.
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = computePetState(inputRef.current);
      const lost = hpRef.current - next.fullness;
      hpRef.current = next.fullness;
      setState(next);
      if (lost > 0 && !next.isGone) {
        showToast(`${initial.name} lost ${lost} HP from hunger. Rate a caption to feed them.`, "loss", 5000);
      }
    }, 30_000);
    return () => window.clearInterval(id);
  }, [initial.name]);

  useEffect(() => {
    const onVote = (event: Event) => {
      const vote = (event as CustomEvent<PetVote>).detail;
      const before = computePetState(inputRef.current, vote.at);
      const result = applyVote(inputRef.current, vote, vote.at);
      inputRef.current = result.input;
      hpRef.current = result.state.fullness;
      setState(result.state);
      const rushed = isRushedVote(vote);
      if (rushed) setTossCount((count) => count + 1);

      // Every caption gets a visible reaction, even when the bar is already full.
      const delta = result.state.fullness - before.fullness;
      const popId = ++popIdRef.current;
      setPop({
        id: popId,
        text: delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : rushed ? "oof" : "yum!",
        tone: delta > 0 ? "up" : delta < 0 || rushed ? "down" : "fed",
      });
      timersRef.current.push(
        window.setTimeout(() => setPop((current) => (current?.id === popId ? null : current)), 1300)
      );

      // Another caption done: check whether it just earned an accessory.
      const progressBefore = progressRef.current;
      const progressAfter = { ...progressBefore, captionsRated: progressBefore.captionsRated + 1 };
      progressRef.current = progressAfter;
      setProgress(progressAfter);
      const unlocked = newlyUnlocked(progressBefore, progressAfter);

      // One message per caption, loss first: say how much HP went and why.
      const parts: string[] = [];
      let tone: PetToast["tone"] = "info";
      let ms = 4500;
      const eventText = eventMessage(initial.name, result.event);
      if (delta < 0) {
        tone = "loss";
        const seconds = vote.timeToVoteMs === null ? "" : ` (${(vote.timeToVoteMs / 1000).toFixed(1)}s)`;
        parts.push(
          eventText && result.event === "threw-up"
            ? `${eventText} −${-delta} HP.`
            : `${initial.name} lost ${-delta} HP: you skipped that caption${seconds} without liking or disliking it.`
        );
        ms = result.event === "threw-up" ? 6000 : 3500;
      } else if (eventText) {
        tone = "good";
        parts.push(eventText);
      }
      if (unlocked.length) {
        tone = tone === "loss" ? "loss" : "good";
        parts.push(`New to wear: ${unlocked.map((a) => a.label).join(", ")}! Pick it on the home page.`);
        ms = Math.max(ms, 7000);
      }
      if (parts.length) showToast(parts.join(" "), tone, ms);

      if (result.event === "threw-up") {
        setThrowingUp(true);
        timersRef.current.push(window.setTimeout(() => setThrowingUp(false), 3200));
      }
      if (result.event === "revived") {
        setCelebrating(true);
        timersRef.current.push(window.setTimeout(() => setCelebrating(false), 2600));
      }
    };
    window.addEventListener(PET_VOTE_EVENT, onVote);
    const timers = timersRef.current;
    return () => {
      window.removeEventListener(PET_VOTE_EVENT, onVote);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [initial.name]);

  // The pet answers a like or dislike straight away, before the next caption.
  useEffect(() => {
    const onReact = (event: Event) => {
      const { kind } = (event as CustomEvent<{ kind: PetReactionKind }>).detail;
      if (kind === "clear") {
        setReaction(null);
        return;
      }

      const id = ++reactionIdRef.current;
      setReaction({ id, kind });
      timersRef.current.push(
        window.setTimeout(() => setReaction((current) => (current?.id === id ? null : current)), 1800)
      );

      const popId = ++popIdRef.current;
      setPop({ id: popId, text: kind === "like" ? "❤" : "👎", tone: kind });
      timersRef.current.push(
        window.setTimeout(() => setPop((current) => (current?.id === popId ? null : current)), 1300)
      );

      showToast(
        kind === "like"
          ? `${initial.name} loves that one! Liking never costs HP.`
          : `${initial.name} heard you: not a fan. Disliking never costs HP either.`,
        "good",
        3200
      );
    };
    window.addEventListener(PET_REACT_EVENT, onReact);
    return () => window.removeEventListener(PET_REACT_EVENT, onReact);
  }, [initial.name]);

  const queasy = !state.isSick && !state.isGone && state.rushedVotes >= PET_RULES.queasyFastCount;
  return { state, toast, throwingUp, celebrating, queasy, tossCount, pop, progress, reaction };
}

type FullnessPop = { id: number; text: string; tone: "up" | "down" | "fed" | "like" | "dislike" };

const POP_TONE: Record<FullnessPop["tone"], string> = {
  up: "text-emerald-400",
  down: "text-rose-400",
  fed: "text-amber-300",
  like: "text-rose-400",
  dislike: "text-indigo-400",
};

/** HP as "72 / 100" plus the latest caption's +/- reaction. */
function HpMeter({
  value,
  mood,
  pop,
  large = false,
}: {
  value: number;
  mood: PetMood;
  pop: FullnessPop | null;
  large?: boolean;
}) {
  const color = mood === "sick" ? "#84cc16" : value > 50 ? "#34d399" : value > 25 ? "#fbbf24" : "#f87171";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className={`font-bold uppercase tracking-wide text-[var(--muted)] ${large ? "text-xs" : "text-[10px]"}`}>
          HP
        </span>
        <span className="flex items-baseline gap-1.5 tabular-nums">
          {/* Keyed on id so the same text ("yum!" twice in a row) still replays. */}
          <span aria-hidden className={`inline-block text-right ${large ? "w-12 text-sm" : "w-10 text-xs"}`}>
            {pop ? (
              <span key={pop.id} className={`pet-delta inline-block font-bold ${POP_TONE[pop.tone]}`}>
                {pop.text}
              </span>
            ) : null}
          </span>
          <span className={`font-bold ${large ? "text-xl" : "text-sm"}`}>
            {value}
            <span className="font-medium text-[var(--muted)]"> / {PET_MAX_HP}</span>
          </span>
        </span>
      </div>
      <div
        role="meter"
        aria-label="HP"
        aria-valuemin={0}
        aria-valuemax={PET_MAX_HP}
        aria-valuenow={value}
        aria-valuetext={`${value} of ${PET_MAX_HP} HP`}
        className={`relative w-full overflow-hidden rounded-full bg-[var(--surface-muted)] ring-1 ring-[var(--card-border)] ${large ? "h-4" : "h-3"}`}
      >
        {/* The red trail lags behind, so a loss is seen as a chunk draining away. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-rose-400 transition-all delay-300 duration-1000 ease-out"
          style={{ width: `${(value / PET_MAX_HP) * 100}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-200 ease-out"
          style={{ width: `${(value / PET_MAX_HP) * 100}%`, background: color }}
        />
      </div>
    </div>
  );
}

const TOAST_TONE: Record<PetToast["tone"], string> = {
  loss: "border-rose-400 text-[var(--foreground)]",
  good: "border-emerald-400 text-[var(--foreground)]",
  info: "border-[var(--card-border)] text-[var(--foreground)]",
};

const TOAST_MARK: Record<PetToast["tone"], string> = { loss: "▼ ", good: "★ ", info: "" };

/** Pick what the pet wears. Locked items show what it takes to earn them. */
function Wardrobe({
  progress,
  worn,
  onPick,
  pending,
  error,
}: {
  progress: PetProgress;
  worn: PetAccessoryId | null;
  onPick: (id: PetAccessoryId | null) => void;
  pending: boolean;
  error: string | null;
}) {
  const unlockedCount = PET_ACCESSORIES.filter((a) => isUnlocked(a, progress)).length;
  const chip = (active: boolean, locked: boolean) =>
    `flex h-full w-full flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-center text-xs transition-colors ${
      active ? "border-[var(--accent)] ring-2 ring-[var(--accent)]" : "border-[var(--card-border)]"
    } ${locked ? "cursor-not-allowed" : "hover:bg-[var(--surface-muted)]"}`;
  return (
    <div className="mt-4 border-t border-[var(--card-border)] pt-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-bold">Wardrobe</h3>
        <p className="text-xs text-[var(--muted)]">
          {unlockedCount} of {PET_ACCESSORIES.length} unlocked · {progress.captionsRated} captions rated ·{" "}
          {progress.studiesCompleted} {progress.studiesCompleted === 1 ? "study" : "studies"} completed
        </p>
      </div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <li>
          <button
            type="button"
            disabled={pending}
            aria-pressed={worn === null}
            onClick={() => onPick(null)}
            className={chip(worn === null, false)}
          >
            <span className="flex h-[50px] items-center text-lg text-[var(--muted)]" aria-hidden>
              ✕
            </span>
            <span className="font-semibold">None</span>
            <span className="text-[10px] text-[var(--muted)]">{worn === null ? "Wearing" : "Take it off"}</span>
          </button>
        </li>
        {PET_ACCESSORIES.map((accessory) => {
          const locked = !isUnlocked(accessory, progress);
          const active = worn === accessory.id;
          return (
            <li key={accessory.id}>
              <button
                type="button"
                disabled={locked || pending}
                aria-pressed={active}
                onClick={() => onPick(accessory.id)}
                className={chip(active, locked)}
              >
                <AccessoryIcon id={accessory.id} locked={locked} />
                <span className="font-semibold">{accessory.label}</span>
                <span className="text-[10px] text-[var(--muted)]">
                  {locked ? `🔒 ${unlockHint(accessory, progress)}` : active ? "Wearing" : "Unlocked"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p role="status" className="mt-2 min-h-4 text-xs text-rose-400">
        {error}
      </p>
    </div>
  );
}

/** The big card on the home page. */
export function PetCard({
  pet,
  renameAction,
  accessoryAction,
}: {
  pet: PetSnapshot;
  renameAction: (formData: FormData) => void | Promise<void>;
  accessoryAction: AccessoryAction;
}) {
  const { state, toast, throwingUp, celebrating, queasy, tossCount, pop, progress, reaction } = useLivePet(pet);
  const [worn, setWorn] = useState<PetAccessoryId | null>(pet.accessory);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Show the new look at once, and put the old one back if the server says no.
  const pick = (id: PetAccessoryId | null) => {
    const previous = worn;
    setWorn(id);
    setError(null);
    startTransition(async () => {
      const result = await accessoryAction(id ?? "");
      if (!result.ok) {
        setWorn(previous);
        setError(result.message ?? "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <section aria-label="Your pet" className="glass-panel mb-6 rounded-2xl p-4 sm:p-6">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
        <div className="shrink-0 pt-2">
          <PetCreature
            mood={state.mood}
            size={150}
            accessory={worn}
            throwingUp={throwingUp}
            celebrating={celebrating}
            queasy={queasy}
            tossCount={tossCount}
            reaction={reaction?.kind ?? null}
            reactionKey={reaction?.id ?? 0}
          />
        </div>
        <div className="w-full min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-2xl font-bold">{pet.name}</h2>
            <details className="text-xs text-[var(--muted)]">
              <summary className="cursor-pointer select-none">rename</summary>
              <form action={renameAction} className="mt-2 flex gap-2">
                <input
                  name="name"
                  defaultValue={pet.name}
                  maxLength={20}
                  required
                  aria-label="New pet name"
                  className="w-32 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1 text-sm text-[var(--foreground)]"
                />
                <button className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[var(--accent-contrast)]">
                  Save
                </button>
              </form>
            </details>
          </div>
          <HpMeter value={state.fullness} mood={state.mood} pop={pop} large />
          <p
            className={`text-sm ${toast ? `rounded-lg border-l-4 bg-[var(--surface-muted)] px-3 py-1.5 ${TOAST_TONE[toast.tone]}` : "text-[var(--muted)]"}`}
            aria-live="polite"
          >
            {toast ? `${TOAST_MARK[toast.tone]}${toast.text}` : petMessage(pet.name, state)}
          </p>
        </div>
      </div>
      <Wardrobe progress={progress} worn={worn} onPick={pick} pending={pending} error={error} />
    </section>
  );
}

/** The corner pet on a study page: it reacts to every caption you rate. */
export function PetCorner({ pet }: { pet: PetSnapshot }) {
  const { state, toast, throwingUp, celebrating, queasy, tossCount, pop, reaction } = useLivePet(pet);
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-30 flex w-[15.5rem] flex-col items-end gap-2 sm:right-5 sm:top-4 sm:w-[21rem]">
      <div className="flex w-full items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--pill-bg)] px-3 py-2 shadow-lg backdrop-blur-sm">
        <div className={`shrink-0 [&_svg]:h-auto [&_svg]:w-14 sm:[&_svg]:w-[84px] ${throwingUp ? "pet-pop" : ""}`}>
          <PetCreature
            mood={state.mood}
            size={84}
            accessory={pet.accessory}
            throwingUp={throwingUp}
            celebrating={celebrating}
            queasy={queasy}
            tossCount={tossCount}
            reaction={reaction?.kind ?? null}
            reactionKey={reaction?.id ?? 0}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-base font-bold text-[var(--foreground)]">{pet.name}</p>
          <HpMeter value={state.fullness} mood={state.mood} pop={pop} />
        </div>
      </div>
      <p
        aria-live="polite"
        className={`w-full rounded-xl border-l-4 border bg-[var(--pill-bg)] px-3 py-2 text-sm shadow-lg backdrop-blur-sm transition-opacity duration-300 ${toast ? `opacity-100 ${TOAST_TONE[toast.tone]}` : "border-transparent opacity-0"}`}
      >
        {toast ? `${TOAST_MARK[toast.tone]}${toast.text}` : ""}
      </p>
    </div>
  );
}

/** First-visit card: pick a name and adopt. */
export function AdoptPetCard({ adoptAction }: { adoptAction: (formData: FormData) => void | Promise<void> }) {
  return (
    <section
      aria-label="Adopt a pet"
      className="glass-panel mb-6 flex flex-col items-center gap-4 rounded-2xl p-4 sm:flex-row sm:gap-8 sm:p-6"
    >
      <div className="shrink-0 pt-2">
        <PetCreature mood="happy" size={130} />
      </div>
      <form action={adoptAction} className="w-full min-w-0 flex-1 space-y-2">
        <h2 className="text-xl font-bold sm:text-2xl">Adopt a study pet</h2>
        <p className="text-sm text-[var(--muted)]">
          Feed it by rating captions. Skip studies and it gets hungry, then fades away. Rate too fast and it
          throws up. Keep going to unlock accessories for it.
        </p>
        <div className="flex gap-2">
          <input
            name="name"
            required
            maxLength={20}
            placeholder="Name your pet"
            aria-label="Pet name"
            className="min-w-0 flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--foreground)]"
          />
          <button className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)]">
            Adopt
          </button>
        </div>
      </form>
    </section>
  );
}
