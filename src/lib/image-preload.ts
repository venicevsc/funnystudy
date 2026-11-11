// Keeps the next batch of caption photos downloaded *and decoded* in the
// browser, so moving to the next caption shows its photo straight away instead
// of waiting on the network.
//
// The Image objects are held in a module-level map: if nothing referenced them
// the browser could drop the decoded bitmap (or even cancel the download), and
// the photo would have to be fetched again when it is finally shown.

import { buildThumbnailVariants } from "@/lib/thumbnails";

/** How many photos to keep warm at once (oldest are released first). */
const MAX_WARM_IMAGES = 60;

const warmImages = new Map<string, HTMLImageElement>();

function release(key: string) {
  const img = warmImages.get(key);
  if (!img) return;
  img.onerror = null;
  warmImages.delete(key);
}

/**
 * Starts loading the given photos in the order given, using the same
 * src/srcset/sizes the caption card will ask for, so the browser cache hit is
 * exact. Safe to call often: photos already warm are skipped.
 */
export function warmCaptionImages(urls: readonly (string | null | undefined)[]) {
  if (typeof window === "undefined") return;

  for (const url of urls) {
    if (!url || warmImages.has(url)) continue;

    const variants = buildThumbnailVariants(url);
    const img = new window.Image();
    img.decoding = "async";
    // Below the photo on screen right now, which the card asks for with "high".
    img.fetchPriority = "low";

    if (variants?.srcSet) {
      // Same fallback as the card: if the resized copies are missing, use the original.
      img.onerror = () => {
        img.onerror = null;
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
        img.src = url;
      };
      img.srcset = variants.srcSet;
      if (variants.sizes) img.sizes = variants.sizes;
    }
    img.src = variants?.src ?? url;

    // decode() turns the download into a ready-to-paint bitmap ahead of time.
    // A failure here just means the card decodes it itself later.
    img.decode?.().catch(() => {});

    warmImages.set(url, img);
  }

  while (warmImages.size > MAX_WARM_IMAGES) {
    const oldest = warmImages.keys().next().value;
    if (oldest === undefined) break;
    release(oldest);
  }
}
