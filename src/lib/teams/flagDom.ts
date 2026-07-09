import { getTeamFlagAlt, getTeamFlagSrc } from './flags';

export function updateCountryFlagElement(
  flagEl: Element | null,
  teamId: string,
  teamName?: string,
): void {
  if (!flagEl) return;

  flagEl.setAttribute('data-team-id', teamId);
  flagEl.setAttribute('aria-label', teamName ?? teamId);

  const img = flagEl.querySelector<HTMLImageElement>('.country-flag__img');
  if (img) {
    img.src = getTeamFlagSrc(teamId);
    img.alt = getTeamFlagAlt(teamId, teamName);
  }
}
