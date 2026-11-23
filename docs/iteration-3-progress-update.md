# Semester Project, Part 4: Iteration 3 progress update

**Application:** funnystudy (the Humor Study participant app), with the Study Pet upgrade
**Deployed URL:** `<paste your Vercel production URL here>`
**How to review:** sign in with Google, adopt a pet on the home page, open a study, and rate captions.

## User persona

> **Edit this to match the persona you submitted in Parts 1 and 2.** The draft below is a
> placeholder that fits the feedback received.

**Sam, a junior at Columbia, chronically online.** Sam takes part in the humor study between
classes, usually on a phone, and tends to scroll fast. Sam will rate dozens of captions in a sitting
if it is fun, and drop the study entirely if it feels like a chore.

What Sam needs from this upgrade:

- A reason to come back to the study every day (a pet that gets hungry if neglected).
- A way to say "this isn't funny" without having to just scroll past, because scrolling past
  looks the same as not caring.
- Feedback that is obvious at a glance on a small screen, without a big animation getting in the
  way of the caption.
- Something to show for the time spent (accessories to unlock).

## What changed after the previous iteration

### PM feedback that was addressed

| PM feedback | What I changed |
|---|---|
| Add a dislike option; skipping was the only alternative to liking, and skipping cost the pet health. Make like, dislike and skip clearly different. | Added a labelled **Dislike** button next to **Like** on every caption. A dislike is saved as the study's existing "not funny at all" answer (legacy vote -1) and replaces a like on the same caption, and the other way round. Tapping the active button again takes it back. The rules are now: **like or dislike = an answer, never costs HP; skipping past quickly without either = loses HP.** A line under the buttons says so, and the start page explains it. |
| The heart animation is large and distracting. | Removed the full-screen wash, flashes, shockwave and the 2x spinning icon. A like is now a short icon pop (1.25x at most) with a small ring and six specks around the button, about half a second long. |
| Make sure liking and disliking give clear feedback about how they affect the pet. | The pet reacts the instant you tap, before the next caption: hearts float up and it hops on a like; it shrugs with a thumbs-down bubble on a dislike. The HP readout flashes a heart or a thumbs-down, and a notice says "liking never costs HP" or "disliking never costs HP either". |
| The pet is small on the study page; make it larger on both pages. | Home card pet is now 150 px (was 84). Study page pet is 84 px (was 34) on desktop, and a compact 56 px on phones so it does not cover the back arrow or the caption. |
| Hard to tell if the HP bar is decreasing; show a number like x/x and notify on HP loss. | HP is now shown as **"72 / 100"** on both pages. Every HP loss shows a notice that says how much and why ("Pip lost 8 HP: you skipped that caption (0.2s) without liking or disliking it"), and a red trail drains behind the bar so a loss is visible as a chunk. Losing HP to hunger over time also triggers a notice. |
| Customize the pet and unlock accessories as more studies are completed. | Added a **Wardrobe** on the home page with five accessories: bow tie (5 captions rated), sunglasses (15), party hat (30), graduation cap (complete a study) and crown (100). Locked items show what they need. The choice is saved, shows on the study page, and a notice says when an accessory is newly unlocked mid-study. Unlock rules are checked on the server, so an unearned item cannot be equipped. |

### Earlier feedback, already in the previous iteration

Faster caption image loading, and the pet health bar reacting to every caption.

### Checking that it fixes the original problem without new confusion

The original problem was that the pet's rules punished a participant for skipping, with no way to
say "I did not like this".

- Automated: 27 pet-rule tests and 29 routing tests pass, type-check and lint are clean. New tests
  cover "a liked or disliked caption is never rushed", "likes mixed with skips", and every
  accessory unlock threshold.
- Real browser (Edge, headless) against the live Supabase project, 19 checks, all passing:
  like saved as `funny`, dislike saved as `not funny at all` with legacy value -1, switching
  leaves exactly one vote, tapping again removes it, a quick skip after a like costs no HP,
  fast skips cost 8 HP each and show a notice with the reason (HP read 84 / 100 after the test
  skips), the heart burst is under 50 px wide with no
  full-screen overlay, the dislike is still shown on its caption after a reload.
- Confusing behavior found and fixed while checking:
  - On a phone the larger pet panel covered the back arrow and the caption title. It is now
    compact and the page reserves space for it.
  - The pet rules only looked at navigation events, so a quick like would have counted as a rush
    after a page reload even though it did not live. The reload path now treats any liked or
    disliked caption as answered, so the live pet and the reloaded pet agree.

## Third Product Manager review

> **Fill this in after the demo.** Per the rubric this has to be your real session.

- Date of the Feedback Session: `<date>`
- What I demonstrated: dislike button, smaller heart, pet reactions, HP number and loss notices,
  larger pet, wardrobe.
- PM feedback: `<paste the PM's comments>`

## Changes planned for the next iteration

These come from the review above plus problems I noticed while testing. Re-order them once the
third review is in.

1. **Keyboard shortcuts for like and dislike.** Arrow keys navigate, but only the mouse and touch
   can like or dislike. Add `L` and `D` so fast keyboard users do not feel forced to skip.
   Double-tap on the image only likes; consider a matching gesture for dislike.
2. **A first-time explanation.** The rules (like, dislike, skip) are in a hint line and on the start
   page. Watch whether a new participant understands them without reading, and add a one-time
   callout on the first caption if they do not.
3. **Equip accessories from the study page.** The wardrobe is only on the home page, so
   a newly unlocked accessory means leaving the study. Add a quick "wear it now" action on the unlock
   notice.
4. **Unlock pacing.** Only a couple of studies are open at once, so "complete a study" unlocks are
   rare. Check the thresholds against real activity and add more study-based unlocks if needed.
5. **Make sure a dislike carries information.** Disliking is a plain thumbs-down today. Decide with
   the PM whether to offer a one-tap reason ("didn't get it", "not funny") using the study's
   existing answer values.
6. **Notification volume.** Several notices can appear in quick succession while skipping fast.
   Group them if participants find them noisy.
