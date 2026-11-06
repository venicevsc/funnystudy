"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { normalizePetName } from "@/lib/pet-data";
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
