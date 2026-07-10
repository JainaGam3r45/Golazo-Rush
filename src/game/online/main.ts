import Phaser from 'phaser';
import { OnlineMatchScene, buildOnlineMatchSetup } from './OnlineMatchScene';
import type { OnlineMatchStartDetail } from '../../lib/match/onlineClient';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import { registerGameScaleRefresh } from '../../lib/match/gameBridge';
import { stopMatchAudio } from '../audio/matchAudio';

let onlineGame: Phaser.Game | null = null;

export function createOnlineGameConfig(
  parent: string,
  detail: OnlineMatchStartDetail,
): Phaser.Types.Core.GameConfig {
  const setup = buildOnlineMatchSetup(detail);
  return {
    type: Phaser.AUTO,
    width: PITCH_WIDTH,
    height: PITCH_HEIGHT,
    parent,
    backgroundColor: '#1a5c1a',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      autoRound: true,
    },
    // No arcade sim — server is authority; sprites are kinematic.
    scene: [OnlineMatchScene],
    callbacks: {
      preBoot: (game) => {
        game.registry.set('matchSetup', setup);
        game.registry.set('onlineMatch', detail);
      },
    },
  };
}

export function startOnlineGame(
  parentId: string,
  detail: OnlineMatchStartDetail,
): Phaser.Game | null {
  if (typeof window === 'undefined') return null;
  const parent = document.getElementById(parentId);
  if (!parent) return null;

  destroyOnlineGame();
  parent.innerHTML = '';
  onlineGame = new Phaser.Game(createOnlineGameConfig(parentId, detail));
  registerGameScaleRefresh(() => {
    onlineGame?.scale.refresh();
  });
  return onlineGame;
}

export function destroyOnlineGame(): void {
  if (!onlineGame) return;

  registerGameScaleRefresh(null);
  onlineGame.destroy(true, false);
  onlineGame = null;

  const container = document.getElementById('game-container');
  if (container) {
    container.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
    container.innerHTML = '';
  }
  stopMatchAudio();
}

export function isOnlineGameRunning(): boolean {
  return onlineGame !== null;
}
