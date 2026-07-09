import type { LiveEventCreatedPayload } from './types';

const teamNames: Record<string, string> = {};

export function setTeamNames(names: Record<string, string>): void {
  Object.assign(teamNames, names);
}

function eventLabel(type: string): string {
  if (type === 'goal') return 'marcó un gol contra';
  if (type === 'win') return 'venció a';
  return 'empató con';
}

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `hace ${hours} h`;
}

function teamName(id: string | null | undefined): string {
  if (!id) return '—';
  return teamNames[id] ?? id;
}

export function prependActivityEvent(payload: Record<string, unknown>): void {
  const event = payload as unknown as LiveEventCreatedPayload;
  const feed = document.querySelector<HTMLUListElement>('[data-activity-feed]');
  if (!feed) return;

  const teamId = event.teamId ?? '';
  const opponentId = event.opponentId ?? '';
  const minuteHtml =
    event.type === 'goal' && event.minute
      ? `<span class="activity-feed__minute"> (${event.minute}')</span>`
      : '';

  const item = document.createElement('li');
  item.className = 'activity-feed__item';
  item.dataset.eventId = String(event.id);
  item.innerHTML = `
    <span class="activity-feed__time">${formatRelativeTime(event.createdAt)}</span>
    <p class="activity-feed__text">
      <strong>${teamName(teamId)}</strong>
      ${eventLabel(event.type)}
      <strong>${teamName(opponentId)}</strong>
      ${minuteHtml}
    </p>
  `;

  feed.prepend(item);

  const items = feed.querySelectorAll('.activity-feed__item');
  if (items.length > 8) {
    items[items.length - 1]?.remove();
  }
}

export function updateRankingRow(payload: Record<string, unknown>): void {
  const row = document.querySelector<HTMLElement>(`[data-team-id="${payload.teamId}"]`);
  if (!row) return;

  const rankEl = row.querySelector('[data-rank]');
  const pointsEl = row.querySelector('[data-points]');
  const recordEl = row.querySelector('[data-record]');
  const gdEl = row.querySelector('[data-goal-diff]');

  if (rankEl) rankEl.textContent = `#${payload.rank}`;
  if (pointsEl) pointsEl.textContent = `${payload.points} pts`;

  if (recordEl) {
    recordEl.textContent = `${payload.wins}G · ${payload.draws}E · ${payload.losses}P`;
  }

  if (gdEl) {
    const goalsFor = Number(payload.goalsFor);
    const goalsAgainst = Number(payload.goalsAgainst);
    const diff = goalsFor - goalsAgainst;
    const diffLabel = diff >= 0 ? `+${diff}` : String(diff);
    gdEl.textContent = `${goalsFor}:${goalsAgainst} (${diffLabel})`;
  }

  row.dataset.rank = String(payload.rank);
  reorderRankingRows();
}

function reorderRankingRows(): void {
  const list = document.querySelector('[data-ranking-list]');
  if (!list) return;

  const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-team-id]'));
  rows.sort((a, b) => Number(a.dataset.rank) - Number(b.dataset.rank));
  for (const row of rows) {
    list.appendChild(row);
  }
}

export function appendLobbyMatch(
  payload: { matchId: string; homeTeamId: string; awayTeamId: string; status: string },
  listSelector: string,
): void {
  const list = document.querySelector<HTMLUListElement>(listSelector);
  if (!list) return;
  if (list.querySelector(`[data-match-id="${payload.matchId}"]`)) return;

  const item = document.createElement('li');
  item.className = 'lobby-panel__match';
  item.dataset.matchId = payload.matchId;
  item.innerHTML = `
    <span class="lobby-panel__match-teams">${teamName(payload.homeTeamId)} vs ${teamName(payload.awayTeamId)}</span>
    <span class="lobby-panel__match-status">${payload.status === 'open' ? 'Abierta' : payload.status}</span>
  `;
  list.appendChild(item);
}

export function removeLobbyMatch(matchId: string, listSelector: string): void {
  const list = document.querySelector(listSelector);
  list?.querySelector(`[data-match-id="${matchId}"]`)?.remove();
}

export function renderLobbyPresence(
  members: Array<{ presenceId: string }>,
  listSelector: string,
): void {
  const list = document.querySelector<HTMLUListElement>(listSelector);
  if (!list) return;

  list.innerHTML = '';
  const shown = members.slice(0, 12);
  for (const member of shown) {
    const item = document.createElement('li');
    item.className = 'lobby-panel__player';
    item.textContent = `Jugador ${member.presenceId.slice(0, 6)}`;
    list.appendChild(item);
  }

  if (members.length > 12) {
    const more = document.createElement('li');
    more.className = 'lobby-panel__player lobby-panel__player--more';
    more.textContent = `+${members.length - 12} más`;
    list.appendChild(more);
  }
}
