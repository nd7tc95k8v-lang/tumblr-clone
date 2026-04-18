/** DOM id prefix for post cards; used for `#…` deep links (e.g. notifications → profile). */
export const QRTZ_POST_ELEMENT_ID_PREFIX = "qrtz-post-";

export function postElementDomId(postId: string): string {
  const id = postId?.trim() ?? "";
  return `${QRTZ_POST_ELEMENT_ID_PREFIX}${id}`;
}
