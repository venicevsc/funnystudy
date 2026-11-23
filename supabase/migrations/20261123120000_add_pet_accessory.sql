-- Pet accessories: which unlocked item the participant has chosen to wear.
-- Whether an accessory is unlocked is worked out from their study activity (see
-- src/lib/pet-accessories.ts), so only the choice is stored. The app ignores a
-- stored value that is not currently unlocked.

alter table public.pets
  add column if not exists accessory text
  check (accessory is null or char_length(accessory) between 1 and 20);
