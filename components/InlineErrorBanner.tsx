"use client";

type Props = {
  message: string | null;
  onDismiss: () => void;
  className?: string;
};

/** Small dismissible inline error (replaces blocking `alert()` for form-style flows). */
export function InlineErrorBanner({ message, onDismiss, className = "" }: Props) {
  if (!message?.trim()) return null;
  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-2 rounded-md border border-error/35 bg-error/10 px-3 py-2 text-sm text-text ${className}`}
    >
      <p className="min-w-0 flex-1 leading-snug text-error">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-error hover:bg-error/15"
        aria-label="Dismiss error"
      >
        Dismiss
      </button>
    </div>
  );
}
