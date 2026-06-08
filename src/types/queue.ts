/** Allowed values for `post_queue.status`. */
export type QueueStatus = "queued" | "publishing" | "failed";

/** Row from `post_queue_images` (ordered gallery). */
export type PostQueueImageRow = {
  id: string;
  queue_id: string;
  user_id: string;
  storage_path: string;
  position: number;
  created_at: string;
};

/** Row from `post_queue` with optional embedded images. */
export type PostQueueItem = {
  id: string;
  user_id: string;
  content: string;
  tags: string[];
  is_nsfw: boolean;
  queue_position: number;
  scheduled_for: string | null;
  status: QueueStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  post_queue_images?: PostQueueImageRow[] | null;
};
