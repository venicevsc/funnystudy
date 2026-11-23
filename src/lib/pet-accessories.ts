// Accessories the pet can wear. They are unlocked by doing studies, so the more a
// participant takes part, the more they can dress their pet up. Pure functions
// only: the server uses them to decide what may be equipped, the browser uses the
// same rules to show what is locked and to announce a fresh unlock mid-study.

export type PetProgress = {
  /** Captions the participant has rated and moved past, across all studies. */
  captionsRated: number;
  /** Studies the participant has finished. */
  studiesCompleted: number;
};

export type PetAccessory = {
  id: string;
  label: string;
  /** Needs at least this many captions rated. */
  captions?: number;
  /** Needs at least this many studies completed. */
  studies?: number;
};

export const PET_ACCESSORIES = [
  { id: "bow", label: "Bow tie", captions: 5 },
  { id: "shades", label: "Sunglasses", captions: 15 },
  { id: "party", label: "Party hat", captions: 30 },
  { id: "grad", label: "Graduation cap", studies: 1 },
  { id: "crown", label: "Crown", captions: 100 },
] as const satisfies readonly PetAccessory[];

export type PetAccessoryId = (typeof PET_ACCESSORIES)[number]["id"];

export function findAccessory(id: unknown): PetAccessory | null {
  return PET_ACCESSORIES.find((accessory) => accessory.id === id) ?? null;
}

/** A stored or submitted value is only an accessory if it is on the list. */
export function normalizeAccessory(value: unknown): PetAccessoryId | null {
  return (findAccessory(value)?.id as PetAccessoryId | undefined) ?? null;
}

export function isUnlocked(accessory: PetAccessory, progress: PetProgress): boolean {
  return (
    progress.captionsRated >= (accessory.captions ?? 0) &&
    progress.studiesCompleted >= (accessory.studies ?? 0)
  );
}

export function unlockHint(accessory: PetAccessory, progress?: PetProgress): string {
  if (accessory.studies) {
    const left = progress ? Math.max(0, accessory.studies - progress.studiesCompleted) : accessory.studies;
    return accessory.studies === 1 ? "Complete a study" : `Complete ${left} more studies`;
  }
  const needed = accessory.captions ?? 0;
  if (!progress) return `Rate ${needed} captions`;
  const left = Math.max(0, needed - progress.captionsRated);
  return `Rate ${left} more caption${left === 1 ? "" : "s"}`;
}

/** What is wearable right now, for a safe default when a stored choice is stale. */
export function equippableAccessory(value: unknown, progress: PetProgress): PetAccessoryId | null {
  const accessory = findAccessory(value);
  return accessory && isUnlocked(accessory, progress) ? (accessory.id as PetAccessoryId) : null;
}

/** Accessories that become available when progress goes from `before` to `after`. */
export function newlyUnlocked(before: PetProgress, after: PetProgress): PetAccessory[] {
  return PET_ACCESSORIES.filter((accessory) => !isUnlocked(accessory, before) && isUnlocked(accessory, after));
}
