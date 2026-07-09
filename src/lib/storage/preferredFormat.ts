import type { MatchFormatId } from '../match/formats';
import { DEFAULT_MATCH_FORMAT, isMatchFormatId } from '../match/formats';

const STORAGE_KEY = 'golazo:preferred-format';

export function getPreferredFormat(): MatchFormatId | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isMatchFormatId(value) ? value : null;
  } catch {
    return null;
  }
}

export function setPreferredFormat(formatId: MatchFormatId): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, formatId);
  } catch {
    // localStorage unavailable
  }
}

export function getPreferredFormatOrDefault(): MatchFormatId {
  return getPreferredFormat() ?? DEFAULT_MATCH_FORMAT;
}
