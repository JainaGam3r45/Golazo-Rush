import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Ball } from '../entities/Ball';
import type { MatchSetup } from '../../lib/match/setup';
import type { MatchEndedDetail, MatchNeedsPenaltiesDetail } from '../../lib/realtime/types';
import { teams as mockTeams } from '../../lib/mock/teams';

const PITCH_WIDTH = 800;
const PITCH_HEIGHT = 500;
const GOAL_TOP = 190;
const GOAL_BOTTOM = 310;
const GOAL_DEPTH = 18;
const GOAL_RESET_PAUSE_MS = 1200;

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
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  clockEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
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
  private player!: Player;
  private ball!: Ball;
  private homeScore = 0;
  private awayScore = 0;
  private goalCooldown = false;
  private matchEnded = false;
  private matchStartedAt = 0;
  private matchDurationMs = 180_000;
  private clockTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super('MatchScene');
  }

  init(): void {
    this.setup = this.game.registry.get('matchSetup') as MatchSetup;
    this.matchDurationMs = this.setup.durationSeconds * 1000;
    this.homeScore = 0;
    this.awayScore = 0;
    this.goalCooldown = false;
    this.matchEnded = false;
  }

  create(): void {
    this.drawPitch();
    this.drawGoals();

    const playerColor = getTeamColor(this.setup.playerTeamId);
    this.player = new Player(this, PITCH_WIDTH / 2, PITCH_HEIGHT / 2, playerColor);
    this.ball = new Ball(this, PITCH_WIDTH / 2 + 60, PITCH_HEIGHT / 2);

    this.physics.add.collider(this.player, this.ball);

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

  update(time: number): void {
    if (this.matchEnded) return;

    const { kick, charged } = this.player.update(time);

    if (
      kick &&
      this.player.distanceTo(this.ball.x, this.ball.y) <= this.player.kickRange
    ) {
      this.ball.kickFrom(
        this.player.x,
        this.player.y,
        this.player.getKickForce(charged),
        charged,
      );
    }

    this.checkGoal();
  }

  private endMatch(): void {
    if (this.matchEnded) return;
    this.matchEnded = true;
    this.clockTimer?.remove();
    this.player.body.setVelocity(0, 0);
    this.ball.body.setVelocity(0, 0);

    const durationSeconds = Math.round((this.time.now - this.matchStartedAt) / 1000);
    const isTie = this.homeScore === this.awayScore;

    if (isTie) {
      const penaltyDetail: MatchNeedsPenaltiesDetail = {
        localMatchId: this.setup.localMatchId,
        homeTeamId: this.setup.homeTeamId,
        awayTeamId: this.setup.awayTeamId,
        homeScore: this.homeScore,
        awayScore: this.awayScore,
        durationSeconds,
      };
      emitMatchNeedsPenalties(penaltyDetail);
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

  private drawPitch(): void {
    const graphics = this.add.graphics();

    graphics.fillStyle(0x1a5c1a, 1);
    graphics.fillRect(0, 0, PITCH_WIDTH, PITCH_HEIGHT);

    graphics.lineStyle(3, 0xffffff, 0.9);
    graphics.strokeRect(20, 20, PITCH_WIDTH - 40, PITCH_HEIGHT - 40);
    graphics.strokeCircle(PITCH_WIDTH / 2, PITCH_HEIGHT / 2, 60);
    graphics.beginPath();
    graphics.moveTo(PITCH_WIDTH / 2, 20);
    graphics.lineTo(PITCH_WIDTH / 2, PITCH_HEIGHT - 20);
    graphics.strokePath();

    graphics.strokeRect(20, 120, 100, 260);
    graphics.strokeRect(PITCH_WIDTH - 120, 120, 100, 260);
  }

  private drawGoals(): void {
    const homeColor = getTeamColor(this.setup.homeTeamId);
    const awayColor = getTeamColor(this.setup.awayTeamId);

    const leftGoal = this.add.rectangle(
      GOAL_DEPTH / 2,
      (GOAL_TOP + GOAL_BOTTOM) / 2,
      GOAL_DEPTH,
      GOAL_BOTTOM - GOAL_TOP,
      homeColor,
      0.35,
    );
    leftGoal.setStrokeStyle(2, homeColor, 0.8);

    const rightGoal = this.add.rectangle(
      PITCH_WIDTH - GOAL_DEPTH / 2,
      (GOAL_TOP + GOAL_BOTTOM) / 2,
      GOAL_DEPTH,
      GOAL_BOTTOM - GOAL_TOP,
      awayColor,
      0.35,
    );
    rightGoal.setStrokeStyle(2, awayColor, 0.8);
  }

  private checkGoal(): void {
    if (this.goalCooldown || this.matchEnded) return;

    const inGoalBand = this.ball.y >= GOAL_TOP && this.ball.y <= GOAL_BOTTOM;

    if (inGoalBand && this.ball.x <= GOAL_DEPTH) {
      this.awayScore += 1;
      updateScoreOverlay(this.homeScore, this.awayScore);
      this.celebrateGoal();
      this.resetAfterGoal();
      return;
    }

    if (inGoalBand && this.ball.x >= PITCH_WIDTH - GOAL_DEPTH) {
      this.homeScore += 1;
      updateScoreOverlay(this.homeScore, this.awayScore);
      this.celebrateGoal();
      this.resetAfterGoal();
    }
  }

  private celebrateGoal(): void {
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
      .setScale(0.5);

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
    this.goalCooldown = true;
    this.ball.resetPosition(PITCH_WIDTH / 2, PITCH_HEIGHT / 2);
    this.player.setPosition(PITCH_WIDTH / 2 - 50, PITCH_HEIGHT / 2);
    this.player.body.setVelocity(0, 0);

    this.time.delayedCall(GOAL_RESET_PAUSE_MS, () => {
      this.goalCooldown = false;
    });
  }
}
