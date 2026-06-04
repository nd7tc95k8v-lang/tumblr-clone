/**
 * Loads combined Notes (likes + reblogs + flat comment rows) for a post modal / diagnostics.
 *
 * ## Production semantics (unchanged contract)
 *
 * - **Likes:** always queried on the **thread root** (`threadRootPostId` argument) via
 *   `post_likes_list_for_thread_root`; like-shaped notes stamp `post_id` / `root_post_id` as that root.
 * - **Reblogs:** descendant rows where `posts.original_post_id` equals the normalized thread-root key; not anchor-scoped.
 * - **Note comments:** default path reads `post_note_comments` filtered by **`thread_root_post_id`** only.
 * - Totals helpers (`fetchPostNotesTotalCount`) follow the same root for like/reblog RPCs and thread-root comment counts.
 *
 * ## Anchor-scoped note comments (Phase 1 flag + legacy dev prototype)
 *
 * When {@link wantsAnchorScopedNoteComments} is true (`NEXT_PUBLIC_NOTES_COMMENT_SCOPE=anchor` + anchor id, or the
 * legacy dev prototype triple-gate), **only comment list / comment count** use migration **035** anchor RPCs.
 * **Likes and reblogs stay thread-root.**
 *
 * ## Missing migration 035 RPCs
 *
 * If PostgREST reports the anchor RPC missing (`PGRST202` / “unknown function”), we **fall back** to the same
 * thread-root comment SELECT / head count once per RPC name (dev `console.info`), preserving shipped behavior.
 */
import { wantsAnchorScopedNoteComments } from "@/lib/notes-comment-scope";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostNote } from "@/types/post-note";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const COMMENTARY_PREVIEW_MAX = 140;

const IS_DEV = process.env.NODE_ENV === "development";

/** How note **comment** rows / counts were resolved for a Notes fetch (development diagnostics only). */
export type NotesModalDevCommentReadSource =
  | "thread_root_default"
  | "anchor_rpc"
  | "anchor_fallback_thread_root";

/** One-time dev logs when anchor list/count RPCs are missing (migration 035 not applied). */
let devLoggedNotesAnchorListRpcFallback = false;
let devLoggedNotesAnchorCountRpcFallback = false;

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
// Notes query routing (implementation detail; mirrors module doc)
// ---------------------------------------------------------------------------
//
// Keep **likes + reblogs on thread root** in all environments. **Optional anchor scope applies only to
// comment reads** when `wantsAnchorScopedNoteComments` is true; otherwise every branch uses `threadRootNotesKey`.

/** Normalized thread-root id for like/reblog queries and the default comment path (shipped contract). */
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

function num(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function wantsAnchorCommentsForFetch(params: FetchPostNotesParams): boolean {
  return wantsAnchorScopedNoteComments({
    notesAnchorPostId: params.notesAnchorPostId,
    prototypeAnchorScopedComments: params.prototypeAnchorScopedComments,
  });
}

function wantsAnchorCommentsForTotals(options: FetchPostNotesTotalCountOptions | undefined): boolean {
  return wantsAnchorScopedNoteComments({
    notesAnchorPostId: options?.notesAnchorPostId,
    prototypeAnchorScopedComments: options?.prototypeAnchorScopedComments,
  });
}

function isMissingPostNoteCommentsListForAnchorRpc(err: { code?: string; message?: string }): boolean {
  const code = String(err.code ?? "");
  if (code === "PGRST202") return true;
  const msg = (err.message ?? "").toLowerCase();
  if (!msg.includes("post_note_comments_list_for_anchor")) return false;
  return (
    msg.includes("could not find") ||
    msg.includes("not found") ||
    msg.includes("does not exist") ||
    msg.includes("unknown function")
  );
}

function isMissingPostNoteCommentCountsByAnchorRpc(err: { code?: string; message?: string }): boolean {
  const code = String(err.code ?? "");
  if (code === "PGRST202") return true;
  const msg = (err.message ?? "").toLowerCase();
  if (!msg.includes("post_note_comment_counts_by_anchor")) return false;
  return (
    msg.includes("could not find") ||
    msg.includes("not found") ||
    msg.includes("does not exist") ||
    msg.includes("unknown function")
  );
}

function mapAnchorListRpcRowsToCommentNoteRows(
  rows: Array<{
    id: string;
    created_at: string;
    user_id: string;
    body: string;
    username: string | null;
    avatar_url: string | null;
  }>,
): CommentNoteRow[] {
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    user_id: r.user_id,
    body: r.body,
    author: { username: r.username, avatar_url: r.avatar_url },
  }));
}

/**
 * Fetches flat comment rows for the Notes modal. **Default:** `post_note_comments` by `thread_root_post_id`.
 * **Prototype:** tries `post_note_comments_list_for_anchor` when enabled; **on missing RPC** repeats the same
 * thread-root query (logged once in development) — no empty list / error surface unless the anchor call fails for other reasons.
 */
async function fetchCommentRowsForNotesModal(
  supabase: SupabaseClient,
  params: FetchPostNotesParams,
  threadRootNotesKey: string,
  limit: number,
): Promise<{
  data: CommentNoteRow[] | null;
  error: { message: string } | null;
  devCommentListSource?: NotesModalDevCommentReadSource;
}> {
  const threadSelect = supabase
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
    .limit(limit);

  if (!wantsAnchorCommentsForFetch(params)) {
    const res = await threadSelect;
    return {
      data: (res.data ?? []) as CommentNoteRow[],
      error: res.error ? { message: res.error.message } : null,
      ...(IS_DEV && !res.error ? { devCommentListSource: "thread_root_default" as const } : {}),
    };
  }

  const anchorKey = params.notesAnchorPostId!.trim();
  const rpc = await supabase.rpc("post_note_comments_list_for_anchor", {
    p_anchor_post_id: anchorKey,
    p_limit: limit,
  });

  if (!rpc.error) {
    const rows = (rpc.data ?? []) as Array<{
      id: string;
      created_at: string;
      user_id: string;
      body: string;
      username: string | null;
      avatar_url: string | null;
    }>;
    return {
      data: mapAnchorListRpcRowsToCommentNoteRows(rows),
      error: null,
      ...(IS_DEV ? { devCommentListSource: "anchor_rpc" as const } : {}),
    };
  }

  if (isMissingPostNoteCommentsListForAnchorRpc(rpc.error)) {
    if (!devLoggedNotesAnchorListRpcFallback) {
      devLoggedNotesAnchorListRpcFallback = true;
      console.info("[fetch-post-notes] post_note_comments_list_for_anchor unavailable; using thread-root comment list.");
    }
    const res = await threadSelect;
    return {
      data: (res.data ?? []) as CommentNoteRow[],
      error: res.error ? { message: res.error.message } : null,
      ...(IS_DEV && !res.error ? { devCommentListSource: "anchor_fallback_thread_root" as const } : {}),
    };
  }

  return { data: null, error: { message: rpc.error.message } };
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
   * **Shipped:** thread root for Notes (matches `threadRootPostId(post)` on the card). Likes/reblogs
   * always use this key.
   */
  threadRootPostId: string;
  /** Max combined items after merge (fetches up to this many from each source). Default 50, max 200. */
  limit?: number;
  /**
   * Authored-layer post id for **optional dev-only** anchor-scoped **comment** reads when
   * {@link FetchPostNotesParams.prototypeAnchorScopedComments} is true.
   */
  notesAnchorPostId?: string | null;
  /**
   * Legacy dev opt-in for anchor comment reads when `NEXT_PUBLIC_NOTES_ANCHOR_COMMENTS_PROTOTYPE=1`.
   * Prefer `NEXT_PUBLIC_NOTES_COMMENT_SCOPE=anchor` for production-capable anchor reads.
   */
  prototypeAnchorScopedComments?: boolean;
};

export type FetchPostNotesResult = {
  data: PostNote[] | null;
  error: { message: string } | null;
  /** Development only: comment list query path for this response. */
  devCommentListSource?: NotesModalDevCommentReadSource;
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
 * **Default (shipped):** thread-root comment query. **Anchor scope:** anchor-scoped comments only; likes/reblogs unchanged.
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
    return { data: [], error: null, ...(IS_DEV ? { devCommentListSource: "thread_root_default" as const } : {}) };
  }

  const [likesRes, reblogsRes, commentsPack] = await Promise.all([
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
    fetchCommentRowsForNotesModal(supabase, params, threadRootNotesKey, n),
  ]);

  if (likesRes.error) {
    return { data: null, error: { message: likesRes.error.message } };
  }
  if (reblogsRes.error) {
    return { data: null, error: { message: reblogsRes.error.message } };
  }
  if (commentsPack.error) {
    return { data: null, error: { message: commentsPack.error.message } };
  }

  const likeRows = (likesRes.data ?? []) as RpcLikeNoteRow[];
  const reblogRows = (reblogsRes.data ?? []) as ReblogNoteRow[];
  const commentRows = commentsPack.data ?? [];

  return {
    data: assembleMergedPostNotes(threadRootNotesKey, likeRows, reblogRows, commentRows, n),
    error: null,
    ...(IS_DEV && commentsPack.devCommentListSource
      ? { devCommentListSource: commentsPack.devCommentListSource }
      : {}),
  };
}

export type PostNotesTotalCountResult = {
  total: number;
  like_count: number;
  reblog_count: number;
  comment_count: number;
  error: { message: string } | null;
  /** Development only: comment count query path for this response. */
  devCommentCountSource?: NotesModalDevCommentReadSource;
  /**
   * Development + anchor prototype: thread-root comment head count for comparing to `comment_count`
   * when the latter comes from the anchor RPC (`devCommentCountSource === "anchor_rpc"`).
   */
  devThreadRootCommentCountForCompare?: number;
};

export type FetchPostNotesTotalCountOptions = {
  prototypeAnchorScopedComments?: boolean;
  notesAnchorPostId?: string | null;
};

/**
 * Comment head-count for totals. Mirrors `fetchCommentRowsForNotesModal`: thread-root head count unless the
 * dev prototype requests `post_note_comment_counts_by_anchor` and the RPC exists; otherwise falls back.
 */
async function resolveCommentCountForTotals(
  supabase: SupabaseClient,
  threadRootNotesKey: string,
  options?: FetchPostNotesTotalCountOptions,
): Promise<{
  comment_count: number;
  error: { message: string } | null;
  devCommentCountSource?: NotesModalDevCommentReadSource;
  devThreadRootCommentCountForCompare?: number;
}> {
  const threadHead = () =>
    supabase
      .from("post_note_comments")
      .select("id", { count: "exact", head: true })
      .eq("thread_root_post_id", threadRootNotesKey);

  if (!wantsAnchorCommentsForTotals(options)) {
    const res = await threadHead();
    return {
      comment_count: res.count ?? 0,
      error: res.error ? { message: res.error.message } : null,
      ...(IS_DEV && !res.error ? { devCommentCountSource: "thread_root_default" as const } : {}),
    };
  }

  let devThreadRootCommentCountForCompare: number | undefined;
  if (IS_DEV) {
    const tr = await threadHead();
    if (!tr.error) {
      devThreadRootCommentCountForCompare = tr.count ?? 0;
    }
  }

  const anchorKey = options!.notesAnchorPostId!.trim();
  const rpc = await supabase.rpc("post_note_comment_counts_by_anchor", { p_anchor_ids: [anchorKey] });

  if (!rpc.error) {
    const rows = (rpc.data ?? []) as Array<{ anchor_post_id?: string; comment_count?: number | string }>;
    const row = rows.find((r) => String(r.anchor_post_id) === anchorKey);
    return {
      comment_count: num(row?.comment_count),
      error: null,
      ...(IS_DEV ? { devCommentCountSource: "anchor_rpc" as const } : {}),
      ...(IS_DEV && typeof devThreadRootCommentCountForCompare === "number"
        ? { devThreadRootCommentCountForCompare }
        : {}),
    };
  }

  if (isMissingPostNoteCommentCountsByAnchorRpc(rpc.error)) {
    if (!devLoggedNotesAnchorCountRpcFallback) {
      devLoggedNotesAnchorCountRpcFallback = true;
      console.info("[fetch-post-notes] post_note_comment_counts_by_anchor unavailable; using thread-root comment count.");
    }
    const res = await threadHead();
    return {
      comment_count: res.count ?? 0,
      error: res.error ? { message: res.error.message } : null,
      ...(IS_DEV && !res.error ? { devCommentCountSource: "anchor_fallback_thread_root" as const } : {}),
    };
  }

  return { comment_count: 0, error: { message: rpc.error.message } };
}

/**
 * Thread-level total “notes” count: likes on the root + descendant reblog rows + note comments.
 * **Default:** thread-root comment head count. **Anchor scope:** anchor comment count only (likes/reblogs unchanged).
 */
export async function fetchPostNotesTotalCount(
  supabase: SupabaseClient,
  threadRootPostId: string,
  options?: FetchPostNotesTotalCountOptions,
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

  const [likesRes, reblogsRes, commentPack] = await Promise.all([
    supabase.rpc("post_like_counts", { p_post_ids: [threadRootNotesKey] }),
    supabase.rpc("post_reblog_counts_by_root", { p_root_ids: [threadRootNotesKey] }),
    resolveCommentCountForTotals(supabase, threadRootNotesKey, options),
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
  if (commentPack.error) {
    return {
      total: 0,
      like_count: 0,
      reblog_count: 0,
      comment_count: 0,
      error: { message: commentPack.error.message },
    };
  }

  const likeRow = (likesRes.data ?? [])[0] as { like_count?: number | string } | undefined;
  const reblogRow = (reblogsRes.data ?? [])[0] as { reblog_count?: number | string } | undefined;

  const like_count = num(likeRow?.like_count);
  const reblog_count = num(reblogRow?.reblog_count);
  const comment_count = commentPack.comment_count;

  return {
    total: like_count + reblog_count + comment_count,
    like_count,
    reblog_count,
    comment_count,
    error: null,
    ...(IS_DEV && commentPack.devCommentCountSource
      ? { devCommentCountSource: commentPack.devCommentCountSource }
      : {}),
    ...(IS_DEV && typeof commentPack.devThreadRootCommentCountForCompare === "number"
      ? { devThreadRootCommentCountForCompare: commentPack.devThreadRootCommentCountForCompare }
      : {}),
  };
}
