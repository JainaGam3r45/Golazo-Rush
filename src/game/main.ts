import Phaser from 'phaser';
import { createGameConfig } from './config/gameConfig';
import type { MatchSetup } from '../lib/match/setup';

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
  return game;
}

export function destroyGame(): void {
  if (game) {
    game.destroy(true);
    game = null;
  }

  const container = document.getElementById('game-container');
  if (container) {
    container.innerHTML = '';
  }
}

export function isGameRunning(): boolean {
  return game !== null;
}

export function refreshGameScale(): void {
  if (!game) return;
  game.scale.refresh();
}
