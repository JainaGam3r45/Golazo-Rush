import Phaser from 'phaser';
import {
  CONTROL_ACTIONS,
  CONTROLS_CHANGED,
  isMouseBind,
  loadBindings,
  type ControlAction,
  type ControlBindings,
  type MouseBind,
} from '../../lib/match/controlBindings';

type ActionState = Record<ControlAction, boolean>;
type MouseState = Record<MouseBind, boolean>;

function blankActions(): ActionState {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    sprint: false,
    shoot: false,
    pass: false,
    tackle: false,
    clear: false,
  };
}

/**
 * Reads live match input from the active bindings. Keyboard binds map to Phaser
 * keys; mouse binds track pointer buttons on the scene. Call `update()` once per
 * frame before reading edges with `justDown()`.
 */
export class ControlReader {
  private scene: Phaser.Scene;
  private bindings: ControlBindings;
  private keys = new Map<string, Phaser.Input.Keyboard.Key>();
  private mouse: MouseState = { mouseLeft: false, mouseRight: false, mouseMiddle: false };
  private held = blankActions();
  private prev = blankActions();

  constructor(scene: Phaser.Scene, bindings: ControlBindings = loadBindings()) {
    this.scene = scene;
    this.bindings = bindings;
    this.bindKeys();
    this.scene.input.mouse?.disableContextMenu();
    this.scene.input.on('pointerdown', this.syncMouse);
    this.scene.input.on('pointerup', this.syncMouse);
    if (typeof window !== 'undefined') {
      window.addEventListener(CONTROLS_CHANGED, this.reload);
    }
  }

  private bindKeys(): void {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) return;
    for (const action of CONTROL_ACTIONS) {
      const bind = this.bindings[action];
      if (isMouseBind(bind) || this.keys.has(bind)) continue;
      try {
        this.keys.set(bind, keyboard.addKey(bind));
      } catch {
        // Unknown key name — leave the action without a keyboard bind.
      }
    }
  }

  private syncMouse = (pointer: Phaser.Input.Pointer): void => {
    this.mouse.mouseLeft = pointer.leftButtonDown();
    this.mouse.mouseRight = pointer.rightButtonDown();
    this.mouse.mouseMiddle = pointer.middleButtonDown();
  };

  private reload = (): void => {
    this.bindings = loadBindings();
    this.bindKeys();
  };

  isDown(action: ControlAction): boolean {
    const bind = this.bindings[action];
    if (isMouseBind(bind)) return this.mouse[bind];
    return this.keys.get(bind)?.isDown ?? false;
  }

  /** Snapshot current state so `justDown()` reflects this frame's edges. */
  update(): void {
    this.prev = this.held;
    const next = blankActions();
    for (const action of CONTROL_ACTIONS) next[action] = this.isDown(action);
    this.held = next;
  }

  justDown(action: ControlAction): boolean {
    return this.held[action] && !this.prev[action];
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.syncMouse);
    this.scene.input.off('pointerup', this.syncMouse);
    if (typeof window !== 'undefined') {
      window.removeEventListener(CONTROLS_CHANGED, this.reload);
    }
    this.keys.clear();
  }
}
