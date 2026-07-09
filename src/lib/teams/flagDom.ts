import { getTeamFlagAlt, getTeamFlagHref } from './flags';

export function updateCountryFlagElement(
  flagEl: Element | null,
  teamId: string,
  teamName?: string,
): void {
  if (!flagEl) return;

  flagEl.setAttribute('data-team-id', teamId);
  flagEl.setAttribute('aria-label', getTeamFlagAlt(teamId, teamName));

  const use = flagEl.querySelector<SVGUseElement>('.country-flag__svg use');
  if (use) {
    use.setAttribute('href', getTeamFlagHref(teamId));
  }
}
