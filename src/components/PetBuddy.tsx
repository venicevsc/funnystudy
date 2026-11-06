"use client";

import { useEffect, useRef, useState } from "react";

import {
  applyVote,
  computePetState,
  eventMessage,
  petMessage,
  type PetEvent,
  type PetInput,
  type PetMood,
  type PetVote,
} from "@/lib/pet";
import type { PetSnapshot } from "@/lib/pet-data";

/** Fired by the vote flow after each vote is saved, so the pet can react live. */
export const PET_VOTE_EVENT = "funnystudy:pet-vote";

export function announcePetVote(vote: { timeToVoteMs: number }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PetVote>(PET_VOTE_EVENT, {
      detail: { at: Date.now(), timeToVoteMs: vote.timeToVoteMs },
    })
  );
}

const BODY_COLOR: Record<PetMood, string> = {
  happy: "#fbbf24",
  peckish: "#fbbf24",
  hungry: "#f5b84a",
  starving: "#d6b36b",
  sick: "#a3e635",
  gone: "#cbd5e1",
};

function Face({ mood }: { mood: PetMood }) {
  const ink = "#1f1300";
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

export function PetCreature({
  mood,
  size,
  throwingUp = false,
  celebrating = false,
}: {
  mood: PetMood;
  size: number;
  throwingUp?: boolean;
  celebrating?: boolean;
}) {
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
      viewBox="0 0 100 110"
      width={size}
      height={size * 1.1}
      role="img"
      aria-label={`Your pet looks ${mood === "gone" ? "faded away" : mood}`}
      className={`${motion} overflow-visible`}
      style={{ opacity: mood === "gone" ? 0.45 : mood === "starving" ? 0.8 : 1 }}
    >
      <ellipse cx="50" cy="104" rx="26" ry="4" fill="currentColor" opacity="0.15" />
      <path
        d="M50 12c24 0 38 18 38 42 0 22-14 44-38 44S12 76 12 54C12 30 26 12 50 12z"
        fill={BODY_COLOR[mood]}
        stroke="#1f1300"
        strokeWidth="3"
      />
      <path d="M30 20c-6-8-4-14 2-16 2 6 4 10 6 14M70 20c6-8 4-14-2-16-2 6-4 10-6 14" fill={BODY_COLOR[mood]} stroke="#1f1300" strokeWidth="3" strokeLinejoin="round" />
      <Face mood={mood} />
      {mood === "sick" ? <circle cx="76" cy="36" r="3" fill="#bef264" opacity="0.8" /> : null}
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

function useLivePet(initial: PetSnapshot) {
  const inputRef = useRef<PetInput>({ adoptedAt: initial.adoptedAt, votes: initial.votes });
  const [state, setState] = useState(() =>
    computePetState({ adoptedAt: initial.adoptedAt, votes: initial.votes }, initial.asOf)
  );
  const [toast, setToast] = useState<{ text: string; event: PetEvent } | null>(null);
  const [throwingUp, setThrowingUp] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  // A fresh page load hands us fresh data; start over from it.
  useEffect(() => {
    inputRef.current = { adoptedAt: initial.adoptedAt, votes: initial.votes };
    setState(computePetState(inputRef.current));
  }, [initial]);

  // Hunger and sickness change with the clock even when nothing is clicked.
  useEffect(() => {
    const id = window.setInterval(() => setState(computePetState(inputRef.current)), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    const onVote = (event: Event) => {
      const vote = (event as CustomEvent<PetVote>).detail;
      const result = applyVote(inputRef.current, vote, vote.at);
      inputRef.current = result.input;
      setState(result.state);

      const text = eventMessage(initial.name, result.event);
      if (!text) return;
      setToast({ text, event: result.event });
      timers.push(window.setTimeout(() => setToast(null), 4500));
      if (result.event === "threw-up") {
        setThrowingUp(true);
        timers.push(window.setTimeout(() => setThrowingUp(false), 2600));
      }
      if (result.event === "revived") {
        setCelebrating(true);
        timers.push(window.setTimeout(() => setCelebrating(false), 2600));
      }
    };
    window.addEventListener(PET_VOTE_EVENT, onVote);
    return () => {
      window.removeEventListener(PET_VOTE_EVENT, onVote);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [initial.name]);

  return { state, toast, throwingUp, celebrating };
}

function FullnessBar({ value, mood }: { value: number; mood: PetMood }) {
  const color = mood === "sick" ? "#84cc16" : value > 50 ? "#34d399" : value > 25 ? "#fbbf24" : "#f87171";
  return (
    <div
      role="meter"
      aria-label="Fullness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-muted)] ring-1 ring-[var(--card-border)]"
    >
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${value}%`, background: color }} />
    </div>
  );
}

/** The big card on the home page. */
export function PetCard({
  pet,
  renameAction,
}: {
  pet: PetSnapshot;
  renameAction: (formData: FormData) => void | Promise<void>;
}) {
  const { state, toast, throwingUp, celebrating } = useLivePet(pet);
  return (
    <section
      aria-label="Your pet"
      className="glass-panel mb-6 flex items-center gap-4 rounded-2xl p-4 sm:gap-6 sm:p-5"
    >
      <div className="shrink-0">
        <PetCreature mood={state.mood} size={84} throwingUp={throwingUp} celebrating={celebrating} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-lg font-bold sm:text-xl">{pet.name}</h2>
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
        <FullnessBar value={state.fullness} mood={state.mood} />
        <p className="text-sm text-[var(--muted)]" aria-live="polite">
          {toast?.text ?? petMessage(pet.name, state)}
        </p>
      </div>
    </section>
  );
}

/** The small one in the corner of a study page: it reacts to every vote. */
export function PetCorner({ pet }: { pet: PetSnapshot }) {
  const { state, toast, throwingUp, celebrating } = useLivePet(pet);
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-30 flex max-w-[16rem] flex-col items-end gap-1 sm:right-5 sm:top-4">
      <div className="flex items-center gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--pill-bg)] px-3 py-1.5 shadow-lg backdrop-blur-sm">
        <PetCreature mood={state.mood} size={34} throwingUp={throwingUp} celebrating={celebrating} />
        <div className="w-16 space-y-1">
          <p className="truncate text-xs font-semibold text-[var(--foreground)]">{pet.name}</p>
          <FullnessBar value={state.fullness} mood={state.mood} />
        </div>
      </div>
      <p
        aria-live="polite"
        className={`rounded-xl border border-[var(--card-border)] bg-[var(--pill-bg)] px-3 py-1.5 text-xs text-[var(--foreground)] shadow-lg backdrop-blur-sm transition-opacity duration-300 ${toast ? "opacity-100" : "opacity-0"}`}
      >
        {toast?.text ?? ""}
      </p>
    </div>
  );
}

/** First-visit card: pick a name and adopt. */
export function AdoptPetCard({ adoptAction }: { adoptAction: (formData: FormData) => void | Promise<void> }) {
  return (
    <section aria-label="Adopt a pet" className="glass-panel mb-6 flex items-center gap-4 rounded-2xl p-4 sm:gap-6 sm:p-5">
      <div className="shrink-0">
        <PetCreature mood="happy" size={84} />
      </div>
      <form action={adoptAction} className="min-w-0 flex-1 space-y-2">
        <h2 className="text-lg font-bold sm:text-xl">Adopt a study pet</h2>
        <p className="text-sm text-[var(--muted)]">
          Feed it by rating captions. Skip studies and it gets hungry, then fades away. Rate too fast and it
          throws up.
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
