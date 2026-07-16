import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_BINDINGS,
  bindFromKeyboardEvent,
  bindFromMouseButton,
  bindLabel,
  conflictingActions,
  findConflicts,
  isMouseBind,
  loadBindings,
} from '../../src/lib/match/controlBindings.ts';

describe('control bindings', () => {
  it('defaults follow scheme B', () => {
    assert.equal(DEFAULT_BINDINGS.up, 'W');
    assert.equal(DEFAULT_BINDINGS.shoot, 'SPACE');
    assert.equal(DEFAULT_BINDINGS.pass, 'mouseLeft');
    assert.equal(DEFAULT_BINDINGS.tackle, 'mouseRight');
    assert.equal(DEFAULT_BINDINGS.clear, 'Q');
  });

  it('loads defaults when no storage is available', () => {
    assert.deepEqual(loadBindings(), DEFAULT_BINDINGS);
  });

  it('detects mouse binds', () => {
    assert.ok(isMouseBind('mouseLeft'));
    assert.ok(isMouseBind('mouseRight'));
    assert.equal(isMouseBind('W'), false);
  });

  it('reports no conflicts for the defaults', () => {
    assert.equal(conflictingActions(DEFAULT_BINDINGS).size, 0);
  });

  it('flags actions that share a bind', () => {
    const clashing = { ...DEFAULT_BINDINGS, tackle: 'Q' };
    const conflicts = findConflicts(clashing);
    assert.deepEqual(new Set(conflicts.Q), new Set(['tackle', 'clear']));
    assert.deepEqual(conflictingActions(clashing), new Set(['tackle', 'clear']));
  });

  it('maps keyboard events to Phaser key names', () => {
    assert.equal(bindFromKeyboardEvent({ code: 'KeyW' } as KeyboardEvent), 'W');
    assert.equal(bindFromKeyboardEvent({ code: 'Space' } as KeyboardEvent), 'SPACE');
    assert.equal(bindFromKeyboardEvent({ code: 'ShiftLeft' } as KeyboardEvent), 'SHIFT');
    assert.equal(bindFromKeyboardEvent({ code: 'Digit1' } as KeyboardEvent), 'ONE');
    assert.equal(bindFromKeyboardEvent({ code: 'F13' } as KeyboardEvent), null);
  });

  it('maps mouse buttons and labels them in Spanish', () => {
    assert.equal(bindFromMouseButton(0), 'mouseLeft');
    assert.equal(bindFromMouseButton(2), 'mouseRight');
    assert.equal(bindLabel('mouseLeft'), 'Clic izquierdo');
    assert.equal(bindLabel('SPACE'), 'Espacio');
    assert.equal(bindLabel('ONE'), '1');
    assert.equal(bindLabel('W'), 'W');
  });
});
