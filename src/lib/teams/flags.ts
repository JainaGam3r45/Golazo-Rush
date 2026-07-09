const TEAM_FLAG_CODES: Record<string, string> = {
  brasil: 'br',
  japon: 'jp',
  argentina: 'ar',
  francia: 'fr',
  alemania: 'de',
  espana: 'es',
  mexico: 'mx',
  uruguay: 'uy',
  inglaterra: 'gb-eng',
  portugal: 'pt',
  colombia: 'co',
  marruecos: 'ma',
};

const TEAM_DISPLAY_NAMES: Record<string, string> = {
  brasil: 'Brasil',
  japon: 'Japón',
  argentina: 'Argentina',
  francia: 'Francia',
  alemania: 'Alemania',
  espana: 'España',
  mexico: 'México',
  uruguay: 'Uruguay',
  inglaterra: 'Inglaterra',
  portugal: 'Portugal',
  colombia: 'Colombia',
  marruecos: 'Marruecos',
};

export function getTeamFlagCode(teamId: string): string {
  return TEAM_FLAG_CODES[teamId] ?? 'br';
}

export function getTeamFlagHref(teamId: string): string {
  return `#flag-${getTeamFlagCode(teamId)}`;
}

/** @deprecated Use getTeamFlagHref for sprite-based flags */
export function getTeamFlagSrc(teamId: string): string {
  const code = getTeamFlagCode(teamId);
  return `#flag-${code}`;
}

export function getTeamFlagAlt(teamId: string, teamName?: string): string {
  const name = teamName ?? TEAM_DISPLAY_NAMES[teamId] ?? teamId;
  return `Bandera de ${name}`;
}
