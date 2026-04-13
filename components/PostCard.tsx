"use client";

import React from "react";
import type { FeedPost } from "@/types/post";
import {
  bodyFromPost,
  formatPostTime,
  postProfileLinkRaw,
  usernameFromEmbed,
} from "@/lib/feed-post-display";
import ProfileUsernameLink from "./ProfileUsernameLink";

type Props = {
  post: FeedPost;
  rebloggingId: string | null;
  onReblog: (post: FeedPost) => void | Promise<void>;
  showReblog?: boolean;
};

export default function PostCard({ post, rebloggingId, onReblog, showReblog = true }: Props) {
  const { primary, rebloggedBy, isReblog } = usernameFromEmbed(post);
  const { primaryRaw, rebloggerRaw } = postProfileLinkRaw(post);
  const { content, imageSrc } = bodyFromPost(post);

  return (
    <article className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        <ProfileUsernameLink usernameRaw={primaryRaw} className="font-semibold text-inherit">
          {primary}
        </ProfileUsernameLink>
      </p>
      <p className="text-zinc-900 dark:text-zinc-100 mt-3 mb-2 whitespace-pre-wrap">{content}</p>
      {imageSrc ? (
        <img
          src={imageSrc}
          alt="Post image"
          loading="lazy"
          decoding="async"
          className="mt-3 rounded-xl max-h-[500px] w-full object-cover"
        />
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{formatPostTime(post.created_at)}</p>
          {showReblog ? (
            <button
              type="button"
              disabled={rebloggingId !== null}
              onClick={() => void onReblog(post)}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {rebloggingId === post.id ? "Reblogging…" : "Reblog"}
            </button>
          ) : null}
        </div>
        {isReblog ? (
          <div className="text-right text-xs text-zinc-500 dark:text-zinc-400 sm:max-w-[55%] shrink-0">
            <p>
              Original post by{" "}
              <ProfileUsernameLink usernameRaw={primaryRaw} className="text-inherit">
                {primary}
              </ProfileUsernameLink>
            </p>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
              Reblogged by{" "}
              <ProfileUsernameLink usernameRaw={rebloggerRaw} className="text-inherit">
                {rebloggedBy}
              </ProfileUsernameLink>
            </p>
          </div>
        ) : null}
      </div>
    </article>
  );
}
