export type FormationId = '4-3-3' | '4-4-2' | '3-5-2' | '4-2-3-1';

export const FORMATION_IDS: FormationId[] = ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1'];

export const DEFAULT_FORMATION: FormationId = '4-4-2';
export const CPU_DEFAULT_FORMATION: FormationId = '4-4-2';

export type FormationPreset = {
  id: FormationId;
  name: string;
  label: string;
  label5v5: string;
  label11v11: string;
  pressWeight: number;
  lineHeight: number;
  shootDistance: number;
};

export const FORMATIONS: Record<FormationId, FormationPreset> = {
  '4-3-3': {
    id: '4-3-3',
    name: '4-3-3 Ofensiva',
    label: '4-3-3 Ofensiva',
    label5v5: '4-3-3 Ofensiva (5v5 arcade)',
    label11v11: '4-3-3 Ofensiva (11v11)',
    pressWeight: 1.25,
    lineHeight: 0.72,
    shootDistance: 300,
  },
  '4-4-2': {
    id: '4-4-2',
    name: '4-4-2 Equilibrada',
    label: '4-4-2 Equilibrada',
    label5v5: '4-4-2 Equilibrada (5v5 arcade)',
    label11v11: '4-4-2 Equilibrada (11v11)',
    pressWeight: 1.0,
    lineHeight: 0.55,
    shootDistance: 280,
  },
  '3-5-2': {
    id: '3-5-2',
    name: '3-5-2 Presión',
    label: '3-5-2 Presión',
    label5v5: '3-5-2 Presión (5v5 arcade)',
    label11v11: '3-5-2 Presión (11v11)',
    pressWeight: 1.15,
    lineHeight: 0.65,
    shootDistance: 270,
  },
  '4-2-3-1': {
    id: '4-2-3-1',
    name: '4-2-3-1 Control',
    label: '4-2-3-1 Control',
    label5v5: '4-2-3-1 Control (5v5 arcade)',
    label11v11: '4-2-3-1 Control (11v11)',
    pressWeight: 0.85,
    lineHeight: 0.42,
    shootDistance: 260,
  },
};

export function isFormationId(value: unknown): value is FormationId {
  return typeof value === 'string' && value in FORMATIONS;
}

export function getFormation(id: FormationId): FormationPreset {
  return FORMATIONS[id];
}

export function formationLabelForFormat(
  id: FormationId,
  formatId: '5v5' | '11v11' = '5v5',
): string {
  const formation = FORMATIONS[id];
  return formatId === '11v11' ? formation.label11v11 : formation.label5v5;
}
