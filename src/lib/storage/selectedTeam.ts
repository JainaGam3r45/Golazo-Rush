const STORAGE_KEY = 'golazo:selected-team';

export function getSelectedTeam(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSelectedTeam(teamId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, teamId);
  } catch {
    // localStorage unavailable
  }
}

export function clearSelectedTeam(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable
  }
}
