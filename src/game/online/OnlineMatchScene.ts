import Phaser from 'phaser';
import type { MatchSetup } from '../../lib/match/setup';
import type { OnlineMatchStartDetail } from '../../lib/match/onlineClient';
import { createOnlineGameClient, type OnlineGameClient } from '../../lib/match/onlineClient';
import {
  createInputSampler,
  aimFromButtons,
  type KeyboardLike,
} from '../../lib/match/onlineInput';
import { areGameplayKeysSuspended } from '../../lib/match/inputSuspend';
import { ControlReader } from '../input/controlReader';
import {
  pushSnap,
  sampleInterpolatedFrame,
  softCorrect,
  type SnapBuffer,
} from '../../lib/match/onlineInterp';
import type { OnlineMatchSnap, OnlinePlayerSnap } from '../../lib/match/onlineProtocol';
import { createPlayerVisual, type PlayerVisual } from '../entities/playerVisual';
import {
  CENTER_CIRCLE_RADIUS,
  GOAL_BOTTOM,
  GOAL_CENTER_Y,
  GOAL_DEPTH,
  GOAL_HEIGHT,
  GOAL_TOP,
  PENALTY_BOX_HEIGHT,
  PENALTY_BOX_TOP,
  PENALTY_BOX_WIDTH,
  PITCH_HEIGHT,
  PITCH_MARGIN,
  PITCH_WIDTH,
} from '../config/pitch';
import { playerVisualScale } from '../config/spawnLayouts';
import { teams as mockTeams } from '../../lib/mock/teams';
import { formatMatchClock } from '../../lib/match/formatMatchClock';
import type { MatchEndedDetail } from '../../lib/realtime/types';
import { isFormationId, DEFAULT_FORMATION } from '../../lib/match/formations';
import { validateDuration } from '../../lib/match/setup';

const BALL_RADIUS = 12;
/** Keep ball above players sharing the same Y (players use depth = y). */
const BALL_DEPTH_OFFSET = 0.5;
const POSSESSION_RING_COLOR = 0xffe566;

function hexToNumber(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

function getTeamColor(teamId: string): number {
  const team = mockTeams.find((t) => t.id === teamId);
  return team ? hexToNumber(team.primary) : 0x3ddc84;
}

function updateScoreOverlay(home: number, away: number): void {
  const homeEl = document.getElementById('score-home');
  const awayEl = document.getElementById('score-away');
  if (homeEl) homeEl.textContent = String(home);
  if (awayEl) awayEl.textContent = String(away);
}

function updateMatchClock(secondsLeft: number): void {
  const clockEl = document.getElementById('match-clock');
  if (!clockEl) return;
  clockEl.textContent = formatMatchClock(secondsLeft);
}

function updateConnHud(text: string): void {
  const modeEl = document.getElementById('match-mode');
  if (modeEl) modeEl.textContent = text;
}

function emitHudStoppage(label: string, hint: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('golazo:match-stoppage', {
      detail: { label, hint },
    }),
  );
}

function emitMatchEnded(detail: MatchEndedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('golazo:match-ended', { detail }));
}

type RemoteSprite = {
  visual: PlayerVisual;
  youLabel: Phaser.GameObjects.Text | null;
  possessionRing: Phaser.GameObjects.Arc;
  side: 'home' | 'away';
  slot: number;
  kind: OnlinePlayerSnap['kind'];
  userId: string | null;
};

/**
 * Thin online scene: draws pitch like MatchScene, maps server snaps → sprites.
 * No local physics authority — inputs only go to the game server.
 */
export class OnlineMatchScene extends Phaser.Scene {
  private setup!: MatchSetup;
  private onlineDetail!: OnlineMatchStartDetail;
  private client: OnlineGameClient | null = null;
  private snapBuffer: SnapBuffer = { prev: null, next: null };
  private sprites = new Map<string, RemoteSprite>();
  private ballGfx!: Phaser.GameObjects.Container;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private controls: ControlReader | null = null;
  private sampler = createInputSampler();
  private localPlayerId: string | null = null;
  private predicted: { x: number; y: number } | null = null;
  private lastScore = { home: 0, away: 0 };
  private lastHudPhase = '';
  private matchEnded = false;
  private playerScale = 1;
  private statusText!: Phaser.GameObjects.Text;
  private pingText!: Phaser.GameObjects.Text;
  private spectateBanner: Phaser.GameObjects.Text | null = null;
  private isSpectator = false;
  private tornDown = false;

  constructor() {
    super('OnlineMatchScene');
  }

  init(): void {
    this.onlineDetail = this.game.registry.get('onlineMatch') as OnlineMatchStartDetail;
    this.setup = this.game.registry.get('matchSetup') as MatchSetup;
    this.playerScale = playerVisualScale('5v5');
    this.snapBuffer = { prev: null, next: null };
    this.sprites.clear();
    this.isSpectator = this.onlineDetail?.role === 'spectator';
    this.localPlayerId = this.isSpectator ? null : (this.onlineDetail?.localPlayerId ?? null);
    this.predicted = null;
    this.lastScore = { home: 0, away: 0 };
    this.matchEnded = false;
    this.tornDown = false;
    this.sampler.reset();
    this.spectateBanner = null;
  }

  create(): void {
    // game.destroy() emits `destroy` (not `shutdown`) — without this, WS + intervals leak.
    this.events.once('shutdown', this.teardownOnline, this);
    this.events.once('destroy', this.teardownOnline, this);

    this.drawPitch();
    this.drawGoals();
    this.createBall();

    this.statusText = this.add
      .text(16, 12, 'Conectando…', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '14px',
        color: '#d7ffe0',
        stroke: '#0a0f0a',
        strokeThickness: 3,
      })
      .setDepth(20)
      .setScrollFactor(0);

    this.pingText = this.add
      .text(PITCH_WIDTH - 16, 12, 'ping —', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '14px',
        color: '#9ad7a8',
        stroke: '#0a0f0a',
        strokeThickness: 3,
      })
      .setOrigin(1, 0)
      .setDepth(20)
      .setScrollFactor(0);

    if (this.isSpectator) {
      this.spectateBanner = this.add
        .text(PITCH_WIDTH / 2, 36, 'Espectando', {
          fontFamily: 'Bebas Neue, sans-serif',
          fontSize: '28px',
          color: '#ffe566',
          stroke: '#0a0f0a',
          strokeThickness: 4,
        })
        .setOrigin(0.5, 0)
        .setDepth(21)
        .setScrollFactor(0);
    }

    if (!this.isSpectator) {
      this.controls = new ControlReader(this);
    }

    updateScoreOverlay(0, 0);
    updateMatchClock(this.setup.durationSeconds);
    if (this.isSpectator) {
      updateConnHud('Espectando · conectando');
      emitHudStoppage('Espectando', 'Modo espectador: solo ves el partido, sin controles.');
    } else {
      updateConnHud('11v11 Online · conectando');
      emitHudStoppage('Conectando', 'Conectando al servidor de partida…');
    }

    this.client = createOnlineGameClient(
      {
        roomId: this.onlineDetail.roomId,
        role: this.isSpectator ? 'spectator' : 'player',
        matchSessionToken: this.onlineDetail.matchSessionToken,
        playerSide: this.setup.playerSide,
        fieldSlot: this.onlineDetail.fieldSlot ?? 0,
        localPlayerId: this.onlineDetail.localPlayerId,
        humans: this.onlineDetail.humans,
        durationSeconds: this.setup.durationSeconds,
        homeFormationId: this.onlineDetail.homeFormationId,
        awayFormationId: this.onlineDetail.awayFormationId,
        homeTeamId: this.onlineDetail.homeTeamId,
        awayTeamId: this.onlineDetail.awayTeamId,
        homeLineup: this.onlineDetail.homeLineup,
        awayLineup: this.onlineDetail.awayLineup,
        allowBots: this.onlineDetail.allowBots,
      },
      {
        onStatus: (status, detail) => {
          if (this.isSpectator) {
            const label =
              status === 'playing' || status === 'joined'
                ? 'Espectando'
                : status === 'reconnecting'
                  ? 'Espectando · reconectando'
                  : status === 'connecting' || status === 'authenticating'
                    ? 'Espectando · conectando'
                    : `Espectando · ${status}`;
            updateConnHud(label);
            this.statusText.setText(detail ? `${status}: ${detail}` : 'Espectando');
            if (status === 'playing' || status === 'joined') {
              emitHudStoppage('Espectando', 'Modo espectador: solo ves el partido, sin controles.');
            } else if (status === 'reconnecting') {
              emitHudStoppage('Reconectando', detail ?? 'Reconectando a la retransmisión…');
            } else if (status === 'error') {
              emitHudStoppage('Error de conexión', detail ?? 'No se pudo conectar al servidor.');
            }
            return;
          }
          const label =
            status === 'playing'
              ? '11v11 Online'
              : status === 'joined'
                ? '11v11 Online · en sala'
                : status === 'reconnecting'
                  ? '11v11 Online · reconectando'
                  : status === 'connecting' || status === 'authenticating'
                    ? '11v11 Online · conectando'
                    : `11v11 Online · ${status}`;
          updateConnHud(label);
          this.statusText.setText(detail ? `${status}: ${detail}` : status);
          if (status === 'playing') {
            emitHudStoppage('En juego', 'En juego: controla tu jugador (servidor autoritativo).');
          } else if (status === 'reconnecting') {
            emitHudStoppage('Reconectando', detail ?? 'Reconectando al partido…');
          } else if (status === 'error') {
            emitHudStoppage('Error de conexión', detail ?? 'No se pudo conectar al servidor.');
          }
        },
        onPing: (rtt) => {
          this.pingText.setText(`ping ${rtt} ms`);
        },
        onSnap: (snap) => this.onSnap(snap),
        onJoined: (msg) => {
          if (this.isSpectator) return;
          if (typeof msg.playerId === 'string') this.localPlayerId = msg.playerId;
        },
        onMatchJoined: (msg) => {
          if (this.isSpectator) return;
          if (typeof msg.playerId === 'string') this.localPlayerId = msg.playerId;
        },
        onFinished: (detail) => this.finishMatch(detail.homeScore, detail.awayScore),
        onError: (message) => {
          this.statusText.setText(message);
        },
      },
    );

    void this.client.connect().catch((err) => {
      const message = err instanceof Error ? err.message : 'Fallo de conexión';
      this.statusText.setText(message);
    });
  }

  /**
   * Drop WS/timers and remote sprites. Safe to call multiple times
   * (explicit destroyOnlineGame + Phaser destroy/shutdown events).
   */
  teardownOnline(): void {
    if (this.tornDown) return;
    this.tornDown = true;
    this.controls?.destroy();
    this.controls = null;
    this.client?.disconnect();
    this.client = null;
    this.snapBuffer = { prev: null, next: null };
    for (const sprite of this.sprites.values()) {
      try {
        sprite.visual.destroy();
        sprite.youLabel?.destroy();
        sprite.possessionRing.destroy();
      } catch {
        // scene may already be mid-destroy
      }
    }
    this.sprites.clear();
  }

  /** @deprecated Prefer teardownOnline — kept for callers expecting Phaser-style naming. */
  shutdown(): void {
    this.teardownOnline();
  }

  update(_time: number, delta: number): void {
    if (this.tornDown || this.matchEnded || !this.client) return;

    if (!this.isSpectator) {
      const held = this.readKeys();
      const buttons = this.sampler.sample(held);
      const aim = aimFromButtons(buttons, this.setup.playerSide);
      this.client.setButtons(buttons, aim);

      // Lightweight local prediction for the controlled human only.
      if (this.predicted && (buttons.up || buttons.down || buttons.left || buttons.right)) {
        const speed = buttons.sprint ? 330 : 220;
        let vx = 0;
        let vy = 0;
        if (buttons.left) vx -= 1;
        if (buttons.right) vx += 1;
        if (buttons.up) vy -= 1;
        if (buttons.down) vy += 1;
        const len = Math.hypot(vx, vy) || 1;
        this.predicted.x += (vx / len) * speed * (delta / 1000);
        this.predicted.y += (vy / len) * speed * (delta / 1000);
      }
    }

    const frame = sampleInterpolatedFrame(this.snapBuffer, Date.now());
    if (!frame) return;

    // Stub snapshots (pre game-sim) have no poses — keep waiting HUD.
    if (this.snapBuffer.next?.stub && frame.players.size === 0) {
      return;
    }

    this.ballGfx.setPosition(frame.ball.x, frame.ball.y);
    this.ballGfx.setDepth(frame.ball.y + BALL_DEPTH_OFFSET);
    this.ballShadow.setPosition(frame.ball.x + 1, frame.ball.y + 11);

    const controllerId = frame.ball.controllerId;
    const ballControlled = frame.ball.state === 'controlled' && !!controllerId;
    this.ballGfx.setAlpha(ballControlled ? 1 : 0.96);

    if (
      frame.score.home !== this.lastScore.home ||
      frame.score.away !== this.lastScore.away
    ) {
      this.lastScore = { ...frame.score };
      updateScoreOverlay(frame.score.home, frame.score.away);
    }

    const elapsedSeconds = Math.floor(frame.clockMs / 1000);
    const secondsLeft = Math.max(0, frame.durationSeconds - elapsedSeconds);
    updateMatchClock(secondsLeft);

    const hudKey = `${frame.phase}:${frame.half ?? 1}`;
    if (hudKey !== this.lastHudPhase) {
      this.lastHudPhase = hudKey;
      if (frame.phase === 'halftime') {
        this.statusText.setText('Descanso');
        emitHudStoppage('Descanso', 'Entretiempo. El segundo tiempo comienza en breve.');
      } else if (frame.phase === 'playing') {
        emitHudStoppage(
          this.isSpectator
            ? 'Espectando'
            : frame.half === 2
              ? '2ª parte'
              : '1ª parte',
          this.isSpectator
            ? 'Modo espectador: solo ves el partido, sin controles.'
            : 'En juego: controla tu jugador (servidor autoritativo).',
        );
      }
    }

    if (frame.phase === 'finished' || frame.phase === 'ended') {
      this.finishMatch(frame.score.home, frame.score.away);
      return;
    }

    for (const [id, pose] of frame.players) {
      this.ensureSprite(pose.meta);
      const sprite = this.sprites.get(id);
      if (!sprite) continue;

      let x = pose.x;
      let y = pose.y;
      const isLocal = !this.isSpectator && this.isLocalHuman(id, pose.meta);

      if (isLocal) {
        if (!this.predicted) this.predicted = { x, y };
        const corrected = softCorrect(this.predicted, { x, y }, 0.25, 56);
        this.predicted = corrected;
        x = corrected.x;
        y = corrected.y;
      }

      sprite.visual.sync(x, y, y, pose.vx, pose.vy);
      if (sprite.youLabel) {
        sprite.youLabel.setPosition(x, y - 30);
        sprite.youLabel.setDepth(y + 1);
      }

      const hasBall = !!controllerId && id === controllerId;
      sprite.possessionRing.setPosition(x, y);
      sprite.possessionRing.setDepth(y + 0.25);
      sprite.possessionRing.setVisible(hasBall);
      if (hasBall) {
        sprite.possessionRing.setStrokeStyle(2.5, POSSESSION_RING_COLOR, ballControlled ? 0.95 : 0.7);
      }
    }
  }

  private onSnap(snap: OnlineMatchSnap): void {
    if (snap.stub && snap.players.length === 0) {
      this.statusText.setText(
        this.isSpectator ? `Espectando · esperando partido · tick ${snap.tick}` : `Servidor stub · tick ${snap.tick}`,
      );
      return;
    }
    this.snapBuffer = pushSnap(this.snapBuffer, snap);
    if (this.isSpectator) {
      this.statusText.setText('Espectando');
      return;
    }
    if (!this.localPlayerId) {
      const fieldSlot = this.onlineDetail.fieldSlot ?? 0;
      const mine =
        snap.players.find(
          (p) =>
            p.kind === 'human' &&
            p.side === this.setup.playerSide &&
            p.slot === fieldSlot,
        ) ??
        snap.players.find((p) => p.kind === 'human' && p.side === this.setup.playerSide);
      if (mine) this.localPlayerId = mine.id;
    }
  }

  private isLocalHuman(id: string, meta: OnlinePlayerSnap): boolean {
    if (this.isSpectator) return false;
    if (this.localPlayerId) return id === this.localPlayerId;
    const fieldSlot = this.onlineDetail.fieldSlot ?? 0;
    return meta.kind === 'human' && meta.side === this.setup.playerSide && meta.slot === fieldSlot;
  }

  private finishMatch(homeScore: number, awayScore: number): void {
    if (this.matchEnded) return;
    this.matchEnded = true;
    this.teardownOnline();
    emitHudStoppage('Final', 'Partido online finalizado.');
    emitMatchEnded({
      localMatchId: this.setup.localMatchId || `online-${this.onlineDetail.roomId}`,
      homeTeamId: this.setup.homeTeamId,
      awayTeamId: this.setup.awayTeamId,
      homeScore,
      awayScore,
      durationSeconds: this.setup.durationSeconds,
      decidedBy: 'regulation',
    });
  }

  private readKeys(): KeyboardLike {
    const empty: KeyboardLike = {
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
    if (areGameplayKeysSuspended(this.game)) return empty;
    const c = this.controls;
    if (!c) return empty;
    return {
      up: c.isDown('up'),
      down: c.isDown('down'),
      left: c.isDown('left'),
      right: c.isDown('right'),
      sprint: c.isDown('sprint'),
      shoot: c.isDown('shoot'),
      pass: c.isDown('pass'),
      tackle: c.isDown('tackle'),
      clear: c.isDown('clear'),
    };
  }

  private ensureSprite(meta: OnlinePlayerSnap): void {
    if (this.sprites.has(meta.id)) return;
    const teamId = meta.side === 'home' ? this.setup.homeTeamId : this.setup.awayTeamId;
    const color = getTeamColor(teamId);
    const scale = this.playerScale;
    const width = Math.round(28 * scale);
    const height = Math.round(28 * scale);
    const visualKind =
      meta.kind === 'gk' ? 'goalkeeper' : meta.kind === 'human' ? 'human' : 'teammate';

    const visual = createPlayerVisual(this, meta.x, meta.y, {
      teamColor: color,
      kind: visualKind,
      slot: meta.slot,
      width,
      height,
    });

    let youLabel: Phaser.GameObjects.Text | null = null;
    const isLocal = this.isLocalHuman(meta.id, meta);
    if (isLocal) {
      youLabel = this.add
        .text(meta.x, meta.y - 30, 'Tú', {
          fontFamily: 'Bebas Neue, sans-serif',
          fontSize: '22px',
          color: '#3ddc84',
          stroke: '#0a0f0a',
          strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setDepth(meta.y + 1);
    }

    const possessionRing = this.add
      .circle(meta.x, meta.y, width * 0.88, POSSESSION_RING_COLOR, 0)
      .setStrokeStyle(2.5, POSSESSION_RING_COLOR, 0.9)
      .setDepth(meta.y + 0.25)
      .setVisible(false);

    this.sprites.set(meta.id, {
      visual,
      youLabel,
      possessionRing,
      side: meta.side,
      slot: meta.slot,
      kind: meta.kind,
      userId: meta.userId,
    });
  }

  private createBall(): void {
    this.ballShadow = this.add.ellipse(551, 336, 28, 11, 0x000000, 0.4);
    this.ballShadow.setDepth(1);
    const g = this.add.graphics();
    g.fillStyle(0x0a0f0a, 0.35);
    g.fillCircle(1, 2, BALL_RADIUS + 3);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(0, 0, BALL_RADIUS + 2);
    g.lineStyle(2, 0x3ddc84, 0.85);
    g.strokeCircle(0, 0, BALL_RADIUS + 2);
    g.fillStyle(0x1a1a1a, 1);
    g.fillCircle(0, -5, 3.4);
    g.fillCircle(5, 2, 3);
    g.fillCircle(-5, 2, 3);
    this.ballGfx = this.add.container(PITCH_WIDTH / 2, PITCH_HEIGHT / 2, [g]);
    this.ballGfx.setDepth(PITCH_HEIGHT / 2 + BALL_DEPTH_OFFSET);
  }

  private drawPitch(): void {
    const graphics = this.add.graphics();
    const stripeWidth = 80;
    const colors = [0x1e6b3a, 0x268a4a];

    for (let x = 0; x < PITCH_WIDTH; x += stripeWidth) {
      const stripeIdx = Math.floor(x / stripeWidth) % 2;
      graphics.fillStyle(colors[stripeIdx], 1);
      graphics.fillRect(x, 0, stripeWidth, PITCH_HEIGHT);
    }

    graphics.lineStyle(3, 0xffffff, 0.9);
    graphics.strokeRect(
      PITCH_MARGIN,
      PITCH_MARGIN,
      PITCH_WIDTH - PITCH_MARGIN * 2,
      PITCH_HEIGHT - PITCH_MARGIN * 2,
    );
    graphics.strokeCircle(PITCH_WIDTH / 2, PITCH_HEIGHT / 2, CENTER_CIRCLE_RADIUS);
    graphics.fillStyle(0xffffff, 0.9);
    graphics.fillCircle(PITCH_WIDTH / 2, PITCH_HEIGHT / 2, 4);

    graphics.beginPath();
    graphics.moveTo(PITCH_WIDTH / 2, PITCH_MARGIN);
    graphics.lineTo(PITCH_WIDTH / 2, PITCH_HEIGHT - PITCH_MARGIN);
    graphics.strokePath();

    graphics.strokeRect(PITCH_MARGIN, PENALTY_BOX_TOP, PENALTY_BOX_WIDTH, PENALTY_BOX_HEIGHT);
    graphics.strokeRect(
      PITCH_WIDTH - PITCH_MARGIN - PENALTY_BOX_WIDTH,
      PENALTY_BOX_TOP,
      PENALTY_BOX_WIDTH,
      PENALTY_BOX_HEIGHT,
    );
  }

  private drawGoals(): void {
    const homeColor = getTeamColor(this.setup.homeTeamId);
    const awayColor = getTeamColor(this.setup.awayTeamId);
    this.drawGoalStructure(0, homeColor);
    this.drawGoalStructure(PITCH_WIDTH - GOAL_DEPTH, awayColor, true);
  }

  private drawGoalStructure(x: number, color: number, mirror = false): void {
    const net = this.add.graphics();
    net.lineStyle(1, 0xffffff, 0.35);
    const postX = mirror ? x + GOAL_DEPTH : x;
    const innerX = mirror ? x : x + GOAL_DEPTH;
    net.lineBetween(postX, GOAL_TOP, postX, GOAL_BOTTOM);
    net.lineBetween(postX, GOAL_TOP, innerX, GOAL_TOP);
    net.lineBetween(postX, GOAL_BOTTOM, innerX, GOAL_BOTTOM);

    const goalRect = this.add.rectangle(
      x + GOAL_DEPTH / 2,
      GOAL_CENTER_Y,
      GOAL_DEPTH,
      GOAL_HEIGHT,
      color,
      0.2,
    );
    goalRect.setStrokeStyle(2, color, 0.7);
  }
}

export function buildOnlineMatchSetup(detail: OnlineMatchStartDetail): MatchSetup {
  const homeFormationId = isFormationId(detail.homeFormationId)
    ? detail.homeFormationId
    : DEFAULT_FORMATION;
  const awayFormationId = isFormationId(detail.awayFormationId)
    ? detail.awayFormationId
    : DEFAULT_FORMATION;
  const playerSide = detail.playerSide === 'away' ? 'away' : 'home';
  const durationSeconds = validateDuration(detail.durationSeconds);

  return {
    localMatchId: detail.localMatchId ?? `online-${detail.roomId}`,
    playerTeamId: playerSide === 'home' ? detail.homeTeamId : detail.awayTeamId,
    opponentTeamId: playerSide === 'home' ? detail.awayTeamId : detail.homeTeamId,
    homeTeamId: detail.homeTeamId,
    awayTeamId: detail.awayTeamId,
    durationSeconds,
    playerSide,
    formationId: playerSide === 'home' ? homeFormationId : awayFormationId,
    opponentFormationId: playerSide === 'home' ? awayFormationId : homeFormationId,
    formatId: '11v11',
  };
}
