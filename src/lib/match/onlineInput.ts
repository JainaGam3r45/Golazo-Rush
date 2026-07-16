import type { OnlineInputButtons } from './onlineProtocol.ts';
import { emptyButtons } from './onlineProtocol.ts';

export type KeyboardLike = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  shoot: boolean;
  pass: boolean;
  tackle: boolean;
  clear: boolean;
};

/** Map held control actions into protocol buttons. */
export function mapKeysToButtons(keys: KeyboardLike): OnlineInputButtons {
  return {
    up: keys.up,
    down: keys.down,
    left: keys.left,
    right: keys.right,
    sprint: keys.sprint,
    shoot: keys.shoot,
    pass: keys.pass,
    tackle: keys.tackle,
    clear: keys.clear,
  };
}

export function buttonsEqual(a: OnlineInputButtons, b: OnlineInputButtons): boolean {
  return (
    a.up === b.up &&
    a.down === b.down &&
    a.left === b.left &&
    a.right === b.right &&
    a.sprint === b.sprint &&
    a.shoot === b.shoot &&
    a.pass === b.pass &&
    a.tackle === b.tackle &&
    a.clear === b.clear
  );
}

/** Aim angle in radians from movement, else facing goal by side. */
export function aimFromButtons(
  buttons: OnlineInputButtons,
  side: 'home' | 'away',
): number {
  let dx = 0;
  let dy = 0;
  if (buttons.left) dx -= 1;
  if (buttons.right) dx += 1;
  if (buttons.up) dy -= 1;
  if (buttons.down) dy += 1;
  if (dx !== 0 || dy !== 0) {
    return Math.atan2(dy, dx);
  }
  return side === 'home' ? 0 : Math.PI;
}

export function createInputSampler(opts?: {
  edgeShoot?: boolean;
  edgePass?: boolean;
  edgeTackle?: boolean;
  edgeClear?: boolean;
}): {
  sample(held: KeyboardLike): OnlineInputButtons;
  reset(): void;
} {
  let prev = emptyButtons();
  const edgeShoot = opts?.edgeShoot ?? true;
  const edgePass = opts?.edgePass ?? true;
  const edgeTackle = opts?.edgeTackle ?? true;
  const edgeClear = opts?.edgeClear ?? true;

  return {
    sample(held) {
      const next = mapKeysToButtons(held);
      const out: OnlineInputButtons = {
        ...next,
        shoot: edgeShoot ? next.shoot && !prev.shoot : next.shoot,
        pass: edgePass ? next.pass && !prev.pass : next.pass,
        tackle: edgeTackle ? next.tackle && !prev.tackle : next.tackle,
        clear: edgeClear ? next.clear && !prev.clear : next.clear,
      };
      prev = next;
      return out;
    },
    reset() {
      prev = emptyButtons();
    },
  };
}
