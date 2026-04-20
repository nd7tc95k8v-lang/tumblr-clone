# Implementation roadmap: Tumblr ~2010 parity

This document breaks work into **ordered phases**. Each phase lists **goals**, **concrete tasks**, **exit criteria**, and **hints** pointing at existing code where relevant.

---

## Principles

- **Preserve the reblog chain model** already in place: `reblog_of` (immediate parent), `original_post_id` (thread root), snapshot fields on insert (`src/lib/reblog.ts`, migrations `004`, `009`, `013`).
- **Prefer incremental delivery**: ship Phase 1–2 before investing heavily in post types.
- **Match 2010 *behavior*** (reblog ritual, tags, notes), not proprietary APIs or themes unless explicitly scoped later.

---

## Phase 1 — Reblog ritual & tags

**Goal:** Align UX with classic Tumblr: *reblog to your blog*, optional commentary, **your tags** on the new row—primary path opens the reblog editor; a lighter **Quick** control skips the editor for an instant reblog.

### Tasks

1. **Copy & IA**
   - User-facing actions that insert a row with `reblog_of` use **Reblog** terminology (e.g. `components/ReblogModal.tsx`, primary control on `components/PostCard.tsx`).
   - Keep internal names (`reblog_commentary`, `quoted_post`, quote-chain UI) as-is; UI strings prioritize “reblog” over “quote.”

2. **Tags on reblog**
   - Tag input on the reblog modal reuses `parseCommaSeparatedTags` / patterns from `components/PostForm.tsx` and `src/lib/tags.ts`.
   - **Policy — REPLACE (implemented):** each new reblog row stores **only** the tags the reblogging user enters in the modal (or `[]` if none). Source / root tags are **not** copied onto the reblog row. Deduping and `MAX_TAGS` caps follow `parseCommaSeparatedTags`.
   - Persist on `posts.tags` for the new reblog row on insert (`useReblogAction.ts` + `reblogInsertFields` with `tags` in the payload).

3. **Optional — attribution**
   - Surface **Source / Via** (or a single “reblogged via”) on plain reblogs using existing chain resolution (`src/lib/feed-post-display.ts`, `plainReblogViaProfile`).

### Exit criteria

- Logged-in user can reblog with **optional commentary** and **explicit tags** in one flow (editor path), or **instant reblog** with no editor (empty tags on that row).
- Feed cards show tags from `displayTagsForPost` (this row’s `posts.tags` only).

### Code hints

- `components/ReblogModal.tsx`, `components/useReblogAction.ts`, `components/PostCard.tsx` (primary vs **Quick** instant control)
- `src/lib/reblog.ts` (`reblogInsertFields` + `tags`), `src/lib/tags.ts` (`parseCommaSeparatedTags`, `displayTagsForPost`)

---

## Phase 2 — Unified Notes

**Goal:** One **Notes** surface aggregating activity (likes, reblogs, and later replies)—the “social object” people clicked on Tumblr.

### Tasks

1. **Entry points (card footer)**
   - **Notes** — primary control for the aggregated modal (totals + likes/reblogs/note list).
   - **Note** (icon + label on `sm+`) — same `PostNotesModal`, opens with the short-note composer focused after load (`PostCard` → `focusComposerOnOpen`); storage and reads unchanged.

2. **Data**
   - Consolidate existing RPCs / fetchers (`src/lib/supabase/fetch-post-notes.ts`, `028_post_notes_likes_list_rpc.sql`, engagement in `src/lib/supabase/feed-engagement.ts`) behind one Notes experience.
   - Tabs or sections: **Likes**, **Reblogs**, (future) **Replies**.

3. **Semantics**
   - Document for users: likes target **thread root** (`usePostLikeToggle.ts` → `rootPostId`). Notes UI should say “likes on original” if you keep root-only likes.

### Exit criteria

- From a post card, user opens Notes and understands **who** liked and **who** reblogged (lists or paginated lists).

### Code hints

- `components/PostNotesModal.tsx`, `src/types/post-note.ts`

---

## Future work — Per-reblog / per-card engagement (planning only)

> **Not shipped.** Documents today’s **thread-root** engagement model and a migration outline toward Tumblr-style per-card / per-authored-layer semantics. Implementing this requires deliberate code + (later) optional DB/RPC work; nothing here changes runtime by itself.

### Current ownership model (as shipped)

| Feature | Id used | Source |
|--------|---------|--------|
| **Like insert/delete** | `threadRootPostId(post)` | `components/PostCard.tsx` → `usePostLikeToggle` → `likes.post_id`. `threadRootPostId` = `original_post_id` when set, else `post.id` (`src/lib/post-thread-root.ts`). |
| **`liked_by_me` (feed)** | Same **thread root** | `attachFeedPostEngagement` batches distinct `threadRootPostId(p)` → `post_ids_liked_by_auth_user(p_post_ids)` (`src/lib/supabase/feed-engagement.ts`). |
| **`like_count` (feed)** | Same **thread root** | `post_like_counts(p_post_ids)` — counts `likes` rows whose `post_id` is each root id (`015_post_likes.sql`). |
| **`reblog_count` (feed)** | Same **thread root** | `post_reblog_counts_by_root(p_root_ids)` — descendant `posts` with `original_post_id = root`, excluding the root row (`015_post_likes.sql`). |
| **`note_comment_count` (feed)** | Same **thread root** | `post_note_comment_counts_by_root` — `post_note_comments.thread_root_post_id` (`033_post_note_comments.sql`). |
| **Notes modal list** | **`threadRootPostId` prop** | `fetchPostNotes`: RPC `post_likes_list_for_thread_root(p_root_post_id)` (`028_post_notes_likes_list_rpc.sql`); reblogs `posts.original_post_id = root` and `id <> root`; comments `post_note_comments.thread_root_post_id = root` (`src/lib/supabase/fetch-post-notes.ts`). |
| **Notes modal totals** | Same root | `fetchPostNotesTotalCount` — `post_like_counts`, `post_reblog_counts_by_root`, head count on `post_note_comments` for that root (`fetch-post-notes.ts`). |

**Reserved derived id:** `noteOwnerPostIdForCard(post)` in `src/lib/feed-post-display.ts` — mirrors authored-layer / plain-reblog collapse (`resolvePlainReblogDisplay`). **Not** wired to likes or Notes yet; intended anchor once hydration, modal queries, and copy agree.

### Card-level totals vs existing RPCs (audit, `card_engagement_owner_post_id`, no DB change)

Ground rule: **`posts.original_post_id` is always the chain thread root** for every reblog row (`009_posts_original_post_id.sql`). **`post_note_comments`** only stores **`thread_root_post_id`**, aligned with that root (`033_post_note_comments.sql`).

| Total kind | Can we read a meaningful **authored-layer / card-owner** number with **existing RPCs only** by passing `card_engagement_owner_post_id`? | Notes |
|------------|----------------------------------------------------------------------------------------------------------------------------------------|-------|
| **Likes** | **Yes (subset).** | `post_like_counts(p_post_ids)` groups `likes` by `likes.post_id` (`015_post_likes.sql`). Any post uuid is valid input; counts are “likes whose target row is exactly this id.” Shipped **writes** still attach likes to the **thread root**, so for many cards (especially plain/inner authored ids) the probe reads **0** today — that is still an honest **thread vs card-owner id** diff for later migrations. `post_ids_liked_by_auth_user` is the same shape: per listed `post_id`. |
| **Reblogs** | **No — do not treat `post_reblog_counts_by_root` as per-card.** | That RPC counts `posts` rows with `original_post_id = any(p_root_ids)` and returns `root_id = original_post_id` (`015_post_likes.sql`). For a reblog/inner **card-owner id** `C` that is **not** equal to some row’s `original_post_id` as chain root (typical: `C` is a mid-chain row but `original_post_id` on all descendants is still the **thread root** `T`), **no rows match** `original_post_id = C` → missing/zero totals that **do not** mean “reblogs of this authored layer.” Only when `card_engagement_owner_post_id === thread root` does the call coincide with shipped thread reblog semantics. A true per-card reblog tally needs a **different aggregation** (e.g. descendants by `reblog_of`, subtree rules, or a new RPC) — not a rename of the current function’s inputs. |
| **Note comments (flat `post_note_comments`)** | **No.** | `post_note_comment_counts_by_root` groups by `thread_root_post_id` only (`033_post_note_comments.sql`). Passing a **non-root** card-owner id counts comments only if rows were stored with that id as `thread_root_post_id`; shipped inserts use the **thread root**, so the probe does **not** represent authored-layer note volume. Per-card note comments need **schema / RPC** work (or a distinct anchor column) before counts align with Tumblr-style semantics. |

**Internal prep (read-only, unwired):** `src/lib/supabase/readonly-card-owner-like-prototype.ts` exports `fetchReadonlyPrototypeCardOwnerLikeProbe` — batches `post_like_counts` + optional `post_ids_liked_by_auth_user` on distinct `card_engagement_owner_post_id` values for side-by-side comparison with thread-root hydration. It deliberately does **not** call `post_reblog_counts_by_root` or `post_note_comment_counts_by_root` on those ids, because that would imply parity that the RPC contracts do not provide.

**Anchor note-comment count probe (read-only):** `src/lib/supabase/readonly-anchor-note-comment-count-probe.ts` exports **`fetchReadonlyAnchorNoteCommentCountProbe`** — calls **`post_note_comment_counts_by_anchor`** (migration **035**) over distinct `card_engagement_owner_post_id` values. Returns **`status: "ok"`** with a map, **`"unsupported"`** when the RPC is absent, or **`"rpc_error"`**; never throws. **`attachFeedPostEngagement`** uses it **only in `NODE_ENV === "development"`** to attach **`anchor_note_comment_count`** on hydrated **`FeedPost`** rows when the probe succeeds, and to log compact **thread vs anchor** mismatches. **Production:** field omitted (no probe). **Shipped UI** still uses **`note_comment_count`** only. Unsupported RPC: **one** `console.info` per process.

**Dev-only card label:** `PostCard` shows a tiny **`dev: notes root … / anchor …`** line in the footer/meta row **only in development** when **`anchor_note_comment_count`** is a number and **≠** **`note_comment_count`** — diagnostic only; stripped from production builds via `NODE_ENV` check.

**Dev-only Notes modal indicator:** when **`NEXT_PUBLIC_NOTES_ANCHOR_COMMENTS_PROTOTYPE=1`** and **`prototypeAnchorScopedNotesComments`**, `PostNotesModal` shows a mono line **`dev: note-comments — …`** (list/count path: thread-root default, anchor RPC, or anchor→thread fallback) from **`devCommentListSource` / `devCommentCountSource`** on fetch results — diagnostic only.

**Dev-only comment subtotal comparison (summary card):** inside the Notes summary card, a compact line **`dev: comments root … / anchor …`** appears only in **`NODE_ENV === "development"`**, with the prototype env + modal prop on, when the totals fetch used the anchor count RPC and returned **`devThreadRootCommentCountForCompare`**, and that thread-root head count **differs** from the anchor subtotal. **Non-shipping:** shipped breakdown copy and totals math are unchanged; production builds omit this UI.

### Prototype readiness — authored-layer comment reads (audit)

This subsection is **decision-oriented**: it describes what the code does today and whether a **broader read-path rollout** (e.g. anchor-scoped comment reads in dev **without** an explicit env flag) is justified. **No runtime change** is implied by this text.

#### Current capabilities

- **Notes modal — comment list (dev opt-in):** With **`NODE_ENV === "development"`**, **`NEXT_PUBLIC_NOTES_ANCHOR_COMMENTS_PROTOTYPE=1`**, non-empty **`notesAnchorPostId`**, and **`prototypeAnchorScopedNotesComments`** from the caller (`PostNotesModal` / `PostCard`), `fetchPostNotes` loads comments via **`post_note_comments_list_for_anchor`** (`fetch-post-notes.ts`).
- **Notes modal — comment subtotal in totals (same gates):** `fetchPostNotesTotalCount` resolves the reply slice via **`post_note_comment_counts_by_anchor`**; **`total`** still sums likes + reblogs + that comment count (likes/reblogs remain thread-root RPCs).
- **Notes modal — likes / reblogs:** Unchanged — **`post_likes_list_for_thread_root`**, root-scoped reblog query, thread-root keys on assembled `PostNote` rows (`fetch-post-notes.ts`).
- **Feed hydration — shipped `note_comment_count`:** Still from **`post_note_comment_counts_by_root`** batched on **`threadRootPostId`** (`feed-engagement.ts` → `engagementKeyForBatchAndMerge`).
- **Feed hydration — dev-only shadow field:** In development, after the shipped merge, **`fetchReadonlyAnchorNoteCommentCountProbe`** runs; on success, rows get **`anchor_note_comment_count`** from **`post_note_comment_counts_by_anchor`** keyed by **`card_engagement_owner_post_id`** (`readonly-anchor-note-comment-count-probe.ts`, `feed-engagement.ts`). Production never calls the probe.
- **Comment inserts (modal):** **`thread_root_post_id`** is always set; **`note_anchor_post_id`** is dual-written when the anchor id is present and the column exists, with a retry path if the column is missing (`PostNotesModal.tsx`).

#### Current limitations

- **Triple gate for anchor reads:** Env flag **and** `prototypeAnchorScopedNotesComments` **and** a non-empty anchor id; production paths short-circuit to thread-only (`wantsPrototypeAnchorComments*` in `fetch-post-notes.ts`).
- **No anchor comment list/count on the feed card** beyond the optional **`anchor_note_comment_count`** diagnostic field; UI still labels and uses **`note_comment_count`** for shipped counts.
- **Mixed semantics in the Notes modal** when the prototype is on: likes/reblogs are thread-wide; comments are anchor-scoped — by design for the experiment, not a finished “one social object” model.
- **Historical rows:** Anchor RPCs only see rows with **`note_anchor_post_id`** populated as the RPC defines; pre-migration / pre–dual-write comments remain thread-visible but may be **absent or undercounted** on anchor reads until data is aligned (product + migration policy).

#### Fallback when migration 035 / RPCs are missing

- **`post_note_comments_list_for_anchor`** missing or “not found”:** comment list falls back to the **thread-root** `post_note_comments` query; dev **`devCommentListSource`:** **`anchor_fallback_thread_root`**; one **`console.info`** per process (`fetch-post-notes.ts`).
- **`post_note_comment_counts_by_anchor`** missing:** comment count for totals falls back to **thread-root head count**; **`devCommentCountSource`:** **`anchor_fallback_thread_root`**; one **`console.info`** per process.
- **Hard RPC errors** (not classified as “missing”): list path surfaces an error to the modal; count path returns **`comment_count: 0`** with an error message (caller shows failure) — see `resolveCommentCountForTotals` return on non-missing errors.
- **Feed probe:** **`unsupported`** → no **`anchor_note_comment_count`**, one **`console.info`** per process; **`rpc_error`** → unchanged rows, error logged (`readonly-anchor-note-comment-count-probe.ts`, `feed-engagement.ts`).

#### Diagnostics (dev-only; not criteria for shipping)

- **`devCommentListSource` / `devCommentCountSource`** on fetch results; modal mono line **`dev: note-comments — …`** (`PostNotesModal.tsx`).
- **Summary card line** **`dev: comments root … / anchor …`** when anchor count RPC succeeded and differs from thread-root compare count.
- **`PostCard`** footer **`dev: notes root … / anchor …`** when probe counts disagree.
- **`[feed-engagement]`** capped **`console.info`** for thread≠anchor mismatches; **`console.debug`** reblog batch diagnostics.

#### Remaining blockers before defaulting anchor comment reads in development (no env flag)

**Product / semantics**

- **Single-number story:** Feed and shipped UI still advertise **thread-root** reply counts; turning on anchor reads globally in dev without also surfacing or reconciling that story will confuse anyone comparing card vs modal vs list.
- **Mixed modal surface:** Until product accepts **thread likes/reblogs + anchor comments** as a coherent interim, or moves likes/reblogs to an authored-layer model, “default anchor comments” in dev is a **partial** Tumblr-style object.
- **Data parity policy:** Explicit decision on **backfill**, **null `note_anchor_post_id`**, and acceptable **thread vs anchor** divergence during migration (the diagnostics exist because mismatch is expected until data + semantics converge).

**Technical**

- **035 everywhere:** All dev databases / preview envs used without the flag must expose **`post_note_comments_list_for_anchor`** and **`post_note_comment_counts_by_anchor`**; otherwise the app **silently** reverts to thread semantics for comments while the flag might imply otherwise.
- **Caller contract:** `PostCard` (and any other entry) must pass a correct **`card_engagement_owner_post_id`** as **`notesAnchorPostId`** whenever anchor reads are default; empty/wrong anchor id already disables the prototype path.
- **Split-failure edge case:** List and count are **two** RPCs; both have independent fallbacks — rare cases could theoretically diverge (list fallback, count anchor or vice versa) until unified error handling or a single backend read is introduced.
- **Feed vs modal alignment:** Defaulting dev modal anchor reads without changing **`attachFeedPostEngagement`** batching means **feed `note_comment_count`** and **modal anchor comment total** can disagree by design — acceptable only if the team treats dev as explicitly **dual-read**.

#### Go / no-go criteria for the next rollout step

**Next step assumed:** Enable anchor-scoped **comment** list + count reads **by default in development** (remove reliance on **`NEXT_PUBLIC_NOTES_ANCHOR_COMMENTS_PROTOTYPE`**) while keeping production and shipped totals behavior unchanged.

| Criterion | **Go** | **No-go** |
|-----------|--------|-----------|
| **Migration 035** | All target dev/staging DBs have anchor RPCs + **`note_anchor_post_id`**; smoke-tested list + count on real data. | Any shared dev DB lacks RPCs → silent thread fallback dominates. |
| **Data policy** | Team signed off on **anchor-only visibility** for old rows (or backfill completed / feature flagged per-blog). | Anchor counts/lists routinely empty while thread has comments, with no documented expectation. |
| **Semantics / UX** | Mixed thread likes + anchor comments in the modal is **documented and accepted** for dev; or companion change clarifies counts (copy or secondary label) **without** changing shipped prod. | Stakeholders expect card count ≡ modal reply count without eng explaining thread vs anchor. |
| **Operational** | Developers know to use **`devComment*Source`** + summary/card diagnostics to spot fallback (`anchor_fallback_thread_root`) and RPC errors. | No one monitors logs; fallbacks go unnoticed. |
| **Regression safety** | **`NODE_ENV === "production"`** paths remain thread-only (code review gate on `wantsPrototype*`). | Any change that runs anchor RPCs or changes **`note_comment_count`** merge keys in production without an explicit product release. |

**Recommendation (today):** **No-go** for removing the env flag until 035 is universal on dev data, mismatch/fallback is understood, and product accepts **thread vs authored-layer** dual numbers (or schedules feed/modal alignment). The prototype is **fit for continued opt-in validation**, not for silent default-on in dev.

### Planned DB / RPC expansion — authored-layer Notes (design only)

> **Backward compatibility:** keep **`thread_root_post_id`** and all existing **thread-root RPCs** (`post_reblog_counts_by_root`, `post_note_comment_counts_by_root`, `post_likes_list_for_thread_root`, `post_like_counts`, etc.) **unchanged** in meaning and signatures. Add **nullable columns** and **new** RPC names only until product and app explicitly switch reads/writes.

#### 1. Minimum schema additions (additive)

| Change | Purpose |
|--------|---------|
| **`post_note_comments.note_anchor_post_id`** — `uuid` **nullable**, `references public.posts (id) on delete set null`, indexed | **Authored-layer / card-owner anchor** for “this note comment belongs to this visible social object,” aligned with app `noteOwnerPostIdForCard` / `FeedPost.card_engagement_owner_post_id`. **Why keep `thread_root_post_id`:** chain-wide visibility, existing RLS shape, existing `post_note_comment_counts_by_root`, and migration-era dual-read (thread vs anchor) without dropping data. **Why one extra column is enough:** flat comments only need (a) which **thread** they belong to for moderation/NSFW inheritance and (b) which **post row** they surface under in the UI; two ids cover that without a new table. |
| **Optional later (not required for first Notes ship):** check constraint or trigger enforcing `note_anchor_post_id` lies on the same reblog chain as `thread_root_post_id` | Reduces garbage anchors; defer until chain-resolution helpers exist in SQL or app validates strictly. |

**No change** to `posts` columns for reblog graph: **`reblog_of`** already supports per-parent immediate children; new RPCs read it.

#### 2. Recommended new RPCs (additive; preserve old ones)

| RPC | Role | Notes |
|-----|------|--------|
| **`post_reblog_counts_by_immediate_parent(p_parent_post_ids uuid[])`** → `(parent_post_id, reblog_count)` | Batched **“reblogs whose `posts.reblog_of` is this anchor”** (one hop). | **Smallest** aggregation that matches “who hit reblog on *this* card row” for a given `posts.id`. **Not** the same as `post_reblog_counts_by_root` (which groups by **`original_post_id`** = thread root). If product later needs **full subtree** counts under an anchor, add a **separate** RPC (recursive CTE or precomputed closure) — do not overload this function. |
| **`post_note_comment_counts_by_anchor(p_anchor_ids uuid[])`** → `(anchor_post_id, comment_count)` | Batched counts where **`note_anchor_post_id = anchor`** (ignore null anchors). | Feed / experiments can batch distinct `card_engagement_owner_post_id` values. **`post_note_comment_counts_by_root` stays** for thread-root-only paths. |
| **`post_note_comments_list_for_anchor(p_anchor_post_id uuid, p_limit int)`** (optional but recommended) | Security-definer **list** of note rows for the Notes modal merge, keyed by anchor. | Mirrors **`post_likes_list_for_thread_root`** style: avoids relying on broad `post_note_comments` RLS + client filters when anchor-scoped lists ship. Cap `p_limit` like other Notes RPCs. |
| **Likes list for arbitrary post id** | Per-anchor likes in the merged Notes stream. | **`post_likes_list_for_thread_root`** already filters `likes.post_id = p_root_post_id`; **no signature change required** — pass the **anchor** uuid once likes target that row. Optionally add a **wrapper alias** RPC with a neutral name later for clarity only. |
| **Reblogs list for anchor** | Reblog rows for merge. | Today: client `.from('posts').eq('original_post_id', threadRoot)` in `fetch-post-notes.ts`. For anchor mode: `.eq('reblog_of', anchor)` (immediate children) **or** SD RPC **`post_immediate_reblogs_list_for_parent`** (drafted in `035_authored_layer_notes_schema_rpcs.sql`) if RLS / consistency requires it. |

#### 3. RLS / indexes (implications)

- **Index:** `(note_anchor_post_id, created_at desc)` on `post_note_comments` for counts + anchor-scoped lists.
- **INSERT policy (`post_note_comments_insert_guarded`):** extend `with check` so when **`note_anchor_post_id` is not null**, **`exists (select 1 from posts where id = note_anchor_post_id)`** (same pattern as `thread_root_post_id`). Keeps anonymous inserts impossible; preserves human-check + rate limit.
- **SELECT policy:** can remain **thread-root–based** in Phase A/B so legacy visibility is unchanged; tightening to also require anchor visibility (inner NSFW edge cases) is a **later** optional migration.
- **Rate limit** `post_note_comment_insert_rate_ok`: still global per user; no change required for first version.

#### 4. Phased migration (recommended)

| Phase | Scope |
|-------|--------|
| **A — Additive schema + RPCs** | Land **`note_anchor_post_id`**, indexes, new RPCs, relaxed insert policy. **No app switch:** shipped code keeps writing/reading thread-only paths; new column stays **null** for new rows until Phase B (or backfill script). |
| **B — Dual-write / dual-read** | App sets **`thread_root_post_id`** (unchanged) **and** **`note_anchor_post_id`** on insert (anchor = `noteOwnerPostIdForCard` or explicit modal prop). **Backfill** (one-shot SQL): `UPDATE post_note_comments SET note_anchor_post_id = thread_root_post_id WHERE note_anchor_post_id IS NULL` so anchor-scoped counts at the **thread root** match legacy “whole thread” comment totals until UI intentionally splits. Optional **dual-read** logging: compare `post_note_comment_counts_by_root` vs `post_note_comment_counts_by_anchor` + `post_reblog_counts_by_root` vs `post_reblog_counts_by_immediate_parent` in dev. |
| **C — UI / API migration** | `fetch-post-notes.ts`, `PostNotesModal`, `feed-engagement.ts`, footers: switch queries to anchor where product locks semantics. Likes already per `post_id`; wire like list to anchor when like writes move. |
| **D — Cleanup (optional, only if ever needed)** | Deprecate unused code paths; **do not drop** `thread_root_post_id` or old RPCs until analytics and notifications explicitly no longer depend on them. |

#### 5. Draft SQL on disk

See **`supabase/migrations/035_authored_layer_notes_schema_rpcs.sql`** — additive column, index, insert-policy tweak, and new count/list RPCs. **Not referenced by app code yet**; applying it changes the database only when you run migrations.

#### 6. App wiring plan after migration 035

**Current (shipped UI unchanged):** `PostNotesModal` receives **`threadRootPostId`** (thread-root Notes scope) and optional **`notesAnchorPostId`** (`FeedPost.card_engagement_owner_post_id` from `PostCard`). List/totals still use thread root only. **Comment inserts** dual-write **`note_anchor_post_id`** when `notesAnchorPostId` is non-empty; if the column is missing (migration 035 not applied), the insert **retries once** without `note_anchor_post_id` only when the error matches a missing-column pattern — other errors surface unchanged.

| Kind | Location | After dual-write / anchor reads ship |
|------|----------|--------------------------------------|
| **Write — insert `note_anchor_post_id`** | `components/PostNotesModal.tsx` → `handleSubmitComment` | **Done:** dual-write when anchor prop set + DB has column; fallback when column absent (see above). |
| **Write — delete** | `PostNotesModal.tsx` → `handleDeleteOwnComment` → `.delete().eq("id", commentId)` | Unchanged for anchor column (row delete). |
| **Read — modal merged list** | `src/lib/supabase/fetch-post-notes.ts` → **`fetchPostNotes`** | **Comments:** replace or parallel `.from("post_note_comments").eq("thread_root_post_id", …)` with **`post_note_comments_list_for_anchor`** when anchor mode. **Reblogs:** replace `.from("posts").eq("original_post_id", …)` with **`post_immediate_reblogs_list_for_parent`** (or `.eq("reblog_of", anchor)` client query) when listing by anchor. **Likes:** keep **`post_likes_list_for_thread_root`** but pass **anchor** `post_id` once likes target that row. |
| **Read — modal totals** | `fetch-post-notes.ts` → **`fetchPostNotesTotalCount`** | **Comment count:** swap head-count on `thread_root_post_id` for **`post_note_comment_counts_by_anchor`** (single-id batch) when anchor mode. **Reblog count:** add **`post_reblog_counts_by_immediate_parent`** for anchor vs today’s **`post_reblog_counts_by_root`** for thread. |
| **Read — feed badge / hydration** | `src/lib/supabase/feed-engagement.ts` → **`attachFeedPostEngagement`** (`post_note_comment_counts_by_root` + merge `note_comment_count`) | Optional second RPC batch **`post_note_comment_counts_by_anchor`** keyed by `engagementKeyCardOwner` when feed should show per-card note totals; **`PostCard.tsx`** reads **`post.note_comment_count`** and **`onThreadNoteCountDelta`** naming may need a parallel adjustment when anchor counts diverge from thread. |
| **Types / hydrate** | `src/types/post.ts` (`note_comment_count`), `fetch-feed-posts.ts`, `reblog.ts` | New optional field (e.g. anchor-only count) only if UI needs both thread and anchor during transition; otherwise overload **`note_comment_count`** only after reads switch. |

**Data flow:** `PostCard` passes **`threadRootPostId(post)`** and **`post.card_engagement_owner_post_id`** as **`notesAnchorPostId`**. **`fetchPostNotes`** / totals still thread-only until a later change selects anchor-scoped reads.

### Code / RPC touchpoints for a later migration

- **`src/lib/supabase/fetch-post-notes.ts`** + **`components/PostNotesModal.tsx`** — **Default reads:** thread-root likes/reblogs/comments. **Dev opt-in:** set **`NEXT_PUBLIC_NOTES_ANCHOR_COMMENTS_PROTOTYPE=1`** — `PostCard` passes **`prototypeAnchorScopedNotesComments`**; **`fetchPostNotes`** / **`fetchPostNotesTotalCount`** then use **`post_note_comments_list_for_anchor`** + **`post_note_comment_counts_by_anchor`** for **comments only** (missing RPC → thread fallback, one `console.info` each). Likes/reblogs stay thread-root. **Modal props:** `threadRootPostId` + **`notesAnchorPostId`**; inserts dual-write **`note_anchor_post_id`** when supported.
- **`PostNotesModal` component boundary** — `threadRootPostId` remains the Notes list/total key; **`notesAnchorPostId`** is the authored-layer anchor for insert dual-write only until read paths migrate.
- **`src/lib/supabase/feed-engagement.ts`** — Only collects `threadRootPostId`; merges counts onto every row from that root. **Dev:** sets optional **`anchor_note_comment_count`** + mismatch log when anchor RPC works. Per-card likes still need a different id set and/or batched `post_like_counts` over many ids + mapping back to rows.
- **`src/lib/supabase/readonly-card-owner-like-prototype.ts`** — **Not shipped.** Read-only like (+ optional liked-id set) probe on `card_engagement_owner_post_id`; see audit table above.
- **`src/lib/supabase/readonly-anchor-note-comment-count-probe.ts`** — `fetchReadonlyAnchorNoteCommentCountProbe` → `post_note_comment_counts_by_anchor` when migration **035** is present. **Dev-only consumer:** `attachFeedPostEngagement` mismatch logging; does not set feed fields.
- **`src/lib/supabase/fetch-feed-posts.ts`** — Calls `attachFeedPostEngagement` after hydrate; unchanged contract until engagement changes.
- **`components/PostCard.tsx`** — Like toggle `rootPostId`; footer totals read row fields from engagement; `PostNotesModal` receives `threadRootPostId(post)` and `notesAnchorPostId={post.card_engagement_owner_post_id}`.
- **`components/usePostLikeToggle.ts`** — Must stay aligned with whatever id populates `liked_by_me`.
- **SQL/RPCs** — `post_like_counts` / `post_ids_liked_by_auth_user` are already per-`post_id` lists; thread semantics are **which ids the app passes**. Root-named RPCs (`post_likes_list_for_thread_root`, `post_reblog_counts_by_root`, `post_note_comment_counts_by_root`) encode thread aggregation; per-reblog UX may need new functions or parameters (separate migration when allowed).

### Phased migration plan (smallest architecture-safe path)

1. **Contract** — Pick the visible “social object” id per card (align with `noteOwnerPostIdForCard` or document divergence). Update product copy (`Phase 2` semantics) before code.
2. **Hydration** — Extend `attachFeedPostEngagement` (or add a parallel path) so `like_count` / `liked_by_me` can reflect **per-card** targets **before** changing insert/delete; validate with flags or dual fields to avoid shipping a mismatched heart.
3. **Like writes** — Switch `usePostLikeToggle`’s `rootPostId` only when step 2 matches; optional migration/backfill for existing `likes` rows if historical data must move from root to reblog rows.
4. **Notes modal** — Point list + totals at the same anchor as the card (update `fetchPostNotes` / totals or add RPCs). **Risk:** likes flip early while modal stays root → users see inconsistent totals between card and modal.
5. **Notifications / admin** — Align `034_notification_inbox.sql` consumers and any dashboards once anchors stabilize.

**Explicit mismatch risks:** (a) Like button on id **A** while `like_count` / `liked_by_me` still use **root** — broken UX. (b) Card shows thread `reblog_count` while per-reblog reblogs are desired — scope separately. (c) NSFW / RLS visibility if some chain rows are hidden — batching must use ids the viewer can resolve.

---

## Phase 3 — Post types (incremental)

**Goal:** Tumblr’s identity included **typed posts** (text, photo, quote, link, chat, …), not one undifferentiated blob.

### Tasks

1. **Schema**
   - Add `post_type` (enum or text check) on `posts`; nullable during migration with backfill (`text` / `photo` for current rows).

2. **Snapshots on reblog**
   - Ensure reblog insert copies **type-specific fields** needed to render without extra joins (mirror current snapshot pattern for body/media).

3. **UI**
   - Compose flows per type (minimal first: **quote**, **link**).
   - `PostCard` variants per type (`components/PostCard.tsx`).

### Exit criteria

- User can create at least **two** distinct types besides plain text; reblogs render parent content with correct layout.

### Code hints

- `components/PostForm.tsx`, `components/ComposeClient.tsx`, migrations under `supabase/migrations/`

---

## Phase 4 — Dashboard density & chains

**Goal:** Long-session scrolling with readable attribution (2010 dashboard “feel”).

### Tasks

1. **Feed mechanics**
   - Infinite scroll or cursor pagination if not already solid on home/explore/tag pages.

2. **Chains**
   - Where quote depth is clamped (`QUOTE_NEST_MAX_INITIAL_DEPTH` in `src/lib/feed-post-display.ts`), ensure **Expand / Show full chain** works with `QuotedPostNest` / `fetchReblogParentClosure` in `src/lib/quote-chain.ts`.

3. **Nice-to-have (later)** — collapse consecutive reblogs from same blog.

### Exit criteria

- Heavy reblog threads remain navigable without losing context.

---

## Phase 5 — Replies & notification copy

**Goal:** Conversation on posts (comments/replies) + notifications that use Tumblr-ish verbs.

### Tasks

1. **Storage & RLS**
   - Extend or use `post_note_comments` / related migrations (`033_post_note_comments.sql`) with clear thread anchor (`original_post_id` vs specific row—pick one).

2. **UI**
   - Reply thread on permalink or modal; hook into `notifications` pipeline (`034_notification_inbox.sql`, `components/NotificationsClient.tsx`).

3. **Copy**
   - Align strings: “reblogged your post,” “liked your post,” “replied to…”

### Exit criteria

- User can reply; OP and participants get usable notifications.

---

## Phase 6 — Permalinks & discovery polish

**Goal:** Share outside the app; reblog from a permalink.

**Foundation (shipped early):** A canonical **`/post/[uuid]`** page loads one feed-shaped row via `fetchFeedPostById` (`src/lib/supabase/fetch-feed-posts.ts`) and renders it with the same `PostCard` as the feed. That gives Notes and sharing a stable home before threaded replies land (Phase 5). See `src/app/post/[id]/page.tsx`, `components/PostPermalinkClient.tsx`, `postPermalinkPath` in `src/lib/post-anchor.ts`.

### Tasks

1. **Permalinks**
   - Stable URLs for posts (`/post/[id]`); optional “Reblog” from permalink with `reblog_of` prefilled (same controls as feed).
   - Subtle **Link** control on feed cards opens the permalink (`components/PostCard.tsx`).

2. **Tag pages**
   - Reconcile tag indexing with Phase 1 tag rules (`src/app/tag/[tag]/`, `displayTagsForPost`).

3. **Out of scope unless requested**
   - Full **theme engine**, **audio/video** hosting at Tumblr scale—these are large and can be separate programs of work.

### Exit criteria

- Open permalink → reblog → appears on home feed with correct chain and tags.

---

## Suggested execution order

1. Phase **1** then **2** (core loop + social proof).
2. Phase **3** in parallel with small slices only after reblog tag insert is stable.
3. **Permalink foundation** (`/post/[id]`) can ship as soon as Phase 1–2 are usable — it supports Notes, sharing, and Phase **5** replies without waiting for the rest of Phase **6**.
4. Phases **4–6** as polish and retention (permalink polish beyond the foundation, tag pages, discovery).

---

## Maintenance

When a phase ships, tick items here or link to PRs. Update **Phase 1 tag policy** once chosen so future contributors do not fork behavior accidentally.
