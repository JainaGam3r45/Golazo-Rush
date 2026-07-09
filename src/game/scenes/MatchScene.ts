import Phaser from 'phaser';
import { Ball } from '../entities/Ball';
import { HumanPlayer } from '../entities/HumanPlayer';
import { BotPlayer } from '../entities/BotPlayer';
import { Goalkeeper } from '../entities/Goalkeeper';
import type { FieldPlayer } from '../entities/FieldPlayer';
import type { MatchSetup } from '../../lib/match/setup';
import type { MatchEndedDetail, MatchNeedsPenaltiesDetail } from '../../lib/realtime/types';
import { getFormation, type FormationId } from '../../lib/match/formations';
import { formatMatchClock } from '../../lib/match/formatMatchClock';
import { teams as mockTeams } from '../../lib/mock/teams';
import {
  CENTER_CIRCLE_RADIUS,
  GOAL_BOTTOM,
  GOAL_CENTER_Y,
  GOAL_DEPTH,
  GOAL_HEIGHT,
  GOAL_RESET_PAUSE_MS,
  GOAL_TOP,
  GOALKEEPER_AWAY_X,
  GOALKEEPER_HOME_X,
  PENALTY_BOX_HEIGHT,
  PENALTY_BOX_TOP,
  PENALTY_BOX_WIDTH,
  PITCH_HEIGHT,
  PITCH_MARGIN,
  PITCH_WIDTH,
} from '../config/pitch';
import { getFieldAnchors, getKickoffBallPosition } from '../config/spawnLayouts';
import { updateTeamBots, type KickCallback } from '../ai/botBrain';
import { updateGoalkeeper } from '../ai/goalkeeperBrain';
import {
  registerTouch,
  resetPossession,
  resetBallControl,
  updateBallControl,
  markBallKicked,
  transferBallControl,
} from '../ai/possession';
import { resetAntiStuck } from '../ai/antiStuck';
import { executePass, findPassTarget } from '../actions/passing';
import { tryTackle } from '../actions/tackle';
import {
  playGoal,
  playKick,
  playWhistle,
  playPass,
  playLongKick,
  playTackle,
  playFoul,
} from '../audio/matchAudio';
import { canStartStoppage, isPlaying, type MatchPhase } from '../rules/matchPhase';
import {
  clampBallSoft,
  clampPlayer,
  isBallOut,
} from '../rules/playableBounds';
import { resolveSetPiece } from '../rules/setPieces';
import {
  createPenaltyAward,
  isInsidePenaltyBox,
  type PenaltyAward,
  type PenaltyPhase,
} from '../rules/penalty';

const OUT_DETECT_COOLDOWN_MS = 500;
const SET_PIECE_PAUSE_MS = 1100;
const FOUL_PAUSE_MS = 1100;
const PENALTY_STUB_PAUSE_MS = 1200;

function hexToNumber(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

function getTeamColor(teamId: string): number {
  const team = mockTeams.find((t) => t.id === teamId);
  return team ? hexToNumber(team.primary) : 0x39ff14;
}

function getTeamName(teamId: string): string {
  return mockTeams.find((t) => t.id === teamId)?.name ?? teamId;
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

function updateTeamLabels(homeTeamId: string, awayTeamId: string): void {
  const homeLabel = document.getElementById('hud-home-name');
  const awayLabel = document.getElementById('hud-away-name');
  if (homeLabel) homeLabel.textContent = getTeamName(homeTeamId);
  if (awayLabel) awayLabel.textContent = getTeamName(awayTeamId);
}

function emitMatchEnded(detail: MatchEndedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('golazo:match-ended', { detail }));
}

function emitMatchNeedsPenalties(detail: MatchNeedsPenaltiesDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('golazo:match-needs-penalties', { detail }));
}

export class MatchScene extends Phaser.Scene {
  private setup!: MatchSetup;
  private human!: HumanPlayer;
  private homeBots: BotPlayer[] = [];
  private awayBots: BotPlayer[] = [];
  private homeGk!: Goalkeeper;
  private awayGk!: Goalkeeper;
  private ball!: Ball;
  private homeScore = 0;
  private awayScore = 0;
  private phase: MatchPhase = 'playing';
  private matchEnded = false;
  private matchStartedAt = 0;
  private matchDurationMs = 180_000;
  private clockTimer: Phaser.Time.TimerEvent | null = null;
  private kickoffSide: 'home' | 'away' = 'home';
  private homeFormationId!: FormationId;
  private awayFormationId!: FormationId;
  private vfxGraphics!: Phaser.GameObjects.Graphics;
  private outDetectCooldownUntil = 0;
  private foulsHome = 0;
  private foulsAway = 0;
  private penaltyPhase: PenaltyPhase = 'idle';
  private pendingPenalty: PenaltyAward | null = null;
  private phaseOverlay: Phaser.GameObjects.Text | null = null;
  private resumeTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super('MatchScene');
  }

  init(): void {
    this.setup = this.game.registry.get('matchSetup') as MatchSetup;
    this.matchDurationMs = this.setup.durationSeconds * 1000;
    this.homeScore = 0;
    this.awayScore = 0;
    this.phase = 'playing';
    this.matchEnded = false;
    this.kickoffSide = 'home';
    this.outDetectCooldownUntil = 0;
    this.foulsHome = 0;
    this.foulsAway = 0;
    this.penaltyPhase = 'idle';
    this.pendingPenalty = null;
    this.clearPhaseOverlay();
    this.resumeTimer?.remove();
    this.resumeTimer = null;
    resetPossession();
    resetBallControl();

    this.homeFormationId =
      this.setup.playerSide === 'home' ? this.setup.formationId : this.setup.opponentFormationId;
    this.awayFormationId =
      this.setup.playerSide === 'away' ? this.setup.formationId : this.setup.opponentFormationId;
  }

  shutdown(): void {
    this.clockTimer?.remove();
    this.clockTimer = null;
    this.resumeTimer?.remove();
    this.resumeTimer = null;
    this.clearPhaseOverlay();
    this.time.removeAllEvents();
    this.tweens.killAll();
  }

  create(): void {
    this.drawPitch();
    this.drawGoals();
    this.vfxGraphics = this.add.graphics().setDepth(5);
    this.spawnTeams();

    this.physics.world.setBounds(0, 0, PITCH_WIDTH, PITCH_HEIGHT);
    this.matchStartedAt = this.time.now;

    updateTeamLabels(this.setup.homeTeamId, this.setup.awayTeamId);
    updateScoreOverlay(this.homeScore, this.awayScore);
    updateMatchClock(this.setup.durationSeconds);

    this.clockTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.matchEnded) return;
        const elapsed = this.time.now - this.matchStartedAt;
        const remaining = Math.max(0, Math.ceil((this.matchDurationMs - elapsed) / 1000));
        updateMatchClock(remaining);
        if (remaining <= 0) {
          this.endMatch();
        }
      },
    });

    this.time.delayedCall(this.matchDurationMs, () => {
      this.endMatch();
    });
  }

  private spawnTeams(): void {
    const homeColor = getTeamColor(this.setup.homeTeamId);
    const awayColor = getTeamColor(this.setup.awayTeamId);
    const playerOnHome = this.setup.playerSide === 'home';

    const kickoff = getKickoffBallPosition(this.kickoffSide);
    this.ball = new Ball(this, kickoff.x, kickoff.y);

    const homeAnchors = getFieldAnchors(this.homeFormationId, 'home');
    const awayAnchors = getFieldAnchors(this.awayFormationId, 'away');

    this.homeGk = new Goalkeeper(
      this,
      GOALKEEPER_HOME_X,
      GOAL_CENTER_Y,
      homeColor,
      'home',
      playerOnHome ? 'teammate' : 'opponent',
    );
    this.awayGk = new Goalkeeper(
      this,
      GOALKEEPER_AWAY_X,
      GOAL_CENTER_Y,
      awayColor,
      'away',
      playerOnHome ? 'opponent' : 'teammate',
    );
    this.physics.add.collider(this.homeGk, this.ball);
    this.physics.add.collider(this.awayGk, this.ball);

    this.homeBots = [];
    this.awayBots = [];

    for (let i = 0; i < homeAnchors.length; i++) {
      const anchor = homeAnchors[i];
      if (playerOnHome && i === 0) {
        this.human = new HumanPlayer(this, anchor.x, anchor.y, homeColor, 'home', anchor.slot);
        this.physics.add.collider(this.human, this.ball);
        continue;
      }
      const bot = new BotPlayer(
        this,
        anchor.x,
        anchor.y,
        homeColor,
        'home',
        anchor.slot,
        playerOnHome ? 'teammate' : 'opponent',
      );
      this.homeBots.push(bot);
      this.physics.add.collider(bot, this.ball);
    }

    for (let i = 0; i < awayAnchors.length; i++) {
      const anchor = awayAnchors[i];
      if (!playerOnHome && i === 0) {
        this.human = new HumanPlayer(this, anchor.x, anchor.y, awayColor, 'away', anchor.slot);
        this.physics.add.collider(this.human, this.ball);
        continue;
      }
      const bot = new BotPlayer(
        this,
        anchor.x,
        anchor.y,
        awayColor,
        'away',
        anchor.slot,
        playerOnHome ? 'opponent' : 'teammate',
      );
      this.awayBots.push(bot);
      this.physics.add.collider(bot, this.ball);
    }
  }

  private getAllFieldPlayers(): FieldPlayer[] {
    return [
      this.human,
      ...this.homeBots,
      ...this.awayBots,
      this.homeGk,
      this.awayGk,
    ];
  }

  private getTeammates(side: 'home' | 'away'): FieldPlayer[] {
    const playerOnHome = this.setup.playerSide === 'home';
    const isHome = side === 'home';
    const teammates: FieldPlayer[] = isHome ? [...this.homeBots, this.homeGk] : [...this.awayBots, this.awayGk];
    if ((playerOnHome && isHome) || (!playerOnHome && !isHome)) {
      teammates.unshift(this.human);
    }
    return teammates;
  }

  private getOpponents(side: 'home' | 'away'): BotPlayer[] {
    return side === 'home' ? this.awayBots : this.homeBots;
  }

  private clearPhaseOverlay(): void {
    this.phaseOverlay?.destroy();
    this.phaseOverlay = null;
  }

  private showPhaseOverlay(label: string, color = '#ffffff'): void {
    this.clearPhaseOverlay();
    this.phaseOverlay = this.add
      .text(PITCH_WIDTH / 2, PITCH_HEIGHT / 2 - 40, label, {
        fontFamily: 'Bebas Neue, sans-serif',
        fontSize: '56px',
        color,
        stroke: '#0a0f0a',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(8);
  }

  private enterPhase(next: MatchPhase): boolean {
    if (next !== 'playing' && !canStartStoppage(this.phase)) return false;
    this.phase = next;
    if (next !== 'playing') {
      this.freezeAll();
    }
    return true;
  }

  private resumePlaying(outCooldown = false): void {
    this.resumeTimer = null;
    this.clearPhaseOverlay();
    this.phase = 'playing';
    this.penaltyPhase = 'idle';
    this.pendingPenalty = null;
    if (outCooldown) {
      this.outDetectCooldownUntil = this.time.now + OUT_DETECT_COOLDOWN_MS;
    }
  }

  private scheduleResume(delayMs: number, outCooldown = false, afterPlace?: () => void): void {
    this.resumeTimer?.remove();
    this.resumeTimer = this.time.delayedCall(delayMs, () => {
      afterPlace?.();
      this.resumePlaying(outCooldown);
    });
  }

  private readonly onKick: KickCallback = (side, x, y) => {
    this.handleKick(side, x, y);
  };

  private handleKick(side: 'home' | 'away', x: number, y: number, longKick = false): void {
    registerTouch(side, this.time.now);
    markBallKicked(this.time.now, longKick);
    if (longKick) {
      playLongKick();
    } else {
      playKick();
    }
    this.spawnKickParticles(x, y);
    this.ball.flashKick();
  }

  private handlePass(side: 'home' | 'away', x: number, y: number, longPass: boolean): void {
    registerTouch(side, this.time.now);
    if (longPass) {
      playLongKick();
    } else {
      playPass();
    }
    this.spawnKickParticles(x, y);
    this.ball.flashKick();
  }

  private tryPlayerKick(player: FieldPlayer, charged: boolean, time: number): void {
    const dir = player === this.human ? this.human.getKickDirection() : undefined;
    if (player.kickBall(this.ball, charged, time, 1, dir)) {
      this.handleKick(player.side, player.x, player.y, charged);
    }
  }

  private tryHumanPass(mode: 'short' | 'long', time: number): void {
    const side = this.human.side;
    const teammates = this.getTeammates(side).filter((p) => p !== this.human);
    const opponents = this.getOpponents(side);

    if (mode === 'short') {
      const target = findPassTarget(teammates, this.human, opponents, 'short');
      if (!target) return;
      if (executePass(this.human, this.ball, target, 'short', time)) {
        this.handlePass(side, this.human.x, this.human.y, false);
      }
      return;
    }

    const target = findPassTarget(teammates, this.human, opponents, 'long');
    const fallback = target ?? {
      x: this.human.x + (side === 'home' ? 200 : -200),
      y: this.human.y + (Math.random() - 0.5) * 60,
    };
    if (executePass(this.human, this.ball, fallback, 'long', time)) {
      this.handlePass(side, this.human.x, this.human.y, true);
    }
  }

  private tryHumanTackle(time: number): void {
    const opponents = this.getOpponents(this.human.side);
    const result = tryTackle(this.human, this.ball, opponents, time, this.human.getLastTackleAt());

    if (result.type === 'miss') return;

    this.human.markTackle(time);

    if (result.type === 'success') {
      playTackle();
      registerTouch(this.human.side, time);
      return;
    }

    this.handleFoul(result.fouledSide, result.victim.x, result.victim.y);
  }

  private pushRivalsFromBall(fouledSide: 'home' | 'away', minDist = 70): void {
    for (const player of this.getAllFieldPlayers()) {
      if (player.side === fouledSide) continue;
      const dx = player.x - this.ball.x;
      const dy = player.y - this.ball.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist < minDist) {
        const pos = clampPlayer(
          this.ball.x + (dx / dist) * minDist,
          this.ball.y + (dy / dist) * minDist,
        );
        player.setPosition(pos.x, pos.y);
        player.stop();
      }
    }
  }

  private giveControlToSide(side: 'home' | 'away', time: number, preferGk = false): void {
    let taker: FieldPlayer | null = null;
    if (preferGk) {
      taker = side === 'home' ? this.homeGk : this.awayGk;
    } else {
      const candidates = this.getTeammates(side);
      let bestDist = Infinity;
      for (const p of candidates) {
        const dist = p.distanceTo(this.ball.x, this.ball.y);
        if (dist < bestDist) {
          bestDist = dist;
          taker = p;
        }
      }
    }
    if (!taker) return;
    const near = clampPlayer(
      this.ball.x + (side === 'home' ? -18 : 18),
      this.ball.y,
    );
    taker.setPosition(near.x, near.y);
    taker.stop();
    transferBallControl(taker, time);
  }

  private handleFoul(fouledSide: 'home' | 'away', x: number, y: number): void {
    if (this.matchEnded || !canStartStoppage(this.phase)) return;

    const defendingSide = fouledSide === 'home' ? 'away' : 'home';
    if (isInsidePenaltyBox(x, y, defendingSide)) {
      this.handlePenaltyStub(fouledSide);
      return;
    }

    if (!this.enterPhase('foul')) return;

    if (fouledSide === 'home') this.foulsAway += 1;
    else this.foulsHome += 1;

    playFoul();
    playWhistle();
    this.showPhaseOverlay('FALTA', '#ff4444');

    this.scheduleResume(FOUL_PAUSE_MS, true, () => {
      resetBallControl();
      const towardCenter = fouledSide === 'home' ? 1 : -1;
      const placed = clampBallSoft(x + towardCenter * 40, y);
      this.ball.resetPosition(placed.x, placed.y);
      this.pushRivalsFromBall(fouledSide, 70);
      this.giveControlToSide(fouledSide, this.time.now);
    });
  }

  private handlePenaltyStub(fouledSide: 'home' | 'away'): void {
    if (!this.enterPhase('penaltyStub')) return;

    if (fouledSide === 'home') this.foulsAway += 1;
    else this.foulsHome += 1;

    const award = createPenaltyAward(fouledSide);
    this.pendingPenalty = award;
    this.penaltyPhase = 'awarded';

    playFoul();
    playWhistle();
    this.showPhaseOverlay('PENAL', '#ffcc33');

    this.scheduleResume(PENALTY_STUB_PAUSE_MS, true, () => {
      this.penaltyPhase = 'stub_reset';
      resetBallControl();
      this.ball.resetPosition(award.spot.x, award.spot.y);
      this.pushRivalsFromBall(fouledSide, 90);
      this.giveControlToSide(fouledSide, this.time.now);
    });
  }

  private handleSetPiece(): void {
    if (this.matchEnded || !canStartStoppage(this.phase)) return;
    if (this.time.now < this.outDetectCooldownUntil) return;

    const out = isBallOut(this.ball.x, this.ball.y);
    if (!out.out) return;

    if (!this.enterPhase('setPiece')) return;

    const resolution = resolveSetPiece(out);
    playWhistle();
    this.showPhaseOverlay(resolution.overlay);

    this.scheduleResume(SET_PIECE_PAUSE_MS, true, () => {
      resetBallControl();
      this.ball.resetPosition(resolution.ballX, resolution.ballY);
      this.pushRivalsFromBall(resolution.possessionSide, 65);

      if (resolution.type === 'goalKick') {
        this.giveControlToSide(resolution.possessionSide, this.time.now, true);
      } else if (resolution.type === 'corner') {
        const mates = this.getTeammates(resolution.possessionSide).filter(
          (p) => p !== this.homeGk && p !== this.awayGk,
        );
        const taker = mates[0] ?? this.getTeammates(resolution.possessionSide)[0];
        if (taker) {
          const pos = clampPlayer(
            resolution.ballX + resolution.impulseX * 0.35,
            resolution.ballY + resolution.impulseY * 0.35,
          );
          taker.setPosition(pos.x, pos.y);
          taker.stop();
          transferBallControl(taker, this.time.now);
        }
      } else {
        this.giveControlToSide(resolution.possessionSide, this.time.now);
      }
    });
  }

  private softClampEntities(): void {
    const out = isBallOut(this.ball.x, this.ball.y);
    if (out.out && this.time.now < this.outDetectCooldownUntil) {
      const soft = clampBallSoft(this.ball.x, this.ball.y);
      this.ball.setPosition(
        Phaser.Math.Linear(this.ball.x, soft.x, 0.55),
        Phaser.Math.Linear(this.ball.y, soft.y, 0.55),
      );
      this.ball.body.setVelocity(
        this.ball.body.velocity.x * 0.5,
        this.ball.body.velocity.y * 0.5,
      );
    }

    for (const player of this.getAllFieldPlayers()) {
      const clamped = clampPlayer(player.x, player.y);
      if (Math.abs(clamped.x - player.x) > 1 || Math.abs(clamped.y - player.y) > 1) {
        player.setPosition(
          Phaser.Math.Linear(player.x, clamped.x, 0.45),
          Phaser.Math.Linear(player.y, clamped.y, 0.45),
        );
      }
    }
  }

  update(time: number): void {
    if (this.matchEnded) return;

    if (!isPlaying(this.phase)) {
      this.freezeAll();
      return;
    }

    const allPlayers = this.getAllFieldPlayers();
    updateBallControl(this.ball, allPlayers, time);

    const action = this.human.update(time);
    if (action?.type === 'kick') {
      this.tryPlayerKick(this.human, action.charged, time);
    } else if (action?.type === 'pass') {
      this.tryHumanPass(action.mode, time);
    } else if (action?.type === 'tackle') {
      this.tryHumanTackle(time);
    }

    if (!isPlaying(this.phase)) return;

    const homeAnchors = getFieldAnchors(this.homeFormationId, 'home');
    const awayAnchors = getFieldAnchors(this.awayFormationId, 'away');

    updateTeamBots(
      this.homeBots,
      this.ball,
      homeAnchors,
      getFormation(this.homeFormationId),
      'home',
      time,
      this.awayBots,
      this.onKick,
      (side, x, y, longPass) => this.handlePass(side, x, y, Boolean(longPass)),
    );
    updateTeamBots(
      this.awayBots,
      this.ball,
      awayAnchors,
      getFormation(this.awayFormationId),
      'away',
      time,
      this.homeBots,
      this.onKick,
      (side, x, y, longPass) => this.handlePass(side, x, y, Boolean(longPass)),
    );

    updateGoalkeeper(this.homeGk, this.ball, time, this.onKick, this.awayBots);
    updateGoalkeeper(this.awayGk, this.ball, time, this.onKick, this.homeBots);

    this.human.updateShadow();
    this.homeGk.updateShadow();
    this.awayGk.updateShadow();
    for (const bot of [...this.homeBots, ...this.awayBots]) {
      bot.updateShadow();
    }

    this.ball.setDepth(this.ball.y + 0.5);
    this.ball.updateTrail(time);

    this.checkGoal();
    if (!isPlaying(this.phase)) return;

    this.handleSetPiece();
    if (!isPlaying(this.phase)) return;

    this.softClampEntities();
  }

  private spawnKickParticles(x: number, y: number): void {
    const count = 4;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const dist = 8 + Math.random() * 12;
      const px = x + Math.cos(angle) * dist;
      const py = y + Math.sin(angle) * dist;
      const dot = this.add.circle(px, py, 3, 0xffffff, 0.7).setDepth(4);
      this.tweens.add({
        targets: dot,
        alpha: 0,
        scale: 0.2,
        x: px + Math.cos(angle) * 16,
        y: py + Math.sin(angle) * 16,
        duration: 200,
        onComplete: () => dot.destroy(),
      });
    }
  }

  private spawnGoalParticles(): void {
    const count = 8;
    const cx = PITCH_WIDTH / 2;
    const cy = PITCH_HEIGHT / 2;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const dist = 20 + Math.random() * 40;
      const px = cx + Math.cos(angle) * dist;
      const py = cy + Math.sin(angle) * dist;
      const color = i % 2 === 0 ? 0x39ff14 : 0xffffff;
      const dot = this.add.circle(px, py, 4, color, 0.85).setDepth(6);
      this.tweens.add({
        targets: dot,
        alpha: 0,
        y: py - 30 - Math.random() * 20,
        scale: 1.5,
        duration: 500 + Math.random() * 200,
        onComplete: () => dot.destroy(),
      });
    }

    this.vfxGraphics.fillStyle(0xffffff, 0.25);
    this.vfxGraphics.fillRect(0, 0, PITCH_WIDTH, PITCH_HEIGHT);
    this.tweens.add({
      targets: this.vfxGraphics,
      alpha: 0,
      duration: 180,
      onComplete: () => {
        this.vfxGraphics.clear();
        this.vfxGraphics.setAlpha(1);
      },
    });
  }

  private endMatch(): void {
    if (this.matchEnded) return;
    this.matchEnded = true;
    this.clockTimer?.remove();
    this.resumeTimer?.remove();
    this.resumeTimer = null;
    this.freezeAll();
    playWhistle();

    const durationSeconds = Math.round((this.time.now - this.matchStartedAt) / 1000);
    const isTie = this.homeScore === this.awayScore;

    if (isTie) {
      emitMatchNeedsPenalties({
        localMatchId: this.setup.localMatchId,
        homeTeamId: this.setup.homeTeamId,
        awayTeamId: this.setup.awayTeamId,
        homeScore: this.homeScore,
        awayScore: this.awayScore,
        durationSeconds,
      });
    }

    emitMatchEnded({
      localMatchId: this.setup.localMatchId,
      homeTeamId: this.setup.homeTeamId,
      awayTeamId: this.setup.awayTeamId,
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      durationSeconds,
      decidedBy: 'regulation',
    });
  }

  private freezeAll(): void {
    this.human.stop();
    this.ball.body.setVelocity(0, 0);
    for (const bot of [...this.homeBots, ...this.awayBots]) bot.stop();
    this.homeGk.stop();
    this.awayGk.stop();
  }

  private drawPitch(): void {
    const graphics = this.add.graphics();
    const stripeWidth = 80;
    const colors = [0x1a5c1a, 0x1e6b1e];

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

    const step = 14;
    for (let ny = GOAL_TOP; ny <= GOAL_BOTTOM; ny += step) {
      net.lineBetween(postX, ny, innerX, ny + (mirror ? -step / 2 : step / 2));
    }
    for (let nx = postX; mirror ? nx >= innerX : nx <= innerX; nx += (mirror ? -1 : 1) * step) {
      const t = Math.abs(nx - postX) / GOAL_DEPTH;
      const yTop = GOAL_TOP + t * 8;
      const yBot = GOAL_BOTTOM - t * 8;
      net.lineBetween(nx, yTop, nx + (mirror ? -step : step), yBot);
    }

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

  private checkGoal(): void {
    if (this.matchEnded || !canStartStoppage(this.phase)) return;

    const inGoalBand = this.ball.y >= GOAL_TOP && this.ball.y <= GOAL_BOTTOM;

    if (inGoalBand && this.ball.x <= GOAL_DEPTH) {
      this.awayScore += 1;
      this.kickoffSide = 'home';
      updateScoreOverlay(this.homeScore, this.awayScore);
      this.celebrateGoal();
      this.resetAfterGoal();
      return;
    }

    if (inGoalBand && this.ball.x >= PITCH_WIDTH - GOAL_DEPTH) {
      this.homeScore += 1;
      this.kickoffSide = 'away';
      updateScoreOverlay(this.homeScore, this.awayScore);
      this.celebrateGoal();
      this.resetAfterGoal();
    }
  }

  private celebrateGoal(): void {
    playGoal();
    this.spawnGoalParticles();

    const text = this.add
      .text(PITCH_WIDTH / 2, PITCH_HEIGHT / 2 - 40, '¡GOL!', {
        fontFamily: 'Bebas Neue, sans-serif',
        fontSize: '64px',
        color: '#39ff14',
        stroke: '#0a0f0a',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setScale(0.5)
      .setDepth(7);

    this.tweens.add({
      targets: text,
      alpha: 1,
      scale: 1.2,
      duration: 200,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: text,
          alpha: 0,
          y: text.y - 30,
          duration: 600,
          delay: 300,
          onComplete: () => text.destroy(),
        });
      },
    });

    this.cameras.main.shake(120, 0.004);
  }

  private resetAfterGoal(): void {
    if (!this.enterPhase('goal')) return;

    resetPossession();
    resetBallControl();

    for (const bot of [...this.homeBots, ...this.awayBots]) {
      resetAntiStuck(bot);
    }

    const homeAnchors = getFieldAnchors(this.homeFormationId, 'home');
    const awayAnchors = getFieldAnchors(this.awayFormationId, 'away');
    const playerOnHome = this.setup.playerSide === 'home';

    this.homeGk.resetTo(GOALKEEPER_HOME_X, GOAL_CENTER_Y);
    this.awayGk.resetTo(GOALKEEPER_AWAY_X, GOAL_CENTER_Y);

    for (let i = 0; i < homeAnchors.length; i++) {
      const anchor = homeAnchors[i];
      if (playerOnHome && i === 0) {
        this.human.resetTo(anchor.x, anchor.y);
      } else {
        const botIdx = playerOnHome ? i - 1 : i;
        this.homeBots[botIdx]?.resetTo(anchor.x, anchor.y);
      }
    }

    for (let i = 0; i < awayAnchors.length; i++) {
      const anchor = awayAnchors[i];
      if (!playerOnHome && i === 0) {
        this.human.resetTo(anchor.x, anchor.y);
      } else {
        const botIdx = playerOnHome ? i : i - 1;
        this.awayBots[botIdx]?.resetTo(anchor.x, anchor.y);
      }
    }

    const kickoff = getKickoffBallPosition(this.kickoffSide);
    this.ball.resetPosition(kickoff.x, kickoff.y);

    this.scheduleResume(GOAL_RESET_PAUSE_MS, true);
  }
}
