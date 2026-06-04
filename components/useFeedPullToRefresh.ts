"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Must be at (or near) document top to begin a pull. */
const SCROLL_TOP_MAX_PX = 8;

/** Pull distance required to trigger refresh on release. */
export const PULL_REFRESH_THRESHOLD_PX = 72;

/** Rubber-band cap while dragging. */
const MAX_PULL_PX = 128;

/** Minimum vertical movement before pull gesture commits (avoids stealing horizontal swipes). */
const PULL_COMMIT_MIN_PX = 10;

/** Horizontal movement above this with dominant X axis cancels pull tracking. */
const AXIS_LOCK_MIN_PX = 8;

/** Drag distance multiplier (feels less stiff than 1:1). */
const PULL_DAMPING = 0.5;

/**
 * Document-level pull-to-refresh for mobile feed surfaces.
 * Listens on `document` because feeds scroll with the page, not an inner container.
 */
export function useFeedPullToRefresh(onRefresh?: () => void | Promise<void>) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isTouching, setIsTouching] = useState(false);
  const [mobileEnabled, setMobileEnabled] = useState(false);

  const refreshingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  pullDistanceRef.current = pullDistance;

  useEffect(() => {
    if (!onRefresh) return;
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobileEnabled(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [onRefresh]);

  const runRefresh = useCallback(async () => {
    if (!onRefresh || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setPullDistance(PULL_REFRESH_THRESHOLD_PX);
    try {
      await onRefresh();
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      setPullDistance(0);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!onRefresh || !mobileEnabled) return;

    let startY = 0;
    let startX = 0;
    let tracking = false;
    let pullCommitted = false;

    const cancelTracking = () => {
      tracking = false;
      pullCommitted = false;
      setIsTouching(false);
      if (!refreshingRef.current) setPullDistance(0);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (window.scrollY > SCROLL_TOP_MAX_PX) {
        tracking = false;
        pullCommitted = false;
        return;
      }
      if (e.touches.length !== 1) return;
      startY = e.touches[0]!.clientY;
      startX = e.touches[0]!.clientX;
      tracking = true;
      pullCommitted = false;
      setIsTouching(true);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || refreshingRef.current) return;
      if (window.scrollY > SCROLL_TOP_MAX_PX) {
        cancelTracking();
        return;
      }

      const deltaY = e.touches[0]!.clientY - startY;
      const deltaX = e.touches[0]!.clientX - startX;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (!pullCommitted) {
        if (absX >= AXIS_LOCK_MIN_PX && absX > absY) {
          cancelTracking();
          return;
        }
        if (deltaY <= 0) {
          setPullDistance(0);
          return;
        }
        if (absY < PULL_COMMIT_MIN_PX || absY < absX) {
          return;
        }
        pullCommitted = true;
      }

      if (deltaY <= 0) {
        setPullDistance(0);
        return;
      }

      const pull = Math.min(deltaY * PULL_DAMPING, MAX_PULL_PX);
      setPullDistance(pull);
      if (pullCommitted && pull > 0 && window.scrollY <= 0) {
        e.preventDefault();
      }
    };

    const onTouchEnd = () => {
      if (!tracking) return;
      tracking = false;
      pullCommitted = false;
      setIsTouching(false);
      if (refreshingRef.current) return;
      if (pullDistanceRef.current >= PULL_REFRESH_THRESHOLD_PX) {
        void runRefresh();
      } else {
        setPullDistance(0);
      }
    };

    const onTouchCancel = () => {
      pullCommitted = false;
      cancelTracking();
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [onRefresh, mobileEnabled, runRefresh]);

  const active = mobileEnabled && Boolean(onRefresh);
  const indicatorHeight = refreshing ? PULL_REFRESH_THRESHOLD_PX : pullDistance;
  const readyToRefresh = pullDistance >= PULL_REFRESH_THRESHOLD_PX;

  return {
    active,
    pullDistance,
    indicatorHeight,
    refreshing,
    isTouching,
    readyToRefresh,
  };
}
