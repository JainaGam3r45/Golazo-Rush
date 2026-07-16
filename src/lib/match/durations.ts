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

/**
 * Ignore larger wall-clock gaps (tab blur, WebGL stalls, slow Phaser boot).
 * Uncapped catch-up can burn a full 10-min match in one tick (60s real × scale).
 */
export const MAX_CLOCK_ELAPSED_MS = 250;

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

export type MatchClockTickInput = {
  matchClockSeconds: number;
  elapsedMs: number;
  durationSeconds: number;
  half: 1 | 2;
  timeScale?: number;
  maxElapsedMs?: number;
};

export type MatchClockTickResult = {
  matchClockSeconds: number;
  remaining: number;
  /** True when the gap was dropped (stall / boot hitch) — clock unchanged. */
  skipped: boolean;
  shouldEnd: boolean;
  shouldHalftime: boolean;
};

/** Pure CPU match-clock step used by MatchScene (and unit tests). */
export function tickMatchClock(input: MatchClockTickInput): MatchClockTickResult {
  const timeScale = input.timeScale ?? MATCH_TIME_SCALE;
  const maxElapsedMs = input.maxElapsedMs ?? MAX_CLOCK_ELAPSED_MS;
  const durationSeconds = input.durationSeconds;

  if (!(input.elapsedMs > 0) || input.elapsedMs > maxElapsedMs) {
    const remaining = Math.max(0, Math.ceil(durationSeconds - input.matchClockSeconds));
    return {
      matchClockSeconds: input.matchClockSeconds,
      remaining,
      skipped: true,
      shouldEnd: remaining <= 0,
      shouldHalftime: false,
    };
  }

  const matchClockSeconds =
    input.matchClockSeconds + (input.elapsedMs / 1000) * timeScale;
  const remaining = Math.max(0, Math.ceil(durationSeconds - matchClockSeconds));
  const shouldEnd = remaining <= 0;
  const shouldHalftime =
    !shouldEnd &&
    input.half === 1 &&
    matchClockSeconds >= halfDurationSeconds(durationSeconds);

  return {
    matchClockSeconds,
    remaining,
    skipped: false,
    shouldEnd,
    shouldHalftime,
  };
}
