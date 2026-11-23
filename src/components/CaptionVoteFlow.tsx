"use client";

import { HandThumbDownIcon as ThumbDownOutlineIcon, HeartIcon as HeartOutlineIcon } from "@heroicons/react/24/outline";
import { HandThumbDownIcon as ThumbDownSolidIcon, HeartIcon as HeartSolidIcon } from "@heroicons/react/24/solid";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { endStudy, startStudy } from "@/app/study/actions";
import type { StudyParticipation } from "@/lib/study-participation";
import type { StudyStats } from "@/lib/study-stats";
import { CompletedStudy } from "@/components/CompletedStudy";
import { announcePetReaction, announcePetVote } from "@/components/PetBuddy";
import { warmCaptionImages } from "@/lib/image-preload";
import { STUDY_CAPTION_BATCH_SIZE } from "@/lib/study-caption-order";

import {
  loadMoreCaptionVoteCaptions,
  removeCaptionVote,
  saveCaptionNavigationEvent,
  saveCaptionVote,
} from "@/app/actions";
import {
  DISLIKE_VOTE_VALUE,
  HEART_VOTE_VALUE,
  type VoteInputMethod,
} from "@/lib/caption-votes";

import { SwipeVoteCard } from "./SwipeVoteCard";

export type CaptionForVote = {
  id: string;
  isDisliked?: boolean;
  isLiked: boolean;
  isSaved: boolean;
  content: string | null;
  imageSrc: string | null;
  studyCaptionMappingId: number | null;
};

const VOTE_SESSION_STORAGE_KEY = "captionVoteSessionId";
const DEFAULT_VOTE_BAR_GUTTER_PX = 116;
const BASE_SCREEN_BOTTOM_PADDING_PX = 24;
const STANDALONE_PROGRESS_GUTTER_PX = 34;
const VOTE_BAR_PROGRESS_GUTTER_PX = 22;
const TOUCH_NAVIGATION_THRESHOLD_PX = 52;
const WHEEL_NAVIGATION_THRESHOLD_PX = 32;
const WHEEL_GESTURE_IDLE_MS = 110;
const HEART_BURST_CLEAR_MS = 980;
const PRELOAD_AHEAD_COUNT = 15;
const HEART_BURST_PARTICLES = [
  {
    x: -76,
    y: -22,
    delayMs: 0,
    sizePx: 8,
    durationMs: 720,
    rotateDeg: -14,
    stretch: 2.8,
  },
  {
    x: -64,
    y: -54,
    delayMs: 18,
    sizePx: 7,
    durationMs: 760,
    rotateDeg: -34,
    stretch: 2.4,
  },
  {
    x: -44,
    y: -86,
    delayMs: 0,
    sizePx: 7,
    durationMs: 780,
    rotateDeg: -70,
    stretch: 2.9,
  },
  {
    x: -12,
    y: -102,
    delayMs: 36,
    sizePx: 8,
    durationMs: 820,
    rotateDeg: -88,
    stretch: 3.2,
  },
  {
    x: 24,
    y: -84,
    delayMs: 28,
    sizePx: 6,
    durationMs: 700,
    rotateDeg: -58,
    stretch: 2.2,
  },
  {
    x: 38,
    y: -56,
    delayMs: 56,
    sizePx: 5,
    durationMs: 640,
    rotateDeg: -28,
    stretch: 1.9,
  },
  {
    x: -88,
    y: 4,
    delayMs: 42,
    sizePx: 7,
    durationMs: 700,
    rotateDeg: 0,
    stretch: 2.7,
  },
  {
    x: -74,
    y: 34,
    delayMs: 84,
    sizePx: 6,
    durationMs: 660,
    rotateDeg: 22,
    stretch: 2.2,
  },
  {
    x: -46,
    y: 56,
    delayMs: 110,
    sizePx: 6,
    durationMs: 620,
    rotateDeg: 48,
    stretch: 2.1,
  },
  {
    x: -14,
    y: 68,
    delayMs: 120,
    sizePx: 5,
    durationMs: 580,
    rotateDeg: 78,
    stretch: 1.8,
  },
  {
    x: 16,
    y: 34,
    delayMs: 96,
    sizePx: 4,
    durationMs: 540,
    rotateDeg: 54,
    stretch: 1.6,
  },
  {
    x: 28,
    y: 2,
    delayMs: 70,
    sizePx: 4,
    durationMs: 500,
    rotateDeg: 12,
    stretch: 1.5,
  },
] as const;

type VoteEventDetails = {
  clientEventId: string;
  inputMethod: VoteInputMethod;
  sessionId: string;
  timeToVoteMs: number;
};

type NavigationEventDetails = {
  clientEventId: string;
  inputMethod: VoteInputMethod;
  sessionId: string;
  timeToNextCaptionMs: number;
};

type TouchGestureState = {
  active: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
};

type VoteStatus = "removing" | "saving" | "saved";
type VoteKind = "like" | "dislike";
type HeartBurstState = {
  kind: VoteKind;
  token: number;
  voteKey: string | null;
};
type SessionStudyStatsState = {
  likedCaptionTimeMsByKey: Record<string, number>;
  navigationTimeMsByKey: Record<string, number>;
  viewedCaptionKeys: Record<string, true>;
};
type CaptionFlipDirection = "backward" | "forward";

function createEmptySessionStudyStats(): SessionStudyStatsState {
  return {
    likedCaptionTimeMsByKey: {},
    navigationTimeMsByKey: {},
    viewedCaptionKeys: {},
  };
}

function getMedianValue(values: number[]) {
  if (!values.length) {
    return null;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 1) {
    return sortedValues[middleIndex];
  }

  return Math.round(
    (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2
  );
}

function summarizeCompletionStats(
  sessionStudyStats: SessionStudyStatsState,
  viewedCountFloor = 0
): StudyStats {
  const viewedCount = Math.max(
    viewedCountFloor,
    Object.keys(sessionStudyStats.viewedCaptionKeys).length
  );
  const likedCount = Object.keys(sessionStudyStats.likedCaptionTimeMsByKey).length;
  const medianVoteTimeMs = getMedianValue(
    Object.values(sessionStudyStats.likedCaptionTimeMsByKey)
  );
  const medianNavigationTimeMs = getMedianValue(
    Object.values(sessionStudyStats.navigationTimeMsByKey)
  );

  return {
    likedCount,
    medianNavigationTimeMs,
    medianVoteTimeMs,
    viewedCount,
  };
}

function getNowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function normalizeWheelDeltaY(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * (window.innerHeight || 1);
  }

  return event.deltaY;
}

function isCaptionTimerActive() {
  if (typeof document === "undefined") {
    return false;
  }

  return document.visibilityState === "visible" && document.hasFocus();
}

function createClientUuid() {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getCaptionVoteKey(caption: CaptionForVote | undefined) {
  if (!caption) {
    return null;
  }

  if (
    typeof caption.studyCaptionMappingId === "number" &&
    Number.isSafeInteger(caption.studyCaptionMappingId) &&
    caption.studyCaptionMappingId > 0
  ) {
    return `mapping:${caption.studyCaptionMappingId}`;
  }

  return `caption:${caption.id}`;
}

function createPersistedVoteStatusLookup(captions: readonly CaptionForVote[]) {
  return captions.reduce<Record<string, VoteStatus>>((lookup, caption) => {
    if (!caption.isLiked && !caption.isDisliked) {
      return lookup;
    }

    const voteKey = getCaptionVoteKey(caption);

    if (voteKey) {
      lookup[voteKey] = "saved";
    }

    return lookup;
  }, {});
}

function createPersistedVoteKindLookup(captions: readonly CaptionForVote[]) {
  return captions.reduce<Record<string, VoteKind>>((lookup, caption) => {
    const voteKey = getCaptionVoteKey(caption);

    if (voteKey && caption.isDisliked) {
      lookup[voteKey] = "dislike";
    } else if (voteKey && caption.isLiked) {
      lookup[voteKey] = "like";
    }

    return lookup;
  }, {});
}

function shouldIgnoreKeyboardNavigationTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [data-native-scroll-region='true']"
    )
  );
}

function shouldIgnoreWheelNavigationTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], #account-menu-root, #theme-menu-root, [data-native-scroll-region='true']"
    )
  );
}

function shouldIgnoreTouchNavigationTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], #account-menu-root, #theme-menu-root, [data-native-scroll-region='true']"
    )
  );
}

export function CaptionVoteFlow({
  captionOrder,
  captions,
  includePrivateStudies,
  initialNextOffset,
  initialTotalCaptionCount,
  initialParticipation,
  reservedTopPx = 0,
  studyId,
  onPendingChange,
}: {
  captionOrder: string[];
  captions: CaptionForVote[];
  includePrivateStudies?: boolean;
  initialNextOffset: number | null;
  initialTotalCaptionCount: number;
  initialParticipation: StudyParticipation | null;
  reservedTopPx?: number;
  studyId?: number | null;
  onPendingChange?: (count: number) => void;
}) {
  const [voteBarGutterPx, setVoteBarGutterPx] = useState(
    DEFAULT_VOTE_BAR_GUTTER_PX
  );
  const [isStartPageVisible, setIsStartPageVisible] = useState(
    captions.length > 0
  );
  const [queue, setQueue] = useState(captions);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isShortViewport, setIsShortViewport] = useState(false);
  const [isLoadingMoreCaptions, setIsLoadingMoreCaptions] = useState(false);
  const [nextCaptionOffset, setNextCaptionOffset] = useState(initialNextOffset);
  const [pendingCount, setPendingCount] = useState(0);
  const [participation, setParticipation] = useState(initialParticipation);
  const [participationPending, setParticipationPending] = useState(false);
  const participationPendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [captionFlipDirection, setCaptionFlipDirection] =
    useState<CaptionFlipDirection>("forward");
  const [isWheelNavigationOverlayVisible, setIsWheelNavigationOverlayVisible] =
    useState(false);
  const [heartBurst, setHeartBurst] = useState<HeartBurstState>({
    kind: "like",
    token: 0,
    voteKey: null,
  });
  const [isCompletionPageVisible, setIsCompletionPageVisible] = useState(false);
  const [sessionStudyStats, setSessionStudyStats] =
    useState<SessionStudyStatsState>(() => createEmptySessionStudyStats());
  const [voteStatuses, setVoteStatuses] = useState<Record<string, VoteStatus>>(
    () => createPersistedVoteStatusLookup(captions)
  );
  const [voteKinds, setVoteKinds] = useState<Record<string, VoteKind>>(() =>
    createPersistedVoteKindLookup(captions)
  );
  const activeVoteTimeMs = useRef(0);
  const activeVoteStartedAtMs = useRef<number | null>(
    isCaptionTimerActive() ? getNowMs() : null
  );
  const activeNavigationTimeMs = useRef(0);
  const activeNavigationStartedAtMs = useRef<number | null>(
    isCaptionTimerActive() ? getNowMs() : null
  );
  const currentIndexRef = useRef(0);
  const touchGestureRef = useRef<TouchGestureState>({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });
  const voteSessionIdRef = useRef<string | null>(null);
  const wheelGestureRef = useRef<{
    accumulatedY: number;
    isLocked: boolean;
    lastEventTimeMs: number;
  }>({
    accumulatedY: 0,
    isLocked: false,
    lastEventTimeMs: 0,
  });
  const heartBurstTimeoutIdRef = useRef<number | null>(null);
  const requestedCaptionOffsetsRef = useRef<Set<number>>(new Set());
  const wheelNavigationOverlayTimeoutIdRef = useRef<number | null>(null);
  const wheelNavigationOverlayVisibleRef = useRef(false);

  useEffect(() => {
    onPendingChange?.(pendingCount);
  }, [onPendingChange, pendingCount]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    wheelNavigationOverlayVisibleRef.current = isWheelNavigationOverlayVisible;
  }, [isWheelNavigationOverlayVisible]);

  useEffect(() => {
    const maxIndex = Math.max(0, queue.length - 1);

    setCurrentIndex((previousIndex) => {
      const clampedIndex = Math.min(previousIndex, maxIndex);
      currentIndexRef.current = clampedIndex;
      return clampedIndex;
    });
  }, [queue.length]);

  useEffect(() => {
    setQueue(captions);
    setVoteStatuses(createPersistedVoteStatusLookup(captions));
    setIsCompletionPageVisible(false);
    setNextCaptionOffset(initialNextOffset);
    requestedCaptionOffsetsRef.current.clear();
  }, [captions, initialNextOffset]);

  useEffect(() => {
    return () => {
      if (wheelNavigationOverlayTimeoutIdRef.current !== null) {
        window.clearTimeout(wheelNavigationOverlayTimeoutIdRef.current);
      }

      if (heartBurstTimeoutIdRef.current !== null) {
        window.clearTimeout(heartBurstTimeoutIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(pointer: coarse)");

    const updateGutter = () => {
      const height = window.visualViewport?.height ?? window.innerHeight ?? 0;
      const isCoarse = mediaQuery.matches;

      let next: number;

      if (isCoarse) {
        if (height < 430) {
          next = 94;
        } else if (height < 520) {
          next = 102;
        } else if (height < 680) {
          next = 110;
        } else {
          next = 116;
        }
      } else if (height < 540) {
        next = 82;
      } else if (height < 720) {
        next = 90;
      } else {
        next = 98;
      }

      const minGutter = isCoarse ? 88 : 76;
      const maxGutter = isCoarse ? 132 : 112;

      setVoteBarGutterPx(Math.min(maxGutter, Math.max(minGutter, next)));
      setIsShortViewport(height < 620);
    };

    updateGutter();
    window.addEventListener("resize", updateGutter);
    window.addEventListener("orientationchange", updateGutter);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", updateGutter);
    } else {
      mediaQuery.addListener(updateGutter);
    }

    return () => {
      window.removeEventListener("resize", updateGutter);
      window.removeEventListener("orientationchange", updateGutter);

      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", updateGutter);
      } else {
        mediaQuery.removeListener(updateGutter);
      }
    };
  }, []);

  const current = queue[currentIndex];
  const currentVoteKey = getCaptionVoteKey(current);
  const currentVoteStatus = currentVoteKey ? voteStatuses[currentVoteKey] : null;
  const isCurrentVoteSaving = currentVoteStatus === "saving";
  const isCurrentVoteRemoving = currentVoteStatus === "removing";
  const hasCurrentVote =
    currentVoteStatus === "saved" ||
    currentVoteStatus === "saving" ||
    currentVoteStatus === "removing";
  const currentVoteKind: VoteKind = (currentVoteKey && voteKinds[currentVoteKey]) || "like";
  const hasCurrentLike = hasCurrentVote && currentVoteKind === "like";
  const hasCurrentDislike = hasCurrentVote && currentVoteKind === "dislike";
  const likeBurstToken =
    heartBurst.voteKey === currentVoteKey && heartBurst.kind === "like" ? heartBurst.token : 0;
  const dislikeBurstToken =
    heartBurst.voteKey === currentVoteKey && heartBurst.kind === "dislike" ? heartBurst.token : 0;
  const isShowingCompletionPage =
    !isStartPageVisible && (queue.length === 0 || isCompletionPageVisible);
  const shouldShowInlineCaptionActions = Boolean(current?.imageSrc);
  const shouldShowVoteBar =
    !isStartPageVisible &&
    !shouldShowInlineCaptionActions &&
    !isShowingCompletionPage;
  const totalCaptionCount = Math.max(initialTotalCaptionCount, queue.length);
  const currentCaptionNumber =
    current && totalCaptionCount > 0
      ? Math.min(totalCaptionCount, currentIndex + 1)
      : null;
  const captionProgressLabel =
    currentCaptionNumber && totalCaptionCount > 0
      ? `${currentCaptionNumber.toLocaleString("en-US")}/${totalCaptionCount.toLocaleString("en-US")}`
      : null;
  const shouldShowCaptionProgress =
    Boolean(captionProgressLabel) &&
    !isStartPageVisible &&
    !isShowingCompletionPage;
  const reservedBottomPx = shouldShowVoteBar
    ? voteBarGutterPx + VOTE_BAR_PROGRESS_GUTTER_PX
    : 0;
  const standaloneProgressPaddingPx =
    shouldShowCaptionProgress && !shouldShowVoteBar
      ? STANDALONE_PROGRESS_GUTTER_PX
      : 0;
  const contentBottomPaddingPx =
    reservedBottomPx + BASE_SCREEN_BOTTOM_PADDING_PX + standaloneProgressPaddingPx;
  // Photos to have downloaded and decoded before they're needed. Fifteen ahead
  // stays in front of someone skipping quickly; while the start page is up,
  // the current photo is included so it's ready the moment they begin.
  const preloadImageUrls = useMemo(
    () =>
      queue
        .slice(
          isStartPageVisible ? currentIndex : currentIndex + 1,
          currentIndex + 1 + PRELOAD_AHEAD_COUNT
        )
        .map((caption) => caption.imageSrc)
        .filter((url): url is string => Boolean(url)),
    [currentIndex, isStartPageVisible, queue]
  );

  // The card isn't on screen behind the start page, so warm the first batch here.
  useEffect(() => {
    if (isStartPageVisible) warmCaptionImages(preloadImageUrls);
  }, [isStartPageVisible, preloadImageUrls]);

  const getVoteSessionId = useCallback(() => {
    if (voteSessionIdRef.current) {
      return voteSessionIdRef.current;
    }

    const nextSessionId = createClientUuid();

    try {
      const existingSessionId = window.sessionStorage.getItem(
        VOTE_SESSION_STORAGE_KEY
      );

      if (existingSessionId) {
        voteSessionIdRef.current = existingSessionId;
        return existingSessionId;
      }

      window.sessionStorage.setItem(VOTE_SESSION_STORAGE_KEY, nextSessionId);
    } catch {
      // Storage access can fail in restricted browser contexts; fall back to memory.
    }

    voteSessionIdRef.current = nextSessionId;
    return nextSessionId;
  }, []);

  const pauseVoteTimer = useCallback(() => {
    if (activeVoteStartedAtMs.current === null) {
      return;
    }

    activeVoteTimeMs.current += Math.max(
      0,
      getNowMs() - activeVoteStartedAtMs.current
    );
    activeVoteStartedAtMs.current = null;
  }, []);

  const resumeVoteTimer = useCallback(() => {
    if (activeVoteStartedAtMs.current !== null) {
      return;
    }

    activeVoteStartedAtMs.current = getNowMs();
  }, []);

  const syncVoteTimer = useCallback(() => {
    if (isStartPageVisible || currentVoteStatus || isShowingCompletionPage) {
      pauseVoteTimer();
      return;
    }

    if (isCaptionTimerActive()) {
      resumeVoteTimer();
      return;
    }

    pauseVoteTimer();
  }, [
    isStartPageVisible,
    isShowingCompletionPage,
    currentVoteStatus,
    pauseVoteTimer,
    resumeVoteTimer,
  ]);

  const resetVoteTimer = useCallback(() => {
    activeVoteTimeMs.current = 0;
    activeVoteStartedAtMs.current = isCaptionTimerActive() ? getNowMs() : null;
  }, []);

  const getActiveVoteTimeMs = useCallback(() => {
    const activeSegmentMs =
      activeVoteStartedAtMs.current === null
        ? 0
        : Math.max(0, getNowMs() - activeVoteStartedAtMs.current);

    return Math.max(0, Math.round(activeVoteTimeMs.current + activeSegmentMs));
  }, []);

  const createVoteEventDetails = useCallback(
    (inputMethod: VoteInputMethod): VoteEventDetails => ({
      clientEventId: createClientUuid(),
      inputMethod,
      sessionId: getVoteSessionId(),
      timeToVoteMs: getActiveVoteTimeMs(),
    }),
    [getActiveVoteTimeMs, getVoteSessionId]
  );

  const pauseNavigationTimer = useCallback(() => {
    if (activeNavigationStartedAtMs.current === null) {
      return;
    }

    activeNavigationTimeMs.current += Math.max(
      0,
      getNowMs() - activeNavigationStartedAtMs.current
    );
    activeNavigationStartedAtMs.current = null;
  }, []);

  const resumeNavigationTimer = useCallback(() => {
    if (activeNavigationStartedAtMs.current !== null) {
      return;
    }

    activeNavigationStartedAtMs.current = getNowMs();
  }, []);

  const syncNavigationTimer = useCallback(() => {
    if (isStartPageVisible || isShowingCompletionPage) {
      pauseNavigationTimer();
      return;
    }

    if (isCaptionTimerActive()) {
      resumeNavigationTimer();
      return;
    }

    pauseNavigationTimer();
  }, [
    isStartPageVisible,
    isShowingCompletionPage,
    pauseNavigationTimer,
    resumeNavigationTimer,
  ]);

  const resetNavigationTimer = useCallback(() => {
    activeNavigationTimeMs.current = 0;
    activeNavigationStartedAtMs.current = isCaptionTimerActive()
      ? getNowMs()
      : null;
  }, []);

  const getActiveNavigationTimeMs = useCallback(() => {
    const activeSegmentMs =
      activeNavigationStartedAtMs.current === null
        ? 0
        : Math.max(0, getNowMs() - activeNavigationStartedAtMs.current);

    return Math.max(
      0,
      Math.round(activeNavigationTimeMs.current + activeSegmentMs)
    );
  }, []);

  const createNavigationEventDetails = useCallback(
    (inputMethod: VoteInputMethod): NavigationEventDetails => ({
      clientEventId: createClientUuid(),
      inputMethod,
      sessionId: getVoteSessionId(),
      timeToNextCaptionMs: getActiveNavigationTimeMs(),
    }),
    [getActiveNavigationTimeMs, getVoteSessionId]
  );

  const setVoteStatus = useCallback(
    (voteKey: string | null, status: VoteStatus | null) => {
      if (!voteKey) {
        return;
      }

      setVoteStatuses((prev) => {
        if (status === null) {
          const next = { ...prev };
          delete next[voteKey];
          return next;
        }

        return {
          ...prev,
          [voteKey]: status,
        };
      });
    },
    []
  );

  const setVoteKind = useCallback((voteKey: string, kind: VoteKind | null) => {
    setVoteKinds((previous) => {
      if (kind === null) {
        const next = { ...previous };
        delete next[voteKey];
        return next;
      }

      return { ...previous, [voteKey]: kind };
    });
  }, []);

  /** A caption that is no longer liked stops counting towards the liked stats. */
  const forgetLikedTime = useCallback((voteKey: string) => {
    setSessionStudyStats((previousStats) => {
      const nextLikedCaptionTimeMsByKey = { ...previousStats.likedCaptionTimeMsByKey };

      delete nextLikedCaptionTimeMsByKey[voteKey];

      return {
        likedCaptionTimeMsByKey: nextLikedCaptionTimeMsByKey,
        navigationTimeMsByKey: previousStats.navigationTimeMsByKey,
        viewedCaptionKeys: previousStats.viewedCaptionKeys,
      };
    });
  }, []);

  const triggerReactionBurst = useCallback((voteKey: string | null, kind: VoteKind) => {
    if (!voteKey) {
      return;
    }

    setHeartBurst((previousBurst) => ({
      kind,
      token: previousBurst.token + 1,
      voteKey,
    }));

    if (heartBurstTimeoutIdRef.current !== null) {
      window.clearTimeout(heartBurstTimeoutIdRef.current);
    }

    heartBurstTimeoutIdRef.current = window.setTimeout(() => {
      setHeartBurst((previousBurst) =>
        previousBurst.voteKey === voteKey
          ? {
              ...previousBurst,
              voteKey: null,
            }
          : previousBurst
      );
      heartBurstTimeoutIdRef.current = null;
    }, HEART_BURST_CLEAR_MS);
  }, []);

  const appendCaptionBatch = useCallback((incomingCaptions: CaptionForVote[]) => {
    if (!incomingCaptions.length) {
      return;
    }

    const appendedCaptions: CaptionForVote[] = [];

    setQueue((previousQueue) => {
      const seenVoteKeys = new Set(
        previousQueue
          .map((caption) => getCaptionVoteKey(caption))
          .filter((voteKey): voteKey is string => Boolean(voteKey))
      );
      const nextQueue = [...previousQueue];

      incomingCaptions.forEach((caption) => {
        const voteKey = getCaptionVoteKey(caption);

        if (!voteKey || seenVoteKeys.has(voteKey)) {
          return;
        }

        seenVoteKeys.add(voteKey);
        nextQueue.push(caption);
        appendedCaptions.push(caption);
      });

      return nextQueue;
    });

    if (appendedCaptions.length) {
      setVoteStatuses((previousVoteStatuses) => {
        const nextVoteStatuses = { ...previousVoteStatuses };

        appendedCaptions.forEach((caption) => {
          if (!caption.isLiked && !caption.isDisliked) {
            return;
          }

          const voteKey = getCaptionVoteKey(caption);

          if (voteKey) {
            nextVoteStatuses[voteKey] = "saved";
          }
        });

        return nextVoteStatuses;
      });
      setVoteKinds((previousKinds) => ({
        ...previousKinds,
        ...createPersistedVoteKindLookup(appendedCaptions),
      }));
    }
  }, []);

  const loadMoreCaptions = useCallback(
    async (offset: number) => {
      if (
        isLoadingMoreCaptions ||
        requestedCaptionOffsetsRef.current.has(offset)
      ) {
        return;
      }

      requestedCaptionOffsetsRef.current.add(offset);
      setIsLoadingMoreCaptions(true);

      try {
        const captionIds = captionOrder.slice(offset, offset + STUDY_CAPTION_BATCH_SIZE);
        const result = await loadMoreCaptionVoteCaptions({
          captionIds,
          includePrivateStudies,
          studyId,
        });

        if (!result.success) {
          requestedCaptionOffsetsRef.current.delete(offset);
          setError(
            result.error ?? "We couldn't load more captions. Please try again."
          );
          return;
        }

        appendCaptionBatch(result.captions);
        const consumedCount = offset + captionIds.length;
        setNextCaptionOffset(consumedCount < captionOrder.length ? consumedCount : null);
      } catch (err) {
        console.error("[CaptionVoteFlow] load more captions failed", err);
        requestedCaptionOffsetsRef.current.delete(offset);
        setError("We couldn't load more captions. Please try again.");
      } finally {
        setIsLoadingMoreCaptions(false);
      }
    },
    [appendCaptionBatch, captionOrder, includePrivateStudies, isLoadingMoreCaptions, studyId]
  );

  const moveToCaptionIndex = useCallback(
    (nextIndex: number) => {
      const maxIndex = queue.length - 1;

      if (maxIndex < 0) {
        return false;
      }

      const clampedIndex = Math.min(maxIndex, Math.max(0, nextIndex));

      if (clampedIndex === currentIndexRef.current) {
        return false;
      }

      currentIndexRef.current = clampedIndex;
      setCurrentIndex(clampedIndex);
      return true;
    },
    [queue.length]
  );

  const saveForwardNavigationTelemetry = useCallback(
    (inputMethod: VoteInputMethod) => {
      if (!current) {
        return;
      }

      const navigationTarget = current;
      const navigationVoteKey = getCaptionVoteKey(navigationTarget);
      const eventDetails = createNavigationEventDetails(inputMethod);

      if (navigationVoteKey) {
        setSessionStudyStats((previousStats) => ({
          likedCaptionTimeMsByKey: previousStats.likedCaptionTimeMsByKey,
          navigationTimeMsByKey: {
            ...previousStats.navigationTimeMsByKey,
            [navigationVoteKey]: eventDetails.timeToNextCaptionMs,
          },
          viewedCaptionKeys: {
            ...previousStats.viewedCaptionKeys,
            [navigationVoteKey]: true,
          },
        }));
      }

      // Every caption you move past feeds the study pet (see src/lib/pet.ts).
      const navigationVoteStatus = navigationVoteKey ? voteStatuses[navigationVoteKey] : null;
      announcePetVote({
        timeToVoteMs: eventDetails.timeToNextCaptionMs,
        rated: navigationVoteStatus === "saved" || navigationVoteStatus === "saving",
      });

      void saveCaptionNavigationEvent({
        captionId: navigationTarget.id,
        clientEventId: eventDetails.clientEventId,
        inputMethod: eventDetails.inputMethod,
        sessionId: eventDetails.sessionId,
        studyCaptionMappingId: navigationTarget.studyCaptionMappingId,
        timeToNextCaptionMs: eventDetails.timeToNextCaptionMs,
      })
        .then((result) => {
          if (!result?.success) {
            console.error(
              "[CaptionVoteFlow] save navigation telemetry failed",
              result?.error
            );
          }
        })
        .catch((err) => {
          console.error("[CaptionVoteFlow] save navigation telemetry failed", err);
        });
    },
    [createNavigationEventDetails, current, voteStatuses]
  );

  const handleStartStudy = useCallback(async () => {
    if (participationPendingRef.current || !studyId) return;
    if (participation?.started_at && !participation.ended_at) {
      setCaptionFlipDirection("forward");
      setIsStartPageVisible(false);
      return;
    }
    participationPendingRef.current = true;
    setParticipationPending(true);
    setError(null);
    try {
      const result = await startStudy(studyId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setParticipation(result.participation);
      setCaptionFlipDirection("forward");
      setIsStartPageVisible(false);
      setIsCompletionPageVisible(Boolean(result.participation.ended_at));
    } catch {
      setError("We couldn't start this study. Please try again.");
    } finally {
      participationPendingRef.current = false;
      setParticipationPending(false);
    }
  }, [participation, studyId]);

  const handleEndStudy = useCallback(async () => {
    if (
      !isShowingCompletionPage ||
      participationPendingRef.current ||
      pendingCount > 0 ||
      !studyId ||
      participation?.ended_at
    ) return;
    participationPendingRef.current = true;
    setParticipationPending(true);
    setError(null);
    try {
      const result = await endStudy(studyId, summarizeCompletionStats(sessionStudyStats));
      if (!result.success) {
        setError(result.error);
        return;
      }
      setParticipation(result.participation);
    } catch {
      setError("We couldn't end this study. Please try again.");
    } finally {
      participationPendingRef.current = false;
      setParticipationPending(false);
    }
  }, [isShowingCompletionPage, participation?.ended_at, pendingCount, sessionStudyStats, studyId]);

  const navigateToRelativeCaption = useCallback(
    (offset: -1 | 1, inputMethod: VoteInputMethod) => {
      if (participationPendingRef.current || participation?.ended_at) return false;
      if (isStartPageVisible) {
        if (offset === 1 && current) {
          void handleStartStudy();
          return true;
        }

        return false;
      }

      if (isShowingCompletionPage) {
        if (offset === -1 && current) {
          setCaptionFlipDirection("backward");
          setIsCompletionPageVisible(false);
          return true;
        }

        return true;
      }

      const nextIndex = currentIndexRef.current + offset;

      if (offset === -1 && nextIndex < 0 && current) {
        setCaptionFlipDirection("backward");
        setIsStartPageVisible(true);
        return true;
      }

      if (offset === 1) {
        const maxIndex = queue.length - 1;

        if (maxIndex < 0) {
          setIsCompletionPageVisible(true);
          return true;
        }

        if (nextIndex > maxIndex) {
          if (nextCaptionOffset !== null && !isLoadingMoreCaptions) {
            void loadMoreCaptions(nextCaptionOffset);
            return false;
          }

          if (nextCaptionOffset === null) {
            saveForwardNavigationTelemetry(inputMethod);
            pauseVoteTimer();
            pauseNavigationTimer();
            setIsCompletionPageVisible(true);
            return true;
          }

          return false;
        }

        saveForwardNavigationTelemetry(inputMethod);
      }

      setCaptionFlipDirection(offset === 1 ? "forward" : "backward");
      return moveToCaptionIndex(nextIndex);
    },
    [
      current,
      handleStartStudy,
      participation?.ended_at,
      isStartPageVisible,
      isShowingCompletionPage,
      isLoadingMoreCaptions,
      loadMoreCaptions,
      moveToCaptionIndex,
      nextCaptionOffset,
      pauseNavigationTimer,
      pauseVoteTimer,
      queue.length,
      saveForwardNavigationTelemetry,
    ]
  );

  const handleWheelNavigation = useCallback(
    (event: WheelEvent) => {
      const deltaY = normalizeWheelDeltaY(event);

      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        shouldIgnoreWheelNavigationTarget(event.target) ||
        Math.abs(deltaY) < 4 ||
        Math.abs(deltaY) < Math.abs(event.deltaX) ||
        queue.length === 0
      ) {
        return;
      }

      event.preventDefault();

      const wheelGesture = wheelGestureRef.current;
      const nowMs = getNowMs();
      const timeSinceLastEventMs = nowMs - wheelGesture.lastEventTimeMs;

      const scheduleWheelNavigationOverlay = () => {
        if (wheelNavigationOverlayTimeoutIdRef.current !== null) {
          window.clearTimeout(wheelNavigationOverlayTimeoutIdRef.current);
        }

        if (!wheelNavigationOverlayVisibleRef.current) {
          wheelNavigationOverlayVisibleRef.current = true;
          setIsWheelNavigationOverlayVisible(true);
        }

        wheelNavigationOverlayTimeoutIdRef.current = window.setTimeout(() => {
          wheelNavigationOverlayTimeoutIdRef.current = null;
          wheelNavigationOverlayVisibleRef.current = false;
          setIsWheelNavigationOverlayVisible(false);
        }, WHEEL_GESTURE_IDLE_MS);
      };

      if (wheelGesture.isLocked) {
        if (timeSinceLastEventMs > WHEEL_GESTURE_IDLE_MS) {
          wheelGesture.isLocked = false;
          wheelGesture.accumulatedY = 0;
        } else {
          wheelGesture.lastEventTimeMs = nowMs;
          if (wheelNavigationOverlayVisibleRef.current) {
            scheduleWheelNavigationOverlay();
          }
          return;
        }
      } else if (timeSinceLastEventMs > WHEEL_GESTURE_IDLE_MS) {
        wheelGesture.accumulatedY = 0;
      }

      wheelGesture.lastEventTimeMs = nowMs;
      wheelGesture.accumulatedY += deltaY;

      if (Math.abs(wheelGesture.accumulatedY) < WHEEL_NAVIGATION_THRESHOLD_PX) {
        return;
      }

      // Interpret trackpad/mouse-wheel input as scroll direction, not raw finger
      // motion, so the browser/OS scroll preference continues to apply.
      const didHandleNavigation = navigateToRelativeCaption(
        wheelGesture.accumulatedY > 0 ? 1 : -1,
        "swipe"
      );

      if (didHandleNavigation) {
        wheelGesture.isLocked = true;
        wheelGesture.accumulatedY = 0;
        wheelGesture.lastEventTimeMs = nowMs;
        scheduleWheelNavigationOverlay();
      }
    },
    [navigateToRelativeCaption, queue.length]
  );

  const handleTouchStart = useCallback((event: TouchEvent) => {
    if (
      event.defaultPrevented ||
      shouldIgnoreTouchNavigationTarget(event.target) ||
      event.touches.length !== 1
    ) {
      touchGestureRef.current.active = false;
      return;
    }

    const touch = event.touches[0];

    touchGestureRef.current = {
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
    };
  }, []);

  const tryNavigateFromTouchGesture = useCallback(
    (endX: number, endY: number) => {
      const touchGesture = touchGestureRef.current;

      if (!touchGesture.active) {
        return false;
      }

      const deltaX = endX - touchGesture.startX;
      const deltaY = endY - touchGesture.startY;

      if (
        Math.abs(deltaY) < TOUCH_NAVIGATION_THRESHOLD_PX ||
        Math.abs(deltaY) < Math.abs(deltaX) * 1.15
      ) {
        return false;
      }

      touchGesture.active = false;
      return navigateToRelativeCaption(deltaY < 0 ? 1 : -1, "swipe");
    },
    [navigateToRelativeCaption]
  );

  const handleTouchMove = useCallback((event: TouchEvent) => {
    if (!touchGestureRef.current.active || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    touchGestureRef.current.lastX = touch.clientX;
    touchGestureRef.current.lastY = touch.clientY;

    tryNavigateFromTouchGesture(touch.clientX, touch.clientY);
  }, [tryNavigateFromTouchGesture]);

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      const touchGesture = touchGestureRef.current;

      if (!touchGesture.active) {
        return;
      }

      const touch = event.changedTouches[0];
      const endX = touch?.clientX ?? touchGesture.lastX;
      const endY = touch?.clientY ?? touchGesture.lastY;

      if (!tryNavigateFromTouchGesture(endX, endY)) {
        touchGesture.active = false;
      }
    },
    [tryNavigateFromTouchGesture]
  );

  const handleTouchCancel = useCallback(() => {
    touchGestureRef.current.active = false;
  }, []);

  const handleKeyboardNavigation = useCallback(
    (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        shouldIgnoreKeyboardNavigationTarget(event.target) ||
        event.repeat
      ) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        navigateToRelativeCaption(1, "keyboard");
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        navigateToRelativeCaption(-1, "keyboard");
      }
    },
    [navigateToRelativeCaption]
  );

  // Like and dislike share one slot per caption: choosing one replaces the other,
  // and choosing the same one again takes it back.
  const castVote = useCallback(
    (kind: VoteKind) => {
      if (participationPendingRef.current || !current || !currentVoteKey) {
        return;
      }

      const voteKey = currentVoteKey;
      const savedKind: VoteKind = voteKinds[voteKey] ?? "like";

      if (currentVoteStatus === "saved" && savedKind === kind) {
        const voteTarget = current;

        setPendingCount((count) => count + 1);
        setError(null);
        setVoteStatus(voteKey, "removing");

        removeCaptionVote({
          captionId: voteTarget.id,
          studyCaptionMappingId: voteTarget.studyCaptionMappingId,
        })
          .then((result) => {
            if (!result?.success) {
              setVoteStatus(voteKey, "saved");
              setError(
                result?.error ?? "We couldn't remove your vote. Please try again."
              );
              return;
            }

            setVoteStatus(voteKey, null);
            setVoteKind(voteKey, null);
            forgetLikedTime(voteKey);
            announcePetReaction("clear");
            resetVoteTimer();
          })
          .catch((err) => {
            console.error("[CaptionVoteFlow] remove vote failed", err);
            setVoteStatus(voteKey, "saved");
            setError("We couldn't remove your vote. Please try again.");
          })
          .finally(() => {
            setPendingCount((count) => Math.max(0, count - 1));
          });

        return;
      }

      // Saving or removing something else right now: wait for it to finish.
      if (currentVoteStatus && currentVoteStatus !== "saved") {
        return;
      }

      const switching = currentVoteStatus === "saved";
      const voteTarget = current;
      setPendingCount((count) => count + 1);
      setError(null);

      const eventDetails = createVoteEventDetails("button");

      pauseVoteTimer();
      setVoteStatus(voteKey, "saving");
      setVoteKind(voteKey, kind);
      triggerReactionBurst(voteKey, kind);
      // The pet reacts at once; it does not wait for the save to come back.
      announcePetReaction(kind);

      const run = async (): Promise<{ ok: boolean; error?: string; keptPrevious?: boolean }> => {
        if (switching) {
          const removed = await removeCaptionVote({
            captionId: voteTarget.id,
            studyCaptionMappingId: voteTarget.studyCaptionMappingId,
          });

          if (!removed?.success) {
            return {
              ok: false,
              keptPrevious: true,
              error: removed?.error ?? "We couldn't change your vote. Please try again.",
            };
          }
        }

        const result = await saveCaptionVote({
          captionId: voteTarget.id,
          clientEventId: eventDetails.clientEventId,
          inputMethod: eventDetails.inputMethod,
          sessionId: eventDetails.sessionId,
          studyCaptionMappingId: voteTarget.studyCaptionMappingId,
          timeToVoteMs: eventDetails.timeToVoteMs,
          value: kind === "like" ? HEART_VOTE_VALUE : DISLIKE_VOTE_VALUE,
        });

        return result?.success
          ? { ok: true }
          : { ok: false, error: result?.error ?? "We couldn't save your vote. Please try again." };
      };

      run()
        .then((result) => {
          if (!result.ok) {
            if (result.keptPrevious) {
              setVoteStatus(voteKey, "saved");
              setVoteKind(voteKey, savedKind);
            } else {
              setVoteStatus(voteKey, null);
              setVoteKind(voteKey, null);
              if (switching) forgetLikedTime(voteKey);
              resumeVoteTimer();
            }
            setError(result.error ?? "We couldn't save your vote. Please try again.");
            return;
          }

          setVoteStatus(voteKey, "saved");
          setSessionStudyStats((previousStats) => {
            const likedCaptionTimeMsByKey = { ...previousStats.likedCaptionTimeMsByKey };

            if (kind === "like") {
              likedCaptionTimeMsByKey[voteKey] = eventDetails.timeToVoteMs;
            } else {
              delete likedCaptionTimeMsByKey[voteKey];
            }

            return {
              likedCaptionTimeMsByKey,
              navigationTimeMsByKey: previousStats.navigationTimeMsByKey,
              viewedCaptionKeys: {
                ...previousStats.viewedCaptionKeys,
                [voteKey]: true,
              },
            };
          });
        })
        .catch((err) => {
          console.error("[CaptionVoteFlow] save vote failed", err);
          setVoteStatus(voteKey, null);
          setVoteKind(voteKey, null);
          if (switching) forgetLikedTime(voteKey);
          setError("We couldn't save your vote. Please try again.");
          resumeVoteTimer();
        })
        .finally(() => {
          setPendingCount((count) => Math.max(0, count - 1));
        });
    },
    [
      createVoteEventDetails,
      current,
      currentVoteKey,
      currentVoteStatus,
      forgetLikedTime,
      pauseVoteTimer,
      resetVoteTimer,
      resumeVoteTimer,
      setVoteKind,
      setVoteStatus,
      triggerReactionBurst,
      voteKinds,
    ]
  );

  const handleHeartVote = useCallback(() => castVote("like"), [castVote]);
  const handleDislikeVote = useCallback(() => castVote("dislike"), [castVote]);

  const handleCardDoubleTapHeart = useCallback(() => {
    if (
      !current ||
      !currentVoteKey ||
      currentVoteStatus === "saving" ||
      currentVoteStatus === "removing"
    ) {
      return;
    }

    handleHeartVote();
  }, [current, currentVoteKey, currentVoteStatus, handleHeartVote]);

  useEffect(() => {
    resetVoteTimer();
    resetNavigationTimer();
  }, [current?.id, resetNavigationTimer, resetVoteTimer]);

  useEffect(() => {
    if (isStartPageVisible) {
      pauseVoteTimer();
      pauseNavigationTimer();
      return;
    }

    syncVoteTimer();
    syncNavigationTimer();
  }, [
    isStartPageVisible,
    pauseNavigationTimer,
    pauseVoteTimer,
    syncNavigationTimer,
    syncVoteTimer,
  ]);

  useEffect(() => {
    if (
      isStartPageVisible ||
      !currentVoteKey ||
      isShowingCompletionPage
    ) {
      return;
    }

    setSessionStudyStats((previousStats) =>
      previousStats.viewedCaptionKeys[currentVoteKey]
        ? previousStats
        : {
            likedCaptionTimeMsByKey: previousStats.likedCaptionTimeMsByKey,
            navigationTimeMsByKey: previousStats.navigationTimeMsByKey,
            viewedCaptionKeys: {
              ...previousStats.viewedCaptionKeys,
              [currentVoteKey]: true,
            },
          }
    );
  }, [
    currentVoteKey,
    isStartPageVisible,
    isShowingCompletionPage,
  ]);

  useEffect(() => {
    if (
      nextCaptionOffset === null ||
      isLoadingMoreCaptions ||
      queue.length === 0
    ) {
      return;
    }

    const remainingCaptions = queue.length - currentIndex - 1;

    if (remainingCaptions > 12) {
      return;
    }

    void loadMoreCaptions(nextCaptionOffset);
  }, [
    currentIndex,
    isLoadingMoreCaptions,
    loadMoreCaptions,
    nextCaptionOffset,
    queue.length,
  ]);

  const syncTimers = useCallback(() => {
    syncVoteTimer();
    syncNavigationTimer();
  }, [syncNavigationTimer, syncVoteTimer]);

  useEffect(() => {
    syncTimers();

    document.addEventListener("visibilitychange", syncTimers);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchCancel, {
      passive: true,
    });
    window.addEventListener("wheel", handleWheelNavigation, { passive: false });
    window.addEventListener("keydown", handleKeyboardNavigation);
    window.addEventListener("focus", syncTimers);
    window.addEventListener("blur", syncTimers);

    return () => {
      document.removeEventListener("visibilitychange", syncTimers);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchCancel);
      window.removeEventListener("wheel", handleWheelNavigation);
      window.removeEventListener("keydown", handleKeyboardNavigation);
      window.removeEventListener("focus", syncTimers);
      window.removeEventListener("blur", syncTimers);
    };
  }, [
    handleKeyboardNavigation,
    handleTouchCancel,
    handleTouchEnd,
    handleTouchMove,
    handleTouchStart,
    handleWheelNavigation,
    syncTimers,
  ]);

  const errorReservePx = error ? (isShortViewport ? 104 : 88) : 0;

  if (!current && !isShowingCompletionPage) {
    return (
      <div
        id="vote-empty-state"
        className="glass-panel rounded-2xl border border-[var(--panel-border)] bg-[var(--surface-muted)] p-6 text-[var(--foreground)] shadow-inner"
      >
        <p className="text-lg font-semibold">You&apos;re all caught up</p>
        <p className="text-sm text-[var(--soft)]">
          We&apos;ll surface new in-study captions here as soon as they&apos;re
          ready.
        </p>
        {pendingCount > 0 ? (
          <p className="mt-3 text-xs text-[var(--soft)]">Saving your last vote...</p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      id="vote-flow-frame"
      className={`relative flex h-full min-h-0 w-full flex-1 self-stretch flex-col items-center text-center ${
        isShortViewport
          ? "justify-center gap-3 pt-6 sm:gap-4 sm:pt-6"
          : "justify-start gap-4 pt-2 sm:justify-center sm:gap-5 sm:pt-3"
      }`}
      style={{
        paddingBottom: `calc(${contentBottomPaddingPx}px + env(safe-area-inset-bottom, 0px))`,
        touchAction: isShowingCompletionPage ? "auto" : "pan-x",
      }}
    >
      {error ? (
        <p role="alert" className="relative z-10 w-full max-w-xl shrink-0 rounded-xl bg-[var(--error-bg)] px-4 py-3 text-sm font-semibold text-[var(--error-text)] ring-1 ring-[var(--error-border)]">
          {error}
        </p>
      ) : null}
      {participation?.ended_at ? (
        <CompletedStudy participation={participation} />
      ) : isStartPageVisible ? (
        <StudyStartPage onStart={handleStartStudy} pending={participationPending} hasStarted={Boolean(participation?.started_at)} />
      ) : isShowingCompletionPage ? (
        <StudyEndPage
          pendingCount={pendingCount}
          onEnd={handleEndStudy}
          ending={participationPending}
        />
      ) : (
        <>
          <div className="caption-flip-stage w-full">
            <div
              key={current.id}
              className={`caption-flip-card caption-flip-card--${captionFlipDirection} w-full`}
            >
              <SwipeVoteCard
                actionRow={
                  shouldShowInlineCaptionActions ? (
                    <CaptionActionRow
                      dislikeBurstToken={dislikeBurstToken}
                      hasCurrentDislike={hasCurrentDislike}
                      hasCurrentLike={hasCurrentLike}
                      isVotePending={isCurrentVoteSaving || isCurrentVoteRemoving}
                      likeBurstToken={likeBurstToken}
                      onDislike={handleDislikeVote}
                      onHeart={handleHeartVote}
                    />
                  ) : null
                }
                captionId={current.id}
                content={current.content}
                imageSrc={current.imageSrc}
                onDoubleTapHeart={handleCardDoubleTapHeart}
                preloadImageUrls={preloadImageUrls}
                reservedBottomPx={contentBottomPaddingPx}
                reservedTopPx={reservedTopPx + errorReservePx}
              />
            </div>
          </div>
          {shouldShowVoteBar ? (
            <VoteButtonBar
              captionProgressLabel={captionProgressLabel}
              dislikeBurstToken={dislikeBurstToken}
              hasCurrentDislike={hasCurrentDislike}
              hasCurrentLike={hasCurrentLike}
              isPending={isCurrentVoteSaving || isCurrentVoteRemoving}
              likeBurstToken={likeBurstToken}
              onDislike={handleDislikeVote}
              onHeart={handleHeartVote}
              showHeartFallback={shouldShowVoteBar}
            />
          ) : null}
        </>
      )}
      {shouldShowCaptionProgress && !shouldShowVoteBar && captionProgressLabel ? (
        <CaptionProgressIndicator label={captionProgressLabel} />
      ) : null}
      {isWheelNavigationOverlayVisible ? <WheelNavigationOverlay /> : null}
    </div>
  );
}

function StudyStartPage({ onStart, pending, hasStarted }: {
  onStart: () => void;
  pending: boolean;
  hasStarted: boolean;
}) {
  return (
    <div className="flex min-h-0 w-full max-w-xl flex-1 items-center sm:max-w-2xl">
      <div data-native-scroll-region="true" className="glass-panel relative max-h-full w-full overflow-y-auto overscroll-contain rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] p-6 text-left text-[var(--foreground)] shadow-[var(--vote-panel-shadow)] sm:p-8">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-20 top-8 h-36 w-36 rounded-full bg-amber-300/14 blur-3xl" />
          <div className="absolute right-0 bottom-0 h-44 w-44 translate-x-[20%] translate-y-[20%] rounded-full bg-yellow-200/12 blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />
        </div>
        <div className="relative flex flex-col gap-4 sm:gap-5">
          <h1 className="mb-2 text-center font-black uppercase tracking-[0.05em] text-[var(--foreground)] sm:mb-3">
            <span className="block text-2xl sm:text-3xl">Welcome To</span>
            <span className="mt-1 block whitespace-nowrap text-[clamp(1.1rem,6vw,2.5rem)] leading-none tracking-[0.03em] sm:text-4xl sm:tracking-[0.05em]">
              The Humor Study
              <span className="ml-0.5 inline-block align-super text-xs leading-none sm:ml-1 sm:text-lg">
                TM
              </span>
            </span>
          </h1>
          <p className="text-base leading-8 text-[var(--foreground)]/92 sm:text-lg">
            Like the captions you find funny and dislike the ones you don&apos;t.
          </p>
          <p className="text-base leading-8 text-[var(--foreground)]/92 sm:text-lg">
            That&apos;s it. That&apos;s all you have to do. Your pet keeps its HP when you
            like or dislike a caption, but loses some when you skip past too fast.
          </p>
          <p className="text-base leading-8 text-[var(--foreground)]/92 sm:text-lg">
            Scroll through all the captions, then choose End Study on the
            final page to save your completion and see your humor stats.
          </p>
          <button type="button" onClick={onStart} disabled={pending}
            className="mt-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-base font-semibold text-[var(--accent-contrast)] disabled:cursor-wait disabled:opacity-60">
            {pending ? "Starting…" : hasStarted ? "Continue Study" : "Start Study"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StudyEndPage({ pendingCount, onEnd, ending }: {
  pendingCount: number;
  onEnd: () => void;
  ending: boolean;
}) {
  return (
    <div className="flex min-h-0 w-full max-w-xl flex-1 items-center sm:max-w-2xl">
      <div data-native-scroll-region="true" className="glass-panel max-h-full w-full overflow-y-auto overscroll-contain rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] p-6 text-center shadow-[var(--vote-panel-shadow)] sm:p-8">
        <h1 className="text-2xl font-bold sm:text-3xl">You&apos;ve reached the end!</h1>
        <p className="mt-4 text-sm leading-6 text-[var(--soft)] sm:text-base">
          End the study to save your completion and see your humor stats.
        </p>
        {pendingCount > 0 ? (
          <p role="status" className="mt-4 text-sm text-[var(--soft)]">Saving your last vote…</p>
        ) : null}
        <button type="button" onClick={onEnd} disabled={ending || pendingCount > 0}
          className="mt-6 w-full rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-contrast)] disabled:cursor-wait disabled:opacity-60">
          {ending ? "Ending…" : "End Study"}
        </button>
      </div>
    </div>
  );
}

function WheelNavigationOverlay() {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
      <div className="absolute inset-0 bg-[var(--overlay)]/45 backdrop-blur-[6px]" />
      <div className="glass-panel relative rounded-2xl border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] px-5 py-4 text-[var(--foreground)] shadow-[var(--vote-panel-shadow)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--soft)]">
          Loading
        </p>
        <div className="mt-3 flex items-center justify-center gap-2" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)] animate-pulse" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]/80 animate-pulse [animation-delay:120ms]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]/60 animate-pulse [animation-delay:240ms]" />
        </div>
      </div>
    </div>,
    document.body
  );
}

/** One reaction button: a labelled heart (like) or thumbs-down (dislike). */
function ReactionButton({
  active,
  burstToken,
  isPending,
  kind,
  onPress,
  size = "bar",
}: {
  active: boolean;
  burstToken: number;
  isPending: boolean;
  kind: VoteKind;
  onPress: () => void;
  size?: "bar" | "inline";
}) {
  const isLike = kind === "like";
  const Icon = isLike
    ? active ? HeartSolidIcon : HeartOutlineIcon
    : active ? ThumbDownSolidIcon : ThumbDownOutlineIcon;
  const shouldBurst = active && burstToken > 0;
  const isInline = size === "inline";
  const name = isLike ? "heart" : "dislike";

  return (
    <button
      type="button"
      data-heart-vote-control
      className={`relative isolate flex flex-col items-center justify-center gap-0.5 rounded-2xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--accent-strong)] ${
        isInline ? "h-14 w-16" : "h-[4.25rem] w-[4.5rem] sm:h-[4.75rem] sm:w-20"
      } ${
        active
          ? isLike
            ? "text-[var(--heart-active)]"
            : "text-indigo-500"
          : "text-[var(--heart-idle)] hover:-translate-y-[1px] hover:scale-[1.02] hover:text-[var(--heart-hover)]"
      } ${isPending ? "cursor-wait opacity-80 hover:translate-y-0 hover:scale-100" : ""}`}
      aria-label={
        active
          ? isPending
            ? `Updating ${name} vote`
            : `Remove ${name} vote`
          : isPending
            ? `Saving ${name} vote`
            : isLike
              ? "Like this caption"
              : "Dislike this caption"
      }
      aria-pressed={active}
      disabled={isPending}
      onClick={onPress}
    >
      <span
        key={`${kind}-icon-${burstToken}`}
        className={`relative z-20 ${
          shouldBurst ? (isLike ? "heart-burst-icon" : "dislike-burst-icon") : ""
        }`}
      >
        <Icon
          className={`${isInline ? "h-6 w-6" : "h-7 w-7 sm:h-8 sm:w-8"} ${isPending ? "animate-pulse" : ""}`}
        />
      </span>
      <span className="relative z-20 text-[11px] font-semibold leading-none">
        {isLike ? "Like" : "Dislike"}
      </span>
      {shouldBurst ? <SmallReactionBurst key={`${kind}-burst-${burstToken}`} kind={kind} /> : null}
    </button>
  );
}

const REACTION_HINT =
  "Like or dislike each caption. Skipping past quickly without one costs your pet HP.";

function CaptionActionRow({
  dislikeBurstToken,
  hasCurrentDislike,
  hasCurrentLike,
  isVotePending,
  likeBurstToken,
  onDislike,
  onHeart,
}: {
  dislikeBurstToken: number;
  hasCurrentDislike: boolean;
  hasCurrentLike: boolean;
  isVotePending: boolean;
  likeBurstToken: number;
  onDislike: () => void;
  onHeart: () => void;
}) {
  return (
    <div className="flex w-full items-center justify-start gap-2">
      <ReactionButton
        kind="like"
        active={hasCurrentLike}
        burstToken={likeBurstToken}
        isPending={isVotePending}
        onPress={onHeart}
        size="inline"
      />
      <ReactionButton
        kind="dislike"
        active={hasCurrentDislike}
        burstToken={dislikeBurstToken}
        isPending={isVotePending}
        onPress={onDislike}
        size="inline"
      />
      <p className="min-w-0 flex-1 text-left text-xs leading-snug text-[var(--soft)]">{REACTION_HINT}</p>
    </div>
  );
}

function VoteButtonBar({
  captionProgressLabel,
  dislikeBurstToken,
  hasCurrentDislike,
  hasCurrentLike,
  isPending,
  likeBurstToken,
  onDislike,
  onHeart,
  showHeartFallback,
}: {
  captionProgressLabel: string | null;
  dislikeBurstToken: number;
  hasCurrentDislike: boolean;
  hasCurrentLike: boolean;
  isPending: boolean;
  likeBurstToken: number;
  onDislike: () => void;
  onHeart: () => void;
  showHeartFallback: boolean;
}) {
  return (
    <div
      id="vote-button-bar-shell"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-[var(--vote-bar-from)] via-[var(--vote-bar-via)] to-transparent px-4 pt-2 sm:px-5 sm:pt-3"
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
      }}
    >
      <div
        id="vote-button-bar-inner"
        className="mx-auto w-full max-w-xl px-4 sm:max-w-2xl sm:px-6 lg:max-w-3xl lg:px-0"
      >
        <div className="pointer-events-auto mx-auto flex w-full max-w-[260px] flex-col items-center gap-2 rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] px-4 py-3 shadow-[var(--vote-panel-shadow)] backdrop-blur-xl sm:px-5 sm:py-3.5">
          {captionProgressLabel ? (
            <p className="text-sm font-semibold tabular-nums text-[var(--foreground)]/88">
              {captionProgressLabel}
            </p>
          ) : null}
          {showHeartFallback ? (
            <>
              <div className="flex items-center gap-3">
                <ReactionButton
                  kind="like"
                  active={hasCurrentLike}
                  burstToken={likeBurstToken}
                  isPending={isPending}
                  onPress={onHeart}
                />
                <ReactionButton
                  kind="dislike"
                  active={hasCurrentDislike}
                  burstToken={dislikeBurstToken}
                  isPending={isPending}
                  onPress={onDislike}
                />
              </div>
              <p className="text-center text-[11px] leading-snug text-[var(--soft)]">{REACTION_HINT}</p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CaptionProgressIndicator({
  label,
}: {
  label: string;
}) {
  return (
    <div
      id="caption-progress-indicator"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4"
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
      }}
      aria-hidden
    >
      <div className="glass-panel rounded-full border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] px-4 py-2 shadow-[var(--vote-panel-shadow)] backdrop-blur-xl">
        <p className="text-sm font-semibold tabular-nums text-[var(--foreground)]/88">
          {label}
        </p>
      </div>
    </div>
  );
}

/**
 * The feedback when a reaction lands: a small ring and a few specks right around
 * the button, over in about half a second. Deliberately modest; it only has to
 * confirm the tap, and the pet's reaction does the rest.
 */
function SmallReactionBurst({ kind }: { kind: VoteKind }) {
  if (kind === "dislike") {
    return (
      <span aria-hidden className="pointer-events-none absolute inset-0 z-10">
        <span className="reaction-ring reaction-ring--dislike absolute left-1/2 top-1/2" />
      </span>
    );
  }

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-10">
      <span className="reaction-ring absolute left-1/2 top-1/2" />
      {HEART_BURST_PARTICLES.slice(0, 6).map((particle, index) => (
        <span
          key={index}
          className="reaction-speck absolute left-1/2 top-1/2"
          style={
            {
              "--speck-x": `${Math.round(particle.x * 0.36)}px`,
              "--speck-y": `${Math.round(particle.y * 0.36)}px`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
