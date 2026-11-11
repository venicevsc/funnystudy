import type { SupabaseClient } from "@supabase/supabase-js";

import { PET_RULES, type PetVote } from "@/lib/pet";

/** What the page needs to draw the pet. Plain data, safe to pass to a client component. */
export type PetSnapshot = {
  name: string;
  adoptedAt: string;
  votes: PetVote[];
  /** Server clock when this was loaded, so server and browser first render the same mood. */
  asOf: number;
};

export const PET_NAME_MAX_LENGTH = 20;

export function normalizePetName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= PET_NAME_MAX_LENGTH ? name : null;
}

/**
 * Loads the signed-in participant's pet and their latest captions. Returns
 * `{ pet: null }` before they have adopted one. Row-level security means this can
 * only ever read the caller's own pet and votes.
 */
export async function fetchPetSnapshot(
  supabase: SupabaseClient,
  profileId: string
): Promise<{ pet: PetSnapshot | null; error: boolean }> {
  const { data: petRow, error: petError } = await supabase
    .from("pets")
    .select("name, adopted_at")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (petError) {
    console.error("[pet] load pet failed", petError);
    return { pet: null, error: true };
  }
  if (!petRow) return { pet: null, error: false };

  const { data: voteRows, error: voteError } = await supabase
    .from("study_caption_navigation_events")
    .select("created_datetime_utc, time_to_next_caption_ms")
    .eq("profile_id", profileId)
    .order("created_datetime_utc", { ascending: false })
    .limit(PET_RULES.rushWindowSize);

  if (voteError) {
    console.error("[pet] load recent votes failed", voteError);
    return { pet: null, error: true };
  }

  return {
    pet: {
      name: petRow.name,
      adoptedAt: petRow.adopted_at,
      votes: (voteRows ?? []).map((row) => ({
        at: row.created_datetime_utc,
        timeToVoteMs: row.time_to_next_caption_ms,
      })),
      asOf: Date.now(),
    },
    error: false,
  };
}
