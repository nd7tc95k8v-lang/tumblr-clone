import type { NsfwFeedMode } from "@/lib/nsfw-feed-preference";

export type ProfilePublic = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  /** Public “this blog is mature” label; independent of default post NSFW. */
  profile_is_nsfw: boolean;
  /** When true, new originals by this user are marked NSFW on insert (DB trigger). */
  default_posts_nsfw: boolean;
  /** Viewer feed policy for discovery surfaces; see `parseNsfwFeedMode`. */
  nsfw_feed_mode?: NsfwFeedMode;
};
