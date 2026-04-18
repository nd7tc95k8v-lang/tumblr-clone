import type { SupabaseClient } from "@supabase/supabase-js";
import { threadRootPostId } from "@/lib/post-thread-root";
import type { FeedPost } from "@/types/post";

/** Row shape from `public.post_like_counts` (likes keyed by `likes.post_id`). */
type LikeCountRow = { post_id: string; like_count: number | string };
type ReblogCountRow = { root_id: string; reblog_count: number | string };
type NoteCommentCountRow = { root_id: string; comment_count: number | string };

function num(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Merge like/reblog counts and `liked_by_me` for feed rows.
 *
 * Thread model: `original_post_id` is the thread root. Client likes target that root
 * (`usePostLikeToggle`), so we pass **distinct root ids** into:
 * - `post_like_counts` — counts rows in `likes` where `post_id` is each root (thread total).
 * - `post_ids_liked_by_auth_user` — which of those roots the viewer has liked.
 * - `post_reblog_counts_by_root` — reblogs in the chain (rows with that `original_post_id`, excluding root).
 * - `post_note_comment_counts_by_root` — short note comments on each thread root.
 */
export async function attachFeedPostEngagement(
  supabase: SupabaseClient,
  posts: FeedPost[],
  viewerUserId: string | null | undefined,
): Promise<FeedPost[]> {
  if (posts.length === 0) return posts;

  const rootIds = [
    ...new Set(
      posts
        .map((p) => threadRootPostId(p))
        .filter((id): id is string => id.trim().length > 0),
    ),
  ];

  const [likesRes, reblogsRes, noteCommentsRes] = await Promise.all([
    rootIds.length > 0
      ? supabase.rpc("post_like_counts", { p_post_ids: rootIds })
      : Promise.resolve({ data: [] as LikeCountRow[], error: null }),
    rootIds.length > 0
      ? supabase.rpc("post_reblog_counts_by_root", { p_root_ids: rootIds })
      : Promise.resolve({ data: [] as ReblogCountRow[], error: null }),
    rootIds.length > 0
      ? supabase.rpc("post_note_comment_counts_by_root", { p_root_ids: rootIds })
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

  if (process.env.NODE_ENV === "development" && rootIds.length > 0) {
    console.debug("[feed-engagement] post_reblog_counts_by_root p_root_ids", rootIds);
    console.debug("[feed-engagement] post_reblog_counts_by_root rows", reblogsRes.data);
    for (const p of posts.slice(0, 5)) {
      const root = threadRootPostId(p);
      console.debug(
        "[feed-engagement] post",
        p.id,
        "threadRootPostId",
        root,
        "merged reblog_count",
        reblogMap.get(root) ?? 0,
      );
    }
  }

  let likedRootIds = new Set<string>();
  if (viewerUserId && rootIds.length > 0) {
    const { data: likedArr, error } = await supabase.rpc("post_ids_liked_by_auth_user", {
      p_post_ids: rootIds,
    });
    if (error) {
      console.error(error);
    } else if (Array.isArray(likedArr)) {
      likedRootIds = new Set(likedArr.map((id) => String(id)));
    }
  }

  return posts.map((p) => {
    const root = threadRootPostId(p);
    return {
      ...p,
      original_post_id: root,
      like_count: likeMap.get(root) ?? 0,
      reblog_count: reblogMap.get(root) ?? 0,
      note_comment_count: noteCommentMap.get(root) ?? 0,
      liked_by_me: likedRootIds.has(root),
    };
  });
}
