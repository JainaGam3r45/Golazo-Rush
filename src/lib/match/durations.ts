/** User-facing match lengths: 10 / 15 / 30 / 45 minutes (stored as seconds). */
export const ALLOWED_DURATIONS = [600, 900, 1800, 2700] as const;
export type MatchDuration = (typeof ALLOWED_DURATIONS)[number];

export const DEFAULT_DURATION: MatchDuration = 900;

/**
 * Arcade compression: 1 real second advances this many match-clock seconds.
 * 10 min → 60s real, 15 → 90s, 30 → 180s, 45 → 270s.
 */
export const MATCH_TIME_SCALE = 10;

export const HALFTIME_PAUSE_MS = 6_000;

export function validateDuration(seconds: unknown): MatchDuration {
  if (
    seconds === 600 ||
    seconds === 900 ||
    seconds === 1800 ||
    seconds === 2700
  ) {
    return seconds;
  }
  return DEFAULT_DURATION;
}

export function halfDurationSeconds(durationSeconds: number): number {
  return Math.max(1, Math.floor(durationSeconds / 2));
}

/** Real-time seconds needed to play the full match clock. */
export function realDurationSeconds(matchSeconds: number): number {
  return Math.max(1, Math.round(matchSeconds / MATCH_TIME_SCALE));
}

export function formatDurationLabel(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}
