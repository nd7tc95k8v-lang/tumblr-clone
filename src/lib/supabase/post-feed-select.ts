/** Shared PostgREST select for feed-shaped rows (embeds poster + reblog original). */
export const POST_FEED_SELECT = `
  id,
  content,
  created_at,
  user_id,
  image_url,
  reblog_of,
  poster:profiles!user_id ( username ),
  original:posts!reblog_of (
    id,
    content,
    image_url,
    user_id,
    original_poster:profiles!user_id ( username )
  )
`;
