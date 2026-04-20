import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedPost } from "@/types/post";

function num(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

type AnchorCountRow = { anchor_post_id: string; comment_count: number | string };

/** Present when {@link ReadonlyAnchorNoteCommentCountProbe.status} is `"unsupported"`. */
export type AnchorNoteCommentCountProbeUnsupportedReason = "rpc_not_available";

/**
 * Result of {@link fetchReadonlyAnchorNoteCommentCountProbe}. Never throws.
 *
 * **`attachFeedPostEngagement`** imports this **only in development** to set **`anchor_note_comment_count`**
 * on hydrated posts when the RPC succeeds. **`note_comment_count`** / shipped UI stay thread-root in all envs.
 */
export type ReadonlyAnchorNoteCommentCountProbe =
  | {
      status: "ok";
      commentCountByAnchorPostId: ReadonlyMap<string, number>;
    }
  | {
      status: "unsupported";
      unsupportedReason: AnchorNoteCommentCountProbeUnsupportedReason;
      commentCountByAnchorPostId: ReadonlyMap<string, number>;
    }
  | {
      status: "rpc_error";
      /** Best-effort message from PostgREST / Postgres. */
      errorMessage: string;
      commentCountByAnchorPostId: ReadonlyMap<string, number>;
    };

function distinctAnchorIdsFromPosts(posts: FeedPost[]): string[] {
  return [
    ...new Set(
      posts
        .map((p) => p.card_engagement_owner_post_id?.trim())
        .filter((id): id is string => id.length > 0),
    ),
  ];
}

/** Migration 035 not applied, or RPC name/signature not exposed to PostgREST yet. */
function isMissingPostNoteCommentCountsByAnchorRpc(err: { code?: string; message?: string }): boolean {
  const code = String(err.code ?? "");
  if (code === "PGRST202") return true;
  const msg = (err.message ?? "").toLowerCase();
  if (msg.includes("post_note_comment_counts_by_anchor")) {
    return (
      msg.includes("could not find") ||
      msg.includes("not found") ||
      msg.includes("does not exist") ||
      msg.includes("unknown function")
    );
  }
  if (msg.includes("could not find the function") && msg.includes("post_note_comment_counts_by_anchor")) {
    return true;
  }
  return false;
}

/**
 * Batches **`post_note_comment_counts_by_anchor`** over distinct `card_engagement_owner_post_id`
 * values from `posts`. Safe when migration **035** is missing: returns **`status: "unsupported"`**
 * instead of throwing.
 */
export async function fetchReadonlyAnchorNoteCommentCountProbe(
  supabase: SupabaseClient,
  posts: FeedPost[],
): Promise<ReadonlyAnchorNoteCommentCountProbe> {
  const empty = new Map<string, number>() as ReadonlyMap<string, number>;
  const ids = distinctAnchorIdsFromPosts(posts);

  if (ids.length === 0) {
    return { status: "ok", commentCountByAnchorPostId: empty };
  }

  const { data, error } = await supabase.rpc("post_note_comment_counts_by_anchor", {
    p_anchor_ids: ids,
  });

  if (error) {
    if (isMissingPostNoteCommentCountsByAnchorRpc(error)) {
      return {
        status: "unsupported",
        unsupportedReason: "rpc_not_available",
        commentCountByAnchorPostId: empty,
      };
    }
    console.error(error);
    return {
      status: "rpc_error",
      errorMessage: error.message?.trim() ? error.message : "post_note_comment_counts_by_anchor failed",
      commentCountByAnchorPostId: empty,
    };
  }

  const commentCountByAnchorPostId = new Map<string, number>();
  for (const row of (data ?? []) as AnchorCountRow[]) {
    commentCountByAnchorPostId.set(String(row.anchor_post_id), num(row.comment_count));
  }

  return { status: "ok", commentCountByAnchorPostId };
}
