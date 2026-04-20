import type { SupabaseClient } from "@supabase/supabase-js";
import { threadRootPostId } from "@/lib/post-thread-root";
import type { FeedPost } from "@/types/post";
import { fetchReadonlyAnchorNoteCommentCountProbe } from "@/lib/supabase/readonly-anchor-note-comment-count-probe";

/** Row shape from `public.post_like_counts` (likes keyed by `likes.post_id`). */
type LikeCountRow = { post_id: string; like_count: number | string };
type ReblogCountRow = { root_id: string; reblog_count: number | string };
type NoteCommentCountRow = { root_id: string; comment_count: number | string };

function num(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Engagement id sources (thread root vs per-card owner)
// ---------------------------------------------------------------------------
//
// Shipped behavior batches and merges on the **thread root** so `like_count`, `liked_by_me`,
// `reblog_count`, and `note_comment_count` match `usePostLikeToggle` / `PostNotesModal` (thread scope).
//
// Future migration: batch `post_like_counts` / `post_ids_liked_by_auth_user` (and related RPCs) on
// per-card ids, then change `engagementKeyForBatchAndMerge` to delegate to `engagementKeyCardOwner`.
// Thread-root `original_post_id` stays under `applyThreadRootOriginalPostId` — engagement keys can
// diverge without overloading chain-structure fields.
//
// **Read-only card-owner like probe (unwired):** `fetchReadonlyPrototypeCardOwnerLikeProbe` in
// `readonly-card-owner-like-prototype.ts` — same two RPCs, batched on `card_engagement_owner_post_id`
// for diff vs thread-root maps; see IMPLEMENTATION.md for which totals cannot use existing RPCs.

/** **Shipped:** chain root id — same as `threadRootPostId` / thread-level RPC semantics. */
function engagementKeyThreadRoot(p: FeedPost): string {
  return threadRootPostId(p);
}

/**
 * **Future target:** authored-layer / per-card id from hydrate (`noteOwnerPostIdForCard`).
 * Not used for RPC batching or merge yet.
 */
function engagementKeyCardOwner(p: FeedPost): string {
  return p.card_engagement_owner_post_id;
}

/**
 * **Active batch + merge key** — today equals thread root. Single place to swap for per-card RPCs.
 */
function engagementKeyForBatchAndMerge(p: FeedPost): string {
  return engagementKeyThreadRoot(p);
}

function distinctNonEmptyIds(posts: FeedPost[], keyFn: (p: FeedPost) => string): string[] {
  return [
    ...new Set(
      posts
        .map(keyFn)
        .filter((id): id is string => id.trim().length > 0),
    ),
  ];
}

/**
 * Merge **engagement-only** fields (`like_count`, `reblog_count`, `note_comment_count`, `liked_by_me`)
 * from RPC maps using the active engagement batch key (shipped: thread root).
 * Does **not** set `original_post_id` — that is thread-structure data; see {@link applyThreadRootOriginalPostId}.
 */
function mergeEngagementCountsOntoPost(
  p: FeedPost,
  engagementLookupKey: string,
  likeMap: Map<string, number>,
  reblogMap: Map<string, number>,
  noteCommentMap: Map<string, number>,
  likedBatchKeys: Set<string>,
): FeedPost {
  return {
    ...p,
    like_count: likeMap.get(engagementLookupKey) ?? 0,
    reblog_count: reblogMap.get(engagementLookupKey) ?? 0,
    note_comment_count: noteCommentMap.get(engagementLookupKey) ?? 0,
    liked_by_me: likedBatchKeys.has(engagementLookupKey),
  };
}

/**
 * Normalize **thread-root chain identity** on the row (`original_post_id` = `threadRootPostId`).
 * Intentionally separate from engagement map merge so per-card engagement can later use a different
 * lookup key without conflating chain structure with like/reblog/note totals.
 */
function applyThreadRootOriginalPostId(row: FeedPost): FeedPost {
  const threadRoot = threadRootPostId(row);
  return { ...row, original_post_id: threadRoot };
}

const DEV_ANCHOR_NOTE_MISMATCH_LOG_CAP = 8;

/** Avoid spamming dev consoles when migration 035 is not applied. */
let devLoggedAnchorNoteCommentProbeUnsupported = false;

/**
 * Dev-only: attaches **`anchor_note_comment_count`** when the anchor probe succeeds; logs thread vs anchor
 * mismatches. Returns the same rows unchanged if the probe is unsupported / errors. Production no-op caller.
 */
async function devAugmentAnchorNoteCommentCountsAndLog(
  supabase: SupabaseClient,
  mergedPosts: FeedPost[],
): Promise<FeedPost[]> {
  const probe = await fetchReadonlyAnchorNoteCommentCountProbe(supabase, mergedPosts);
  if (probe.status === "unsupported") {
    if (!devLoggedAnchorNoteCommentProbeUnsupported) {
      devLoggedAnchorNoteCommentProbeUnsupported = true;
      console.info("[feed-engagement] anchor note-comment probe unsupported (migration 035 / RPC); skipping diff.");
    }
    return mergedPosts;
  }
  if (probe.status === "rpc_error") {
    return mergedPosts;
  }

  const byAnchor = probe.commentCountByAnchorPostId;
  const augmented: FeedPost[] = mergedPosts.map((p) => {
    const anchorId = p.card_engagement_owner_post_id?.trim() ?? "";
    if (!anchorId) return { ...p };
    const anchorN = byAnchor.get(anchorId) ?? 0;
    return { ...p, anchor_note_comment_count: anchorN };
  });

  const mismatches: { postId: string; anchorId: string; thread: number; anchor: number }[] = [];
  for (const p of augmented) {
    const anchorId = p.card_engagement_owner_post_id?.trim() ?? "";
    if (!anchorId) continue;
    const thread = p.note_comment_count;
    const anchor = p.anchor_note_comment_count ?? 0;
    if (thread !== anchor) {
      mismatches.push({ postId: p.id, anchorId, thread, anchor });
    }
  }
  if (mismatches.length > 0) {
    const shown = mismatches.slice(0, DEV_ANCHOR_NOTE_MISMATCH_LOG_CAP);
    const more = mismatches.length - shown.length;
    console.info(
      `[feed-engagement] note_comment_count thread≠anchor: ${mismatches.length} row(s)`,
      shown,
      more > 0 ? `…+${more} more` : "",
    );
  }

  return augmented;
}

/**
 * Merge like/reblog counts and `liked_by_me` for feed rows.
 *
 * **Shipped:** batches distinct **thread-root** ids into:
 * - `post_like_counts` — counts `likes` where `post_id` is each root.
 * - `post_ids_liked_by_auth_user` — which roots the viewer liked.
 * - `post_reblog_counts_by_root` — descendant posts per root.
 * - `post_note_comment_counts_by_root` — note comments per root.
 *
 * **Future:** switch {@link engagementKeyForBatchAndMerge} to use {@link engagementKeyCardOwner}
 * (and adjust RPCs) for per-reblog engagement; keep {@link applyThreadRootOriginalPostId} unless
 * chain identity storage changes.
 */
export async function attachFeedPostEngagement(
  supabase: SupabaseClient,
  posts: FeedPost[],
  viewerUserId: string | null | undefined,
): Promise<FeedPost[]> {
  if (posts.length === 0) return posts;

  const batchIds = distinctNonEmptyIds(posts, engagementKeyForBatchAndMerge);

  const [likesRes, reblogsRes, noteCommentsRes] = await Promise.all([
    batchIds.length > 0
      ? supabase.rpc("post_like_counts", { p_post_ids: batchIds })
      : Promise.resolve({ data: [] as LikeCountRow[], error: null }),
    batchIds.length > 0
      ? supabase.rpc("post_reblog_counts_by_root", { p_root_ids: batchIds })
      : Promise.resolve({ data: [] as ReblogCountRow[], error: null }),
    batchIds.length > 0
      ? supabase.rpc("post_note_comment_counts_by_root", { p_root_ids: batchIds })
      : Promise.resolve({ data: [] as NoteCommentCountRow[], error: null }),
  ]);

  if (likesRes.error) {
    console.error(likesRes.error);
  }
  if (reblogsRes.error) {
    console.error(reblogsRes.error);
  }
  if (noteCommentsRes.error) {
    console.error(noteCommentsRes.error);
  }

  const likeMap = new Map<string, number>();
  for (const row of (likesRes.data ?? []) as LikeCountRow[]) {
    likeMap.set(row.post_id, num(row.like_count));
  }

  const reblogMap = new Map<string, number>();
  for (const row of (reblogsRes.data ?? []) as ReblogCountRow[]) {
    reblogMap.set(row.root_id, num(row.reblog_count));
  }

  const noteCommentMap = new Map<string, number>();
  for (const row of (noteCommentsRes.data ?? []) as NoteCommentCountRow[]) {
    noteCommentMap.set(row.root_id, num(row.comment_count));
  }

  if (process.env.NODE_ENV === "development" && batchIds.length > 0) {
    console.debug("[feed-engagement] post_reblog_counts_by_root p_root_ids", batchIds);
    console.debug("[feed-engagement] post_reblog_counts_by_root rows", reblogsRes.data);
    for (const p of posts.slice(0, 5)) {
      const mergeKey = engagementKeyForBatchAndMerge(p);
      console.debug(
        "[feed-engagement] post",
        p.id,
        "engagementMergeKey",
        mergeKey,
        "merged reblog_count",
        reblogMap.get(mergeKey) ?? 0,
      );
    }
  }

  let likedBatchKeys = new Set<string>();
  if (viewerUserId && batchIds.length > 0) {
    const { data: likedArr, error } = await supabase.rpc("post_ids_liked_by_auth_user", {
      p_post_ids: batchIds,
    });
    if (error) {
      console.error(error);
    } else if (Array.isArray(likedArr)) {
      likedBatchKeys = new Set(likedArr.map((id) => String(id)));
    }
  }

  const merged = posts.map((p) => {
    const engagementLookupKey = engagementKeyForBatchAndMerge(p);
    const withEngagement = mergeEngagementCountsOntoPost(
      p,
      engagementLookupKey,
      likeMap,
      reblogMap,
      noteCommentMap,
      likedBatchKeys,
    );
    return applyThreadRootOriginalPostId(withEngagement);
  });

  if (process.env.NODE_ENV === "development" && merged.length > 0) {
    try {
      return await devAugmentAnchorNoteCommentCountsAndLog(supabase, merged);
    } catch (e) {
      console.warn("[feed-engagement] dev anchor note-comment augment skipped:", e);
    }
  }

  return merged;
}
