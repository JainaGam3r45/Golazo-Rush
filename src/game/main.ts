import Phaser from 'phaser';
import { createGameConfig } from './config/gameConfig';
import type { MatchSetup } from '../lib/match/setup';
import { registerGameScaleRefresh } from '../lib/match/gameBridge';
import { resetPossession } from './ai/possession';
import { stopMatchAudio } from './audio/matchAudio';
import { destroyOnlineGame, isOnlineGameRunning } from './online/main';

let game: Phaser.Game | null = null;

export function startGame(parentId: string, setup: MatchSetup): Phaser.Game | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const parent = document.getElementById(parentId);
  if (!parent) {
    return null;
  }

  destroyGame();

  parent.innerHTML = '';
  game = new Phaser.Game(createGameConfig(parentId, setup));
  registerGameScaleRefresh(refreshGameScale);
  return game;
}

export function destroyGame(): void {
  // Tear down online instance if present (CPU path must stay isolated otherwise).
  if (isOnlineGameRunning()) {
    destroyOnlineGame();
  }

  registerGameScaleRefresh(null);

  if (game) {
    // removeCanvas=true, noReturn=false — noReturn would clear Phaser globals
    // and prevent creating another Game without a full page reload.
    game.destroy(true, false);
    game = null;
  }

  const container = document.getElementById('game-container');
  if (container) {
    container.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
    container.innerHTML = '';
  }

  resetPossession();
  stopMatchAudio();
}

export function isGameRunning(): boolean {
  return game !== null;
}

export function refreshGameScale(): void {
  if (!game) return;
  game.scale.refresh();
}
