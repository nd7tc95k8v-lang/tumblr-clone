export type InboxNotificationKind = "follow" | "like" | "reblog" | "comment";

/** Row from `notification_inbox_list` RPC. */
export type InboxNotificationRow = {
  kind: InboxNotificationKind;
  created_at: string;
  actor_id: string;
  actor_username: string | null;
  actor_avatar: string | null;
  thread_root_post_id: string | null;
  related_post_id: string | null;
};
