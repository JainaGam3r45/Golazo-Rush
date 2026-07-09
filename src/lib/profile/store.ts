import { insforge, isInsForgeConfigured } from '../insforge';
import type { SessionUser } from '../auth/session';

export type UserProfile = {
  id: string;
  display_name: string | null;
  selected_team_id: string | null;
};

export async function fetchProfile(userId: string): Promise<UserProfile | null> {
  if (!isInsForgeConfigured || !insforge) return null;

  const { data, error } = await insforge.database
    .from('profiles')
    .select('id, display_name, selected_team_id')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data as UserProfile;
}

export async function upsertProfile(
  user: SessionUser,
  fields: { display_name?: string | null; selected_team_id?: string | null },
): Promise<UserProfile | null> {
  if (!isInsForgeConfigured || !insforge) return null;

  const existing = await fetchProfile(user.id);

  if (existing) {
    const { data, error } = await insforge.database
      .from('profiles')
      .update(fields)
      .eq('id', user.id)
      .select('id, display_name, selected_team_id')
      .maybeSingle();

    if (error || !data) return existing;
    return data as UserProfile;
  }

  const { data, error } = await insforge.database
    .from('profiles')
    .insert([{
      id: user.id,
      display_name: fields.display_name ?? user.name ?? null,
      selected_team_id: fields.selected_team_id ?? null,
    }])
    .select('id, display_name, selected_team_id')
    .maybeSingle();

  if (error || !data) return null;
  return data as UserProfile;
}

export async function updateSelectedTeam(userId: string, teamId: string): Promise<boolean> {
  if (!isInsForgeConfigured || !insforge) return false;

  const { error } = await insforge.database
    .from('profiles')
    .update({ selected_team_id: teamId })
    .eq('id', userId);

  return !error;
}
