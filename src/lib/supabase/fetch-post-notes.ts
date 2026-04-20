import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostNote } from "@/types/post-note";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const COMMENTARY_PREVIEW_MAX = 140;

type RpcLikeNoteRow = {
  user_id: string;
  acted_at: string;
  username: string | null;
  avatar_url: string | null;
};

type ReblogNoteRow = {
  id: string;
  created_at: string;
  user_id: string;
  reblog_commentary: string | null;
  author:
    | { username: string | null; avatar_url: string | null }
    | { username: string | null; avatar_url: string | null }[]
    | null;
};

type CommentNoteRow = {
  id: string;
  created_at: string;
  user_id: string;
  body: string;
  author:
    | { username: string | null; avatar_url: string | null }
    | { username: string | null; avatar_url: string | null }[]
    | null;
};

// ---------------------------------------------------------------------------
// Notes query ownership (thread root vs future per-card)
// ---------------------------------------------------------------------------
//
// **Shipped:** list + totals RPCs/queries key off the **thread root** (same id as `PostNotesModal`’s
// `threadRootPostId` prop and feed engagement thread scope).
//
// **Future:** per-reblog / authored-layer Notes may key off `FeedPost.card_engagement_owner_post_id` /
// `noteOwnerPostIdForCard` — add a parallel query key path then; do not overload thread root until RPCs
// and `post_note_comments.thread_root_post_id` semantics are decided.

/** Normalized thread-root id used for all current Notes fetches (unchanged contract). */
function notesThreadRootQueryKey(raw: string | undefined): string {
  return raw?.trim() ?? "";
}

function clampLimit(limit?: number): number {
  if (limit === undefined || limit === null || Number.isNaN(limit)) return DEFAULT_LIMIT;
  const n = Math.floor(limit);
  if (n <= 0) return 0;
  return Math.min(n, MAX_LIMIT);
}

function unwrapAuthor(
  author: ReblogNoteRow["author"],
): { username: string | null; avatar_url: string | null } | null {
  if (author == null) return null;
  return Array.isArray(author) ? (author[0] ?? null) : author;
}

function truncatePreview(raw: string, max: number): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}…`;
}

/** Higher = sort earlier when timestamps tie (surface more “social” notes). */
function noteRank(n: PostNote): number {
  if (n.kind === "reblog" && n.has_commentary) return 3;
  if (n.kind === "reblog") return 2;
  if (n.kind === "comment") return 1;
  return 0;
}

function compareNotes(a: PostNote, b: PostNote): number {
  const tb = new Date(b.acted_at).getTime();
  const ta = new Date(a.acted_at).getTime();
  if (tb !== ta) return tb - ta;
  const r = noteRank(b) - noteRank(a);
  if (r !== 0) return r;
  if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
  if (a.user_id !== b.user_id) return a.user_id < b.user_id ? -1 : 1;
  return a.post_id < b.post_id ? -1 : a.post_id > b.post_id ? 1 : 0;
}

export type FetchPostNotesParams = {
  /**
   * **Shipped:** thread root for Notes (matches `threadRootPostId(post)` on the card).
   * Future: optional second param or overload may accept card/authored-layer id — same prep seam as
   * `feed-engagement.ts` (`engagementKeyForBatchAndMerge` vs thread identity).
   */
  threadRootPostId: string;
  /** Max combined items after merge (fetches up to this many from each source). Default 50, max 200. */
  limit?: number;
};

export type FetchPostNotesResult = {
  data: PostNote[] | null;
  error: { message: string } | null;
};

/**
 * Merge like rows, reblog rows, and comment rows into one reverse-chronological list (trimmed to limit).
 * `threadRootNotesKey` is the root id stamped on like/comment-shaped notes and `root_post_id` on all.
 */
function assembleMergedPostNotes(
  threadRootNotesKey: string,
  likeRows: RpcLikeNoteRow[],
  reblogRows: ReblogNoteRow[],
  commentRows: CommentNoteRow[],
  maxItems: number,
): PostNote[] {
  const notes: PostNote[] = [];

  for (const row of likeRows) {
    notes.push({
      kind: "like",
      acted_at: row.acted_at,
      user_id: row.user_id,
      username: row.username ?? null,
      avatar_url: row.avatar_url ?? null,
      post_id: threadRootNotesKey,
      root_post_id: threadRootNotesKey,
    });
  }

  for (const row of reblogRows) {
    const au = unwrapAuthor(row.author);
    const commentary = row.reblog_commentary?.trim() ?? "";
    const hasCommentary = commentary.length > 0;
    notes.push({
      kind: "reblog",
      acted_at: row.created_at,
      user_id: row.user_id,
      username: au?.username ?? null,
      avatar_url: au?.avatar_url ?? null,
      post_id: row.id,
      root_post_id: threadRootNotesKey,
      has_commentary: hasCommentary,
      commentary_preview: hasCommentary ? truncatePreview(commentary, COMMENTARY_PREVIEW_MAX) : null,
    });
  }

  for (const row of commentRows) {
    const au = unwrapAuthor(row.author);
    notes.push({
      kind: "comment",
      acted_at: row.created_at,
      user_id: row.user_id,
      username: au?.username ?? null,
      avatar_url: au?.avatar_url ?? null,
      post_id: threadRootNotesKey,
      root_post_id: threadRootNotesKey,
      body: row.body,
      comment_id: row.id,
    });
  }

  notes.sort(compareNotes);
  return notes.slice(0, maxItems);
}

/**
 * Combined reverse-chronological notes (likes on the root + reblog rows + flat note comments).
 * **Shipped:** all queries/RPCs use {@link notesThreadRootQueryKey} only — same behavior as before refactor.
 */
export async function fetchPostNotes(
  supabase: SupabaseClient,
  params: FetchPostNotesParams,
): Promise<FetchPostNotesResult> {
  const threadRootNotesKey = notesThreadRootQueryKey(params.threadRootPostId);
  if (!threadRootNotesKey) {
    return { data: null, error: { message: "threadRootPostId is required" } };
  }

  const n = clampLimit(params.limit);
  if (n === 0) {
    return { data: [], error: null };
  }

  const [likesRes, reblogsRes, commentsRes] = await Promise.all([
    supabase.rpc("post_likes_list_for_thread_root", {
      p_root_post_id: threadRootNotesKey,
      p_limit: n,
    }),
    supabase
      .from("posts")
      .select(
        `
        id,
        created_at,
        user_id,
        reblog_commentary,
        author:profiles!posts_user_id_fkey ( username, avatar_url )
      `,
      )
      .eq("original_post_id", threadRootNotesKey)
      .neq("id", threadRootNotesKey)
      .order("created_at", { ascending: false })
      .limit(n),
    supabase
      .from("post_note_comments")
      .select(
        `
        id,
        created_at,
        user_id,
        body,
        author:profiles!post_note_comments_user_id_fkey ( username, avatar_url )
      `,
      )
      .eq("thread_root_post_id", threadRootNotesKey)
      .order("created_at", { ascending: false })
      .limit(n),
  ]);

  if (likesRes.error) {
    return { data: null, error: { message: likesRes.error.message } };
  }
  if (reblogsRes.error) {
    return { data: null, error: { message: reblogsRes.error.message } };
  }
  if (commentsRes.error) {
    return { data: null, error: { message: commentsRes.error.message } };
  }

  const likeRows = (likesRes.data ?? []) as RpcLikeNoteRow[];
  const reblogRows = (reblogsRes.data ?? []) as ReblogNoteRow[];
  const commentRows = (commentsRes.data ?? []) as CommentNoteRow[];

  return {
    data: assembleMergedPostNotes(threadRootNotesKey, likeRows, reblogRows, commentRows, n),
    error: null,
  };
}

export type PostNotesTotalCountResult = {
  total: number;
  like_count: number;
  reblog_count: number;
  comment_count: number;
  error: { message: string } | null;
};

/**
 * Thread-level total “notes” count: likes on the root + descendant reblog rows + note comments.
 * Uses the same like/reblog RPCs as `src/lib/supabase/feed-engagement.ts`, plus a head count on `post_note_comments`.
 * **Shipped:** keyed only by {@link notesThreadRootQueryKey}.
 */
export async function fetchPostNotesTotalCount(
  supabase: SupabaseClient,
  threadRootPostId: string,
): Promise<PostNotesTotalCountResult> {
  const threadRootNotesKey = notesThreadRootQueryKey(threadRootPostId);
  if (!threadRootNotesKey) {
    return {
      total: 0,
      like_count: 0,
      reblog_count: 0,
      comment_count: 0,
      error: { message: "threadRootPostId is required" },
    };
  }

  const [likesRes, reblogsRes, commentsRes] = await Promise.all([
    supabase.rpc("post_like_counts", { p_post_ids: [threadRootNotesKey] }),
    supabase.rpc("post_reblog_counts_by_root", { p_root_ids: [threadRootNotesKey] }),
    supabase
      .from("post_note_comments")
      .select("id", { count: "exact", head: true })
      .eq("thread_root_post_id", threadRootNotesKey),
  ]);

  if (likesRes.error) {
    return {
      total: 0,
      like_count: 0,
      reblog_count: 0,
      comment_count: 0,
      error: { message: likesRes.error.message },
    };
  }
  if (reblogsRes.error) {
    return {
      total: 0,
      like_count: 0,
      reblog_count: 0,
      comment_count: 0,
      error: { message: reblogsRes.error.message },
    };
  }
  if (commentsRes.error) {
    return {
      total: 0,
      like_count: 0,
      reblog_count: 0,
      comment_count: 0,
      error: { message: commentsRes.error.message },
    };
  }

  const likeRow = (likesRes.data ?? [])[0] as { like_count?: number | string } | undefined;
  const reblogRow = (reblogsRes.data ?? [])[0] as { reblog_count?: number | string } | undefined;

  const num = (v: number | string | undefined) => {
    if (v === undefined || v === null) return 0;
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : 0;
  };

  const like_count = num(likeRow?.like_count);
  const reblog_count = num(reblogRow?.reblog_count);
  const comment_count = commentsRes.count ?? 0;

  return {
    total: like_count + reblog_count + comment_count,
    like_count,
    reblog_count,
    comment_count,
    error: null,
  };
}
