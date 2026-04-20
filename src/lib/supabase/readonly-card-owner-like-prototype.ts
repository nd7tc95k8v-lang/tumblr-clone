import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedPost } from "@/types/post";

function num(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

type LikeCountRow = { post_id: string; like_count: number | string };

/**
 * Read-only batch result for **likes keyed by `likes.post_id`**, using each row’s
 * `FeedPost.card_engagement_owner_post_id` (same values as `noteOwnerPostIdForCard` at hydrate).
 *
 * **Not imported by feed hydration, PostCard, or any shipped path** — for experiments that compare
 * thread-root engagement (`attachFeedPostEngagement`) vs “what counts would look like if likes targeted
 * the card owner post id,” without changing writes or UI.
 *
 * **Reblog / flat note-comment totals for the authored layer are not available through this module**
 * (see `IMPLEMENTATION.md` — “Card-level totals vs existing RPCs”).
 */
export type ReadonlyCardOwnerLikeProbe = {
  likeCountByCardOwnerPostId: ReadonlyMap<string, number>;
  /** Present when `viewerUserId` is non-empty: card-owner ids the viewer has liked. */
  viewerLikedCardOwnerPostIds: ReadonlySet<string> | null;
};

function distinctCardOwnerIds(posts: FeedPost[]): string[] {
  return [
    ...new Set(
      posts
        .map((p) => p.card_engagement_owner_post_id?.trim())
        .filter((id): id is string => id.length > 0),
    ),
  ];
}

/**
 * Batches `post_like_counts` and optionally `post_ids_liked_by_auth_user` over distinct
 * `card_engagement_owner_post_id` values. Semantics match those RPCs: per `likes.post_id`, not
 * thread aggregation.
 */
export async function fetchReadonlyPrototypeCardOwnerLikeProbe(
  supabase: SupabaseClient,
  posts: FeedPost[],
  viewerUserId: string | null | undefined,
): Promise<ReadonlyCardOwnerLikeProbe> {
  const ids = distinctCardOwnerIds(posts);

  if (ids.length === 0) {
    return { likeCountByCardOwnerPostId: new Map(), viewerLikedCardOwnerPostIds: null };
  }

  const { data: likeRows, error: likeErr } = await supabase.rpc("post_like_counts", { p_post_ids: ids });
  if (likeErr) {
    console.error(likeErr);
    return { likeCountByCardOwnerPostId: new Map(), viewerLikedCardOwnerPostIds: null };
  }

  const likeCountByCardOwnerPostId = new Map<string, number>();
  for (const row of (likeRows ?? []) as LikeCountRow[]) {
    likeCountByCardOwnerPostId.set(String(row.post_id), num(row.like_count));
  }

  const uid = viewerUserId?.trim();
  if (!uid) {
    return { likeCountByCardOwnerPostId, viewerLikedCardOwnerPostIds: null };
  }

  const { data: likedArr, error: likedErr } = await supabase.rpc("post_ids_liked_by_auth_user", {
    p_post_ids: ids,
  });
  if (likedErr) {
    console.error(likedErr);
    return { likeCountByCardOwnerPostId, viewerLikedCardOwnerPostIds: null };
  }

  const viewerLikedCardOwnerPostIds = new Set<string>(
    Array.isArray(likedArr) ? likedArr.map((id) => String(id)) : [],
  );
  return { likeCountByCardOwnerPostId, viewerLikedCardOwnerPostIds };
}
