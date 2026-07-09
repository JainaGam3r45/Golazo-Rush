import Phaser from 'phaser';
import { MatchScene } from '../scenes/MatchScene';
import type { MatchSetup } from '../../lib/match/setup';
import { PITCH_HEIGHT, PITCH_WIDTH } from './pitch';

export function createGameConfig(parent: string, setup: MatchSetup): Phaser.Types.Core.GameConfig {
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
