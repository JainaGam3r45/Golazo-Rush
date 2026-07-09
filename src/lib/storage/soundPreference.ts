const STORAGE_KEY = 'golazo:sound-muted';

export function isSoundMuted(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setSoundMuted(muted: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, muted ? 'true' : 'false');
}

export function toggleSoundMuted(): boolean {
  const next = !isSoundMuted();
  setSoundMuted(next);
  return next;
}

export const DEFAULT_VOLUME = 0.35;
