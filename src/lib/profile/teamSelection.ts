import { getSelectedTeam, setSelectedTeam } from '../storage/selectedTeam';
import { getAuthState, hydrateSession } from '../auth/session';
import { fetchProfile, updateSelectedTeam, upsertProfile } from './store';

export async function resolveSelectedTeam(): Promise<string | null> {
  await hydrateSession();
  const { user } = getAuthState();

  if (!user) {
    return getSelectedTeam();
  }

  const profile = await fetchProfile(user.id);

  if (profile?.selected_team_id) {
    setSelectedTeam(profile.selected_team_id);
    return profile.selected_team_id;
  }

  const localTeam = getSelectedTeam();
  if (localTeam) {
    await upsertProfile(user, { selected_team_id: localTeam });
    return localTeam;
  }

  return null;
}

export async function persistSelectedTeam(teamId: string): Promise<void> {
  setSelectedTeam(teamId);

  const { user } = getAuthState();
  if (!user) return;

  const profile = await fetchProfile(user.id);
  if (profile) {
    await updateSelectedTeam(user.id, teamId);
  } else {
    await upsertProfile(user, { selected_team_id: teamId });
  }
}
