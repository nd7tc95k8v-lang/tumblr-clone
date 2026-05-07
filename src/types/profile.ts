import type { NsfwFeedMode } from "@/lib/nsfw-feed-preference";

export type ProfilePublic = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  /** DB column mirrored in the app shape; not editable in settings (edit profile preserves the saved value). Separate from default post NSFW and feed visibility. */
  profile_is_nsfw: boolean;
  /** When true, new originals by this user are marked NSFW on insert (DB trigger). */
  default_posts_nsfw: boolean;
  /** Viewer feed policy for discovery surfaces; see `parseNsfwFeedMode`. */
  nsfw_feed_mode?: NsfwFeedMode;
};
