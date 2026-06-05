import { ORIGINAL_POST_DELETED_LABEL } from "@/lib/post-tombstone";

type Props = {
  className?: string;
};

/** Shown when a thread root was tombstoned but the row remains for reblog chains. */
export default function OriginalPostDeleted({ className = "" }: Props) {
  return (
    <p
      className={`text-meta italic leading-snug text-text-muted ${className}`.trim()}
      role="status"
    >
      {ORIGINAL_POST_DELETED_LABEL}
    </p>
  );
}
