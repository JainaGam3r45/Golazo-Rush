export type MatchFormatId = '5v5' | '11v11';

export const MATCH_FORMAT_IDS: MatchFormatId[] = ['5v5', '11v11'];

export const DEFAULT_MATCH_FORMAT: MatchFormatId = '11v11';

export type MatchFormatPreset = {
  id: MatchFormatId;
  label: string;
  shortLabel: string;
  description: string;
  /** Outfield players per side (excludes GK). */
  fieldPlayersPerSide: number;
  experimental?: boolean;
};

export const MATCH_FORMATS: Record<MatchFormatId, MatchFormatPreset> = {
  '5v5': {
    id: '5v5',
    label: '5v5 rápido',
    shortLabel: '5v5',
    description: 'Partido arcade rápido (1 GK + 4 de campo)',
    fieldPlayersPerSide: 4,
  },
  '11v11': {
    id: '11v11',
    label: '11v11 completo',
    shortLabel: '11v11',
    description: 'Formato completo experimental (1 GK + 10 de campo)',
    fieldPlayersPerSide: 10,
    experimental: true,
  },
};

export function isMatchFormatId(value: unknown): value is MatchFormatId {
  return typeof value === 'string' && value in MATCH_FORMATS;
}

export function getMatchFormat(id: MatchFormatId): MatchFormatPreset {
  return MATCH_FORMATS[id];
}

export function formatModeLabel(formatId: MatchFormatId): string {
  const format = MATCH_FORMATS[formatId];
  if (formatId === '5v5') {
    return format.experimental
      ? `${format.shortLabel} Contra bots · experimental`
      : `${format.shortLabel} Contra bots`;
  }
  if (format.experimental) {
    return `${format.shortLabel} Contra bots · experimental`;
  }
  return `${format.shortLabel} Contra bots`;
}
