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

1. **Single entry point**
   - One primary control per card (e.g. “Notes”) opening a modal/drawer that explains totals **and** lists breakdowns.

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

### Code / RPC touchpoints for a later migration

- **`src/lib/supabase/fetch-post-notes.ts`** + **`components/PostNotesModal.tsx`** — **Shipped:** entirely thread-root–scoped; modal still passes `threadRootPostId` only. **Prep seam:** explicit **`notesThreadRootQueryKey`** vs documented future per-card key; list merge in **`assembleMergedPostNotes`**. Later: second mode / new RPCs for “notes for this `post.id`” vs “notes for this thread.”
- **`PostNotesModal` component boundary** — File-level scope comment, prop JSDoc on `threadRootPostId`, and **`shippedNotesModalThreadRootKey`** make the thread-root-only contract obvious at the UI boundary (no new props yet). Prepares a clean place to thread a future card/authored-layer notes owner id next to unchanged `threadRootPostId` semantics until migration.
- **`src/lib/supabase/feed-engagement.ts`** — Only collects `threadRootPostId`; merges counts onto every row from that root. Per-card likes need a different id set and/or batched `post_like_counts` over many ids + mapping back to rows.
- **`src/lib/supabase/readonly-card-owner-like-prototype.ts`** — **Not shipped.** Read-only like (+ optional liked-id set) probe on `card_engagement_owner_post_id`; see audit table above.
- **`src/lib/supabase/fetch-feed-posts.ts`** — Calls `attachFeedPostEngagement` after hydrate; unchanged contract until engagement changes.
- **`components/PostCard.tsx`** — Like toggle `rootPostId`; footer totals read row fields from engagement; `PostNotesModal` receives `threadRootPostId(post)`.
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
