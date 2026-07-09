import { insforge, isInsForgeConfigured } from '../insforge';
import { teams as mockTeams, type Team } from '../mock/teams';

type TeamRow = {
  id: string;
  name: string;
  code: string;
  color_primary: string;
  color_secondary: string;
};

const flagStyles: Record<string, Team['flagStyle']> = {
  argentina: 'horizontal',
  brasil: 'vertical',
  espana: 'horizontal',
  francia: 'vertical',
  alemania: 'horizontal',
  portugal: 'vertical',
  inglaterra: 'vertical',
  mexico: 'vertical',
  uruguay: 'horizontal',
  colombia: 'horizontal',
  japon: 'horizontal',
  marruecos: 'horizontal',
};

function mapTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    primary: row.color_primary,
    secondary: row.color_secondary,
    flagStyle: flagStyles[row.id] ?? 'horizontal',
  };
}

export async function getTeams(): Promise<Team[]> {
  if (!isInsForgeConfigured || !insforge) {
    return mockTeams;
  }

  const { data, error } = await insforge.database
    .from('teams')
    .select('id, name, code, color_primary, color_secondary')
    .order('name');

  if (error || !data?.length) {
    return mockTeams;
  }

  return data.map((row) => mapTeam(row as TeamRow));
}

export async function getTeamById(id: string): Promise<Team | undefined> {
  const teams = await getTeams();
  return teams.find((team) => team.id === id);
}
