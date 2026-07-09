const TEAM_FLAG_FILES: Record<string, string> = {
  brasil: 'br.svg',
  japon: 'jp.svg',
  argentina: 'ar.svg',
  francia: 'fr.svg',
  alemania: 'de.svg',
  espana: 'es.svg',
  mexico: 'mx.svg',
  uruguay: 'uy.svg',
  inglaterra: 'gb-eng.svg',
  portugal: 'pt.svg',
  colombia: 'co.svg',
  marruecos: 'ma.svg',
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

export function getTeamFlagSrc(teamId: string): string {
  const file = TEAM_FLAG_FILES[teamId];
  return file ? `/flags/${file}` : '/flags/br.svg';
}

export function getTeamFlagAlt(teamId: string, teamName?: string): string {
  const name = teamName ?? TEAM_DISPLAY_NAMES[teamId] ?? teamId;
  return `Bandera de ${name}`;
}
