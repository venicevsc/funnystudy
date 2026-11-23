"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isUnlocked, findAccessory } from "@/lib/pet-accessories";
import { fetchPetProgress, normalizePetName } from "@/lib/pet-data";
import { createClient } from "@/lib/supabase/server";

function backHome(message: string): never {
  redirect(`/?message=${encodeURIComponent(message)}`);
}

/** Adopts a pet for the signed-in participant (one each). */
export async function adoptPet(formData: FormData) {
  const supabase = await createClient({ allowCookieWrite: true });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = normalizePetName(formData.get("name"));
  if (!name) backHome("Give your pet a name between 1 and 20 characters.");

  // Not an upsert: a second submit must never overwrite the pet's adoption date,
  // because that date is when the pet counts as last fed.
  const { error } = await supabase.from("pets").insert({ profile_id: user.id, name });
  if (error && error.code !== "23505") {
    console.error("[adoptPet] insert failed", error);
    backHome("We couldn't adopt your pet. Please try again.");
  }

  revalidatePath("/");
  redirect("/");
}

export async function renamePet(formData: FormData) {
  const supabase = await createClient({ allowCookieWrite: true });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = normalizePetName(formData.get("name"));
  if (!name) backHome("Give your pet a name between 1 and 20 characters.");

  const { error } = await supabase
    .from("pets")
    .update({ name, modified_at: new Date().toISOString() })
    .eq("profile_id", user.id);
  if (error) {
    console.error("[renamePet] update failed", error);
    backHome("We couldn't rename your pet. Please try again.");
  }

  revalidatePath("/");
  redirect("/");
}

/**
 * Puts an unlocked accessory on the pet, or takes it off (empty id). The unlock
 * rules are checked here on the server, so a hand-made request can't equip an
 * accessory that has not been earned.
 */
export async function setPetAccessory(accessoryId: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient({ allowCookieWrite: true });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let accessory: string | null = null;
  if (accessoryId) {
    const found = findAccessory(accessoryId);
    if (!found) return { ok: false, message: "That accessory doesn't exist." };
    const progress = await fetchPetProgress(supabase, user.id);
    if (!progress) return { ok: false, message: "We couldn't check your progress. Please try again." };
    if (!isUnlocked(found, progress)) return { ok: false, message: "Keep rating captions to unlock that one." };
    accessory = found.id;
  }

  const { error } = await supabase
    .from("pets")
    .update({ accessory, modified_at: new Date().toISOString() })
    .eq("profile_id", user.id);
  if (error) {
    console.error("[setPetAccessory] update failed", error);
    return { ok: false, message: "We couldn't change your pet's look. Please try again." };
  }

  revalidatePath("/");
  return { ok: true };
}
