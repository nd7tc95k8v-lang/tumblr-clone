import { displayTagsForPost, normalizeTagSegment } from "@/lib/tags";
import type { FeedPost } from "@/types/post";

/**
 * Home → Following only: set {@link FeedPost.homeFollowingMatchedTag} to the first effective tag
 * (see {@link displayTagsForPost}) that appears in `followedTags`. No extra DB calls.
 */
function stripHomeFollowingAnnotation(p: FeedPost): FeedPost {
  const next = { ...p };
  delete next.homeFollowingMatchedTag;
  return next;
}

export function annotatePostsForHomeFollowingFeed(posts: FeedPost[], followedTags: string[]): FeedPost[] {
  if (followedTags.length === 0) {
    return posts.map(stripHomeFollowingAnnotation);
  }

  const followedSet = new Set(
    followedTags.map((t) => normalizeTagSegment(t)).filter((t) => t.length > 0),
  );
  if (followedSet.size === 0) {
    return posts.map(stripHomeFollowingAnnotation);
  }

  return posts.map((p) => {
    const effective = displayTagsForPost(p);
    let matched: string | undefined;
    for (const t of effective) {
      const n = normalizeTagSegment(t);
      if (n.length > 0 && followedSet.has(n)) {
        matched = n;
        break;
      }
    }
    return { ...p, homeFollowingMatchedTag: matched };
  });
}
