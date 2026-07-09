import type { FormationId } from '../match/formations';
import { DEFAULT_FORMATION, isFormationId } from '../match/formations';

const STORAGE_KEY = 'golazo:preferred-formation';

export function getPreferredFormation(): FormationId | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isFormationId(value) ? value : null;
  } catch {
    return null;
  }
}

export function setPreferredFormation(formationId: FormationId): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, formationId);
  } catch {
    // localStorage unavailable
  }
}

export function clearPreferredFormation(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable
  }
}

export function getPreferredFormationOrDefault(): FormationId {
  return getPreferredFormation() ?? DEFAULT_FORMATION;
}
