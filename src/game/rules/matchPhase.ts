export type MatchPhase =
  | 'playing'
  | 'stoppage'
  | 'setPiece'
  | 'foul'
  | 'penaltyStub'
  | 'goal';

export function isPlaying(phase: MatchPhase): boolean {
  return phase === 'playing';
}

export function canStartStoppage(phase: MatchPhase): boolean {
  return phase === 'playing';
}
