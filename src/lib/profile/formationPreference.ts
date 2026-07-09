import type { FormationId } from '../match/formations';
import { DEFAULT_FORMATION } from '../match/formations';
import { getAuthState, hydrateSession } from '../auth/session';
import {
  getPreferredFormation,
  getPreferredFormationOrDefault,
  setPreferredFormation,
} from '../storage/preferredFormation';

export async function resolveFormationPreference(): Promise<FormationId> {
  await hydrateSession();
  const { user } = getAuthState();

  if (!user) {
    return DEFAULT_FORMATION;
  }

  // Futuro: cuando exista profiles.preferred_formation, sincronizar aquí
  // const profile = await fetchProfile(user.id);
  // if (profile?.preferred_formation) { ... }

  return getPreferredFormationOrDefault();
}

export async function persistFormationPreference(formationId: FormationId): Promise<void> {
  const { user } = getAuthState();

  if (!user) return;

  setPreferredFormation(formationId);

  // Futuro: cuando exista profiles.preferred_formation, sincronizar aquí
  // await upsertProfile(user, { preferred_formation: formationId });
}

export function getGuestFormation(): FormationId {
  return DEFAULT_FORMATION;
}
