"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type UsePostLikeToggleParams = {
  supabase: SupabaseClient | null;
  currentUserId: string | null;
  /**
   * Thread root post id (`original_post_id` / chain root): `likes.post_id` must match this so the
   * control stays consistent with feed `liked_by_me` and aggregate `like_count` (see
   * `attachFeedPostEngagement` / `fetch-feed-posts`). A derived per-card helper `noteOwnerPostIdForCard`
   * exists in `@/lib/feed-post-display` for future per-reblog Notes/engagement but is not used here yet.
   */
  rootPostId: string;
  initialLiked: boolean;
  initialLikeCount: number;
};

export type UsePostLikeToggleResult = {
  liked: boolean;
  likeCount: number;
  likeBusy: boolean;
  likeError: string | null;
  dismissLikeError: () => void;
  toggleLike: () => Promise<void>;
};

/**
 * Optimistic like/unlike with in-flight guard, rollback on error, and non-negative counts.
 * Shipped behavior: likes target the **thread root** passed as `rootPostId` (matches server hydration).
 */
export function usePostLikeToggle({
  supabase,
  currentUserId,
  rootPostId,
  initialLiked,
  initialLikeCount,
}: UsePostLikeToggleParams): UsePostLikeToggleResult {
  const [likeBusy, setLikeBusy] = useState(false);
  const likeInFlightRef = useRef(false);
  const [likeCount, setLikeCount] = useState(() => Math.max(0, initialLikeCount));
  const [liked, setLiked] = useState(initialLiked);
  const [likeError, setLikeError] = useState<string | null>(null);

  const dismissLikeError = useCallback(() => setLikeError(null), []);

  useEffect(() => {
    setLikeCount(Math.max(0, initialLikeCount));
    setLiked(initialLiked);
    setLikeError(null);
  }, [rootPostId, initialLiked, initialLikeCount]);

  const toggleLike = useCallback(async () => {
    if (!supabase || !currentUserId || likeBusy || likeInFlightRef.current) return;

    likeInFlightRef.current = true;
    setLikeBusy(true);

    const nextLiked = !liked;
    const prevLiked = liked;
    const prevCount = Math.max(0, likeCount);
    setLiked(nextLiked);
    setLikeCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));

    try {
      if (nextLiked) {
        const { error } = await supabase.from("likes").insert({ post_id: rootPostId, user_id: currentUserId });
        if (error) {
          setLiked(prevLiked);
          setLikeCount(Math.max(0, prevCount));
          if (String(error.code) !== "23505") {
            setLikeError(error.message?.trim() || "Could not like this post.");
          }
        }
      } else {
        const { error } = await supabase
          .from("likes")
          .delete()
          .eq("post_id", rootPostId)
          .eq("user_id", currentUserId);
        if (error) {
          setLiked(prevLiked);
          setLikeCount(Math.max(0, prevCount));
          setLikeError(error.message?.trim() || "Could not remove like.");
        }
      }
    } finally {
      likeInFlightRef.current = false;
      setLikeBusy(false);
    }
  }, [supabase, currentUserId, rootPostId, liked, likeCount, likeBusy]);

  return { liked, likeCount, likeBusy, likeError, dismissLikeError, toggleLike };
}
