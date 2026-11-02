import { describe, expect, it } from 'vitest';
import { FINAL_WINDOW_MS, FIRST_NOTICE_REMAINING_MS, noticeDue } from './expiryNotice';

const NOW = Date.parse('2026-11-02T00:00:00Z');

describe('noticeDue', () => {
  it('stays quiet outside the last week and after expiry', () => {
    expect(noticeDue(NOW + FIRST_NOTICE_REMAINING_MS + 60_000, NOW, null)).toBeNull();
    expect(noticeDue(NOW - 1, NOW, null)).toBeNull();
  });

  it('asks once when the last week is underway, then again in the last two days', () => {
    const inWeek = NOW + FINAL_WINDOW_MS + 24 * 60 * 60 * 1000;
    expect(noticeDue(inWeek, NOW, null)).toBe('week');
    expect(
      noticeDue(inWeek, NOW, { expiresAtMs: inWeek, weekShown: true, finalShown: false }),
    ).toBeNull();

    const ending = NOW + FINAL_WINDOW_MS - 60_000;
    expect(
      noticeDue(ending, NOW, { expiresAtMs: ending, weekShown: true, finalShown: false }),
    ).toBe('final');
    expect(
      noticeDue(ending, NOW, { expiresAtMs: ending, weekShown: true, finalShown: true }),
    ).toBeNull();
  });

  it('delivers the first reminder before the second when both windows have passed', () => {
    const ending = NOW + 12 * 60 * 60 * 1000;
    expect(noticeDue(ending, NOW, null)).toBe('week');
    expect(
      noticeDue(ending, NOW, { expiresAtMs: ending, weekShown: true, finalShown: false }),
    ).toBe('final');
  });

  it('starts over when the term changes', () => {
    const ending = NOW + 12 * 60 * 60 * 1000;
    const renewed = NOW + 30 * 24 * 60 * 60 * 1000;
    expect(
      noticeDue(renewed, NOW, { expiresAtMs: ending, weekShown: true, finalShown: true }),
    ).toBeNull();
    expect(
      noticeDue(ending, NOW, { expiresAtMs: renewed, weekShown: true, finalShown: true }),
    ).toBe('week');
  });
});
