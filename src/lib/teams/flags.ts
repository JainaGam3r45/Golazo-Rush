const TEAM_FLAGS: Record<string, string> = {
  brasil: '🇧🇷',
  japon: '🇯🇵',
  argentina: '🇦🇷',
  francia: '🇫🇷',
  alemania: '🇩🇪',
  espana: '🇪🇸',
  mexico: '🇲🇽',
  uruguay: '🇺🇾',
  inglaterra: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  portugal: '🇵🇹',
  colombia: '🇨🇴',
  marruecos: '🇲🇦',
};

export function getTeamFlagEmoji(teamId: string): string {
  return TEAM_FLAGS[teamId] ?? '⚽';
}
