import Phaser from 'phaser';
import { Ball } from '../entities/Ball';
import { HumanPlayer } from '../entities/HumanPlayer';
import { BotPlayer } from '../entities/BotPlayer';
import { Goalkeeper } from '../entities/Goalkeeper';
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
import { updateTeamBots } from '../ai/botBrain';
import { updateGoalkeeper } from '../ai/goalkeeperBrain';

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
  private goalCooldown = false;
  private matchEnded = false;
  private matchStartedAt = 0;
  private matchDurationMs = 180_000;
  private clockTimer: Phaser.Time.TimerEvent | null = null;
  private kickoffSide: 'home' | 'away' = 'home';
  private homeFormationId!: FormationId;
  private awayFormationId!: FormationId;

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
    this.kickoffSide = 'home';

    this.homeFormationId =
      this.setup.playerSide === 'home' ? this.setup.formationId : this.setup.opponentFormationId;
    this.awayFormationId =
      this.setup.playerSide === 'away' ? this.setup.formationId : this.setup.opponentFormationId;
  }

  create(): void {
    this.drawPitch();
    this.drawGoals();
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

  update(time: number): void {
    if (this.matchEnded) return;

    const { kick, charged } = this.human.update(time);
    if (kick) {
      this.human.kickBall(this.ball, charged, time);
    }

    const homeAnchors = getFieldAnchors(this.homeFormationId, 'home');
    const awayAnchors = getFieldAnchors(this.awayFormationId, 'away');

    updateTeamBots(
      this.homeBots,
      this.ball,
      homeAnchors,
      getFormation(this.homeFormationId),
      'home',
      time,
    );
    updateTeamBots(
      this.awayBots,
      this.ball,
      awayAnchors,
      getFormation(this.awayFormationId),
      'away',
      time,
    );

    updateGoalkeeper(this.homeGk, this.ball, time);
    updateGoalkeeper(this.awayGk, this.ball, time);

    this.checkGoal();
  }

  private endMatch(): void {
    if (this.matchEnded) return;
    this.matchEnded = true;
    this.clockTimer?.remove();
    this.freezeAll();

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

    graphics.fillStyle(0x1a5c1a, 1);
    graphics.fillRect(0, 0, PITCH_WIDTH, PITCH_HEIGHT);

    graphics.lineStyle(3, 0xffffff, 0.9);
    graphics.strokeRect(
      PITCH_MARGIN,
      PITCH_MARGIN,
      PITCH_WIDTH - PITCH_MARGIN * 2,
      PITCH_HEIGHT - PITCH_MARGIN * 2,
    );
    graphics.strokeCircle(PITCH_WIDTH / 2, PITCH_HEIGHT / 2, CENTER_CIRCLE_RADIUS);
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

    const leftGoal = this.add.rectangle(
      GOAL_DEPTH / 2,
      GOAL_CENTER_Y,
      GOAL_DEPTH,
      GOAL_HEIGHT,
      homeColor,
      0.35,
    );
    leftGoal.setStrokeStyle(2, homeColor, 0.8);

    const rightGoal = this.add.rectangle(
      PITCH_WIDTH - GOAL_DEPTH / 2,
      GOAL_CENTER_Y,
      GOAL_DEPTH,
      GOAL_HEIGHT,
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
    this.freezeAll();

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

    this.time.delayedCall(GOAL_RESET_PAUSE_MS, () => {
      this.goalCooldown = false;
    });
  }
}
