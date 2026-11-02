/**
 * Two reminders during the last week a hosted project is online.
 * The first is due once fewer than 6.5 days remain, the second once fewer
 * than 2 days remain. A one-week term therefore does not pop up at the
 * instant it is published. Opening the app only in the last two days still
 * yields both reminders, one after the other.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const LAST_WEEK_MS = 7 * DAY_MS;
export const FIRST_NOTICE_REMAINING_MS = LAST_WEEK_MS - 12 * 60 * 60 * 1000;
export const FINAL_WINDOW_MS = 2 * DAY_MS;

export type NoticeSlot = 'week' | 'final';

export interface NoticeLog {
  expiresAtMs: number;
  weekShown: boolean;
  finalShown: boolean;
}

const KEY = 'gridstage-expiry-notices';

export function noticeDue(
  expiresAtMs: number,
  now: number,
  log: NoticeLog | null,
): NoticeSlot | null {
  const remaining = expiresAtMs - now;
  if (remaining <= 0 || remaining > FIRST_NOTICE_REMAINING_MS) return null;
  const current =
    log !== null && log.expiresAtMs === expiresAtMs
      ? log
      : { expiresAtMs, weekShown: false, finalShown: false };
  if (!current.weekShown) return 'week';
  if (remaining <= FINAL_WINDOW_MS && !current.finalShown) return 'final';
  return null;
}

function readAll(): Record<string, NoticeLog> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? {} : (JSON.parse(raw) as Record<string, NoticeLog>);
  } catch {
    return {};
  }
}

export function readNoticeLog(shareId: string): NoticeLog | null {
  return readAll()[shareId] ?? null;
}

export function markNoticeShown(shareId: string, expiresAtMs: number, slot: NoticeSlot): void {
  const all = readAll();
  const current =
    all[shareId] !== undefined && all[shareId].expiresAtMs === expiresAtMs
      ? all[shareId]
      : { expiresAtMs, weekShown: false, finalShown: false };
  all[shareId] = {
    expiresAtMs,
    weekShown: current.weekShown || slot === 'week',
    finalShown: current.finalShown || slot === 'final',
  };
  localStorage.setItem(KEY, JSON.stringify(all));
}
