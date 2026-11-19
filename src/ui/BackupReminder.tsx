import { reminderFor, type FileCopy } from '../fileCopies';

/** One quiet line above the page when the open project has work in it that is in no file and has been that way for a
 *  while (see reminderFor for how long). It never stands in the way: Save a copy, or dismiss it and it stays away for
 *  a few days. `now` can be handed in so the timing can be tested. */
export function BackupReminder({
  copy,
  onSave,
  onDismiss,
  now = Date.now,
}: {
  copy: FileCopy | undefined;
  onSave: () => void;
  onDismiss: () => void;
  now?: () => number;
}) {
  const r = reminderFor(copy, now());
  if (!r) return null;
  return (
    <div className="notice row msg backup-reminder" role="status">
      <span>{r.text}</span>
      <button type="button" className="btn small" onClick={onSave}>
        Save a copy
      </button>
      <button
        type="button"
        className="x"
        title="Not now"
        aria-label="Dismiss this reminder for a few days"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
