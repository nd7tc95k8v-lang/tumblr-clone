"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { FeedPost } from "@/types/post";
import { displayTagsForPost } from "@/lib/tags";
import {
  bodyFromPost,
  formatPostTime,
  postProfileAvatars,
  postProfileLinkRaw,
  usernameFromEmbed,
} from "@/lib/feed-post-display";
import ProfileAvatar from "./ProfileAvatar";
import ProfileUsernameLink from "./ProfileUsernameLink";
import ReblogModal from "./ReblogModal";

type Props = {
  post: FeedPost;
  rebloggingId: string | null;
  onReblog: (post: FeedPost, commentary?: string | null) => void | Promise<void>;
  showReblog?: boolean;
};

export default function PostCard({ post, rebloggingId, onReblog, showReblog = true }: Props) {
  const [reblogModalPost, setReblogModalPost] = useState<FeedPost | null>(null);
  const [reblogModalBusy, setReblogModalBusy] = useState(false);
  const { primary, rebloggedBy, isReblog } = usernameFromEmbed(post);
  const { primaryRaw, rebloggerRaw } = postProfileLinkRaw(post);
  const { primaryAvatarUrl, rebloggerAvatarUrl } = postProfileAvatars(post);
  const { content, imageSrc } = bodyFromPost(post);
  const tags = displayTagsForPost(post);
  const commentary = post.reblog_commentary?.trim() || null;

  return (
    <article className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4">
      <div className="flex gap-3">
        <ProfileAvatar url={primaryAvatarUrl} label={primary} size="md" className="mt-0.5" />
        <div className="min-w-0 flex-1">
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
          {tags.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2 list-none p-0">
              {tags.map((t) => (
                <li key={t}>
                  <Link
                    href={`/tag/${encodeURIComponent(t)}`}
                    className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-200 text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                  >
                    #{t}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-zinc-400 dark:text-zinc-500">{formatPostTime(post.created_at)}</p>
              {showReblog ? (
                <button
                  type="button"
                  disabled={rebloggingId !== null}
                  onClick={() => setReblogModalPost(post)}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {rebloggingId === post.id ? "Reblogging…" : "Reblog"}
                </button>
              ) : null}
            </div>
            {isReblog ? (
              <div className="text-right text-xs text-zinc-500 dark:text-zinc-400 sm:max-w-[55%] shrink-0">
                {commentary ? (
                  <p className="text-sm text-zinc-800 dark:text-zinc-100 whitespace-pre-wrap mb-2 leading-snug">
                    {commentary}
                  </p>
                ) : null}
                <p>
                  Original post by{" "}
                  <ProfileUsernameLink usernameRaw={primaryRaw} className="text-inherit">
                    {primary}
                  </ProfileUsernameLink>
                </p>
                {rebloggedBy ? (
                  <div className="flex items-center gap-2 justify-end mt-1">
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      Reblogged by{" "}
                      <ProfileUsernameLink usernameRaw={rebloggerRaw} className="text-inherit">
                        {rebloggedBy}
                      </ProfileUsernameLink>
                    </p>
                    <ProfileAvatar url={rebloggerAvatarUrl} label={rebloggedBy} size="sm" />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <ReblogModal
        post={reblogModalPost}
        busy={reblogModalBusy}
        onClose={() => !reblogModalBusy && setReblogModalPost(null)}
        onConfirm={async (raw) => {
          if (!reblogModalPost) return;
          const trimmed = raw.trim();
          setReblogModalBusy(true);
          try {
            await onReblog(reblogModalPost, trimmed.length > 0 ? trimmed : null);
            setReblogModalPost(null);
          } finally {
            setReblogModalBusy(false);
          }
        }}
      />
    </article>
  );
}
