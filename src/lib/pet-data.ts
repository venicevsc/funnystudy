import type { SupabaseClient } from "@supabase/supabase-js";

import { PET_RULES, type PetVote } from "@/lib/pet";
import { equippableAccessory, type PetAccessoryId, type PetProgress } from "@/lib/pet-accessories";

/** What the page needs to draw the pet. Plain data, safe to pass to a client component. */
export type PetSnapshot = {
  name: string;
  adoptedAt: string;
  votes: PetVote[];
  /** The accessory being worn (always one that is currently unlocked), or null. */
  accessory: PetAccessoryId | null;
  /** Activity totals that decide which accessories are unlocked. */
  progress: PetProgress;
  /** Server clock when this was loaded, so server and browser first render the same mood. */
  asOf: number;
};

export const PET_NAME_MAX_LENGTH = 20;

/** Totals that unlock accessories. Own rows only, thanks to row-level security. */
export async function fetchPetProgress(supabase: SupabaseClient, profileId: string): Promise<PetProgress | null> {
  const [captions, studies] = await Promise.all([
    supabase
      .from("study_caption_navigation_events")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId),
    supabase
      .from("study_participations")
      .select("study_id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .not("started_at", "is", null)
      .not("ended_at", "is", null),
  ]);
  if (captions.error || studies.error) {
    console.error("[pet] load progress failed", captions.error ?? studies.error);
    return null;
  }
  return { captionsRated: captions.count ?? 0, studiesCompleted: studies.count ?? 0 };
}

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
    .select("name, adopted_at, accessory")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (petError) {
    console.error("[pet] load pet failed", petError);
    return { pet: null, error: true };
  }
  if (!petRow) return { pet: null, error: false };

  const { data: voteRows, error: voteError } = await supabase
    .from("study_caption_navigation_events")
    .select("caption_id, created_datetime_utc, time_to_next_caption_ms")
    .eq("profile_id", profileId)
    .order("created_datetime_utc", { ascending: false })
    .limit(PET_RULES.rushWindowSize);

  if (voteError) {
    console.error("[pet] load recent votes failed", voteError);
    return { pet: null, error: true };
  }

  // A caption the participant liked or disliked was answered, not skipped, so it
  // can never count as rushed. If this lookup fails the captions count as skipped.
  const recentCaptionIds = Array.from(new Set((voteRows ?? []).map((row) => row.caption_id as string)));
  const ratedCaptionIds = new Set<string>();
  if (recentCaptionIds.length) {
    const { data: ratedRows, error: ratedError } = await supabase
      .from("study_caption_vote_events")
      .select("caption_id")
      .eq("profile_id", profileId)
      .in("caption_id", recentCaptionIds);
    if (ratedError) {
      console.error("[pet] load rated captions failed", ratedError);
    }
    (ratedRows ?? []).forEach((row) => ratedCaptionIds.add(row.caption_id as string));
  }

  // If the totals can not be read, show the pet bare rather than guess what is unlocked.
  const progress = (await fetchPetProgress(supabase, profileId)) ?? { captionsRated: 0, studiesCompleted: 0 };

  return {
    pet: {
      name: petRow.name,
      adoptedAt: petRow.adopted_at,
      votes: (voteRows ?? []).map((row) => ({
        at: row.created_datetime_utc,
        timeToVoteMs: row.time_to_next_caption_ms,
        rated: ratedCaptionIds.has(row.caption_id as string),
      })),
      accessory: equippableAccessory(petRow.accessory, progress),
      progress,
      asOf: Date.now(),
    },
    error: false,
  };
}
