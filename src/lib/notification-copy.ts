import type { InboxNotificationKind } from "@/types/notification";

export function notificationActionLabel(kind: InboxNotificationKind): string {
  switch (kind) {
    case "follow":
      return "followed you";
    case "like":
      return "liked your post";
    case "reblog":
      return "reblogged your post";
    case "comment":
      return "commented on your post";
  }
}
