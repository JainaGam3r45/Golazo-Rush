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

export function isSetPiece(phase: MatchPhase): boolean {
  return phase === 'setPiece';
}

export function canStartStoppage(phase: MatchPhase): boolean {
  return phase === 'playing';
}

/** Out / foul detection only while the ball is live. */
export function canDetectOut(phase: MatchPhase): boolean {
  return phase === 'playing';
}
