/**
 * Single source of truth for match controls. Scheme B defaults (WASD move,
 * Espacio shoot, clic izq pase, clic der entrada, Shift sprint, Q despeje),
 * persisted in localStorage so the player can remap keys and mouse buttons.
 */

export type ControlAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'sprint'
  | 'shoot'
  | 'pass'
  | 'tackle'
  | 'clear';

export type MouseBind = 'mouseLeft' | 'mouseRight' | 'mouseMiddle';

/** A bind is either a Phaser key-code name (e.g. `W`, `SPACE`) or a mouse button. */
export type Bind = string;

export type ControlBindings = Record<ControlAction, Bind>;

export const CONTROL_ACTIONS: ControlAction[] = [
  'up',
  'down',
  'left',
  'right',
  'sprint',
  'shoot',
  'pass',
  'tackle',
  'clear',
];

export const DEFAULT_BINDINGS: ControlBindings = {
  up: 'W',
  down: 'S',
  left: 'A',
  right: 'D',
  sprint: 'SHIFT',
  shoot: 'SPACE',
  pass: 'mouseLeft',
  tackle: 'mouseRight',
  clear: 'Q',
};

const STORAGE_KEY = 'golazo.controls.v1';
const TUTORIAL_KEY = 'golazo.controls.tutorialSeen';
const CONTROLS_CHANGED_EVENT = 'golazo:controls-changed';

export const ACTION_LABELS: Record<ControlAction, string> = {
  up: 'Mover arriba',
  down: 'Mover abajo',
  left: 'Mover izquierda',
  right: 'Mover derecha',
  sprint: 'Sprint',
  shoot: 'Tiro',
  pass: 'Pase',
  tackle: 'Entrada',
  clear: 'Despeje / pase largo',
};

const DIGIT_NAMES = [
  'ZERO',
  'ONE',
  'TWO',
  'THREE',
  'FOUR',
  'FIVE',
  'SIX',
  'SEVEN',
  'EIGHT',
  'NINE',
];

const SPECIAL_BIND_LABELS: Record<string, string> = {
  SPACE: 'Espacio',
  SHIFT: 'Shift',
  CTRL: 'Ctrl',
  ALT: 'Alt',
  ENTER: 'Intro',
  TAB: 'Tab',
  ESC: 'Esc',
  BACKSPACE: 'Retroceso',
  UP: 'Flecha ↑',
  DOWN: 'Flecha ↓',
  LEFT: 'Flecha ←',
  RIGHT: 'Flecha →',
  mouseLeft: 'Clic izquierdo',
  mouseRight: 'Clic derecho',
  mouseMiddle: 'Clic central',
};

const KEY_CODE_TO_BIND: Record<string, Bind> = {
  Space: 'SPACE',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  ControlLeft: 'CTRL',
  ControlRight: 'CTRL',
  AltLeft: 'ALT',
  AltRight: 'ALT',
  Enter: 'ENTER',
  Tab: 'TAB',
  Escape: 'ESC',
  Backspace: 'BACKSPACE',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
};

export function isMouseBind(bind: Bind): bind is MouseBind {
  return bind === 'mouseLeft' || bind === 'mouseRight' || bind === 'mouseMiddle';
}

export function bindLabel(bind: Bind): string {
  if (!bind) return '—';
  if (SPECIAL_BIND_LABELS[bind]) return SPECIAL_BIND_LABELS[bind];
  const digit = DIGIT_NAMES.indexOf(bind);
  if (digit >= 0) return String(digit);
  return bind;
}

function normalizeBindings(input: unknown): ControlBindings {
  const out: ControlBindings = { ...DEFAULT_BINDINGS };
  if (input && typeof input === 'object') {
    const source = input as Record<string, unknown>;
    for (const action of CONTROL_ACTIONS) {
      const value = source[action];
      if (typeof value === 'string' && value) out[action] = value;
    }
  }
  return out;
}

export function loadBindings(): ControlBindings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_BINDINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BINDINGS };
    return normalizeBindings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveBindings(bindings: ControlBindings): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CONTROLS_CHANGED_EVENT));
  }
}

export function resetToDefaults(): ControlBindings {
  const defaults = { ...DEFAULT_BINDINGS };
  saveBindings(defaults);
  return defaults;
}

/** Actions grouped by the bind they share, only where more than one collides. */
export function findConflicts(bindings: ControlBindings): Record<Bind, ControlAction[]> {
  const byBind: Record<Bind, ControlAction[]> = {};
  for (const action of CONTROL_ACTIONS) {
    const bind = bindings[action];
    (byBind[bind] ??= []).push(action);
  }
  const conflicts: Record<Bind, ControlAction[]> = {};
  for (const [bind, actions] of Object.entries(byBind)) {
    if (actions.length > 1) conflicts[bind] = actions;
  }
  return conflicts;
}

export function conflictingActions(bindings: ControlBindings): Set<ControlAction> {
  const set = new Set<ControlAction>();
  for (const actions of Object.values(findConflicts(bindings))) {
    for (const action of actions) set.add(action);
  }
  return set;
}

/** Translate a browser keyboard event into a Phaser-compatible key bind. */
export function bindFromKeyboardEvent(event: KeyboardEvent): Bind | null {
  const code = event.code;
  if (KEY_CODE_TO_BIND[code]) return KEY_CODE_TO_BIND[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return DIGIT_NAMES[Number(code.slice(5))];
  if (/^Numpad[0-9]$/.test(code)) return DIGIT_NAMES[Number(code.slice(6))];
  return null;
}

export function bindFromMouseButton(button: number): MouseBind | null {
  if (button === 0) return 'mouseLeft';
  if (button === 1) return 'mouseMiddle';
  if (button === 2) return 'mouseRight';
  return null;
}

export function hasSeenControlsTutorial(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(TUTORIAL_KEY) === 'true';
}

export function markControlsTutorialSeen(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(TUTORIAL_KEY, 'true');
}

export const CONTROLS_CHANGED = CONTROLS_CHANGED_EVENT;
