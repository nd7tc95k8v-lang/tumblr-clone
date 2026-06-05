export type ProfileFollowStats = {
  followers: number;
  following: number;
};

export type FollowListKind = "followers" | "following";

export type FollowListCursor = {
  created_at: string;
  user_id: string;
};

export type FollowListEntry = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  followed_at: string;
};

export const DEFAULT_FOLLOW_LIST_PAGE_SIZE = 25;
