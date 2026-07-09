import Phaser from 'phaser';
import { MatchScene } from '../scenes/MatchScene';
import type { MatchSetup } from '../../lib/match/setup';

export function createGameConfig(parent: string, setup: MatchSetup): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    width: 800,
    height: 500,
    parent,
    backgroundColor: '#1a5c1a',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      autoRound: true,
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    scene: [MatchScene],
    callbacks: {
      preBoot: (game) => {
        game.registry.set('matchSetup', setup);
      },
    },
  };
}
