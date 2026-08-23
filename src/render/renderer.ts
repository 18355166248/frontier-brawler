/**
 * Canvas 渲染层。**只读世界状态，不改**——所有逻辑都在 core/。
 *
 * 换引擎时只需要重写这个文件，core/ 一行不动。
 * 这是 xianxia-roguelike 的教训反过来用：它的逻辑层零引擎依赖，
 * 所以能搬；耦合全压在编排层。这里从一开始就把那条线画清楚。
 */
import type { DamageEvent, Entity } from '../core/types';
import { ACTIONS } from '../core/actions';
import type { World } from '../core/world';
import type { SpriteSheet } from './sprites';

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  crit: boolean;
}

const PALETTE = {
  skyTop: '#1b2733',
  skyBottom: '#2b3a45',
  groundNear: '#3d4a44',
  groundFar: '#2a3630',
  lane: 'rgba(255,255,255,0.05)',
  shadow: 'rgba(0,0,0,0.34)',
  playerTint: '#8fd4c8',
  enemyTint: '#d99a7a',
  hpBack: 'rgba(0,0,0,0.55)',
  hpPlayer: '#63d0a8',
  hpEnemy: '#e2705c',
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private floats: FloatText[] = [];
  /** 命中时的屏幕震动剩余帧 */
  private shake = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private sheets: Map<string, SpriteSheet>,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('拿不到 2d context');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
  }

  onEvents(damage: DamageEvent[]): void {
    for (const d of damage) {
      this.floats.push({
        x: d.at.x,
        y: d.at.y,
        text: String(d.damage),
        life: 42,
        crit: d.killed,
      });
      // 击杀震得更狠一点，把"斩杀"和"打中"区分开
      this.shake = Math.max(this.shake, d.killed ? 9 : 5);
    }
  }

  draw(world: World): void {
    const { ctx, canvas } = this;
    ctx.save();

    if (this.shake > 0) {
      const amount = this.shake * 0.6;
      ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
      this.shake -= 1;
    }

    this.drawGround(world);

    // 按纵深排序：y 大的更远，先画，才有正确的前后遮挡
    const drawable = [...world.entities].sort((a, b) => a.pos.y - b.pos.y);
    for (const e of drawable) this.drawEntity(e);

    this.drawFloats();
    ctx.restore();

    this.drawHud(world);
    void canvas;
  }

  private drawGround(world: World): void {
    const { ctx, canvas } = this;
    const { arena } = world;

    const sky = ctx.createLinearGradient(0, 0, 0, arena.minY);
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(1, PALETTE.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, arena.minY);

    const ground = ctx.createLinearGradient(0, arena.minY, 0, arena.maxY + 60);
    ground.addColorStop(0, PALETTE.groundFar);
    ground.addColorStop(1, PALETTE.groundNear);
    ctx.fillStyle = ground;
    ctx.fillRect(0, arena.minY, canvas.width, arena.maxY + 60 - arena.minY);

    // 几条横向参考线，帮玩家读出纵深——纯色地面会让人判断不了自己站多前
    ctx.strokeStyle = PALETTE.lane;
    ctx.lineWidth = 1;
    for (let y = arena.minY; y <= arena.maxY; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  private drawEntity(e: Entity): void {
    const { ctx } = this;
    const alpha = e.dead ? Math.max(0, 1 - e.deadFrames / 30) : 1;
    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 影子先画，钉住角色在地面的位置。没有影子的话角色像飘着。
    ctx.fillStyle = PALETTE.shadow;
    ctx.beginPath();
    ctx.ellipse(e.pos.x, e.pos.y, e.radius * 0.9, e.radius * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();

    const sheet = this.sheets.get(e.team);
    const def = ACTIONS[e.action];
    const progress = def.loop
      ? (e.actionFrame % def.frames) / def.frames
      : e.actionFrame / def.frames;
    const rect = sheet?.frameRect(e.action, progress) ?? null;

    // 受击闪白：最直接的"打到了"反馈
    const flashing = e.invulnFrames > 0 && e.invulnFrames % 4 >= 2;

    if (rect && sheet) {
      const scale = 1.05;
      const w = rect.sw * scale;
      const h = rect.sh * scale;
      ctx.save();
      ctx.translate(e.pos.x, e.pos.y);
      ctx.scale(e.facing, 1);
      if (flashing) ctx.filter = 'brightness(2.4) saturate(0.3)';
      ctx.drawImage(sheet.image, rect.sx, rect.sy, rect.sw, rect.sh, -w / 2, -h + 12, w, h);
      ctx.restore();
    } else {
      // 素材没就位时的占位块，保证玩法始终可测
      ctx.fillStyle = flashing ? '#ffffff' : e.team === 'player' ? PALETTE.playerTint : PALETTE.enemyTint;
      ctx.fillRect(e.pos.x - 12, e.pos.y - 52, 24, 52);
    }

    if (!e.dead && e.hp < e.maxHp) this.drawHpBar(e);
    ctx.restore();
  }

  private drawHpBar(e: Entity): void {
    const { ctx } = this;
    const w = 34;
    const x = e.pos.x - w / 2;
    const y = e.pos.y - 66;
    ctx.fillStyle = PALETTE.hpBack;
    ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = e.team === 'player' ? PALETTE.hpPlayer : PALETTE.hpEnemy;
    ctx.fillRect(x, y, w * Math.max(0, e.hp / e.maxHp), 3);
  }

  private drawFloats(): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    for (const f of this.floats) {
      const t = 1 - f.life / 42;
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      ctx.font = f.crit ? 'bold 20px system-ui, sans-serif' : 'bold 15px system-ui, sans-serif';
      ctx.fillStyle = f.crit ? '#ffd479' : '#ffffff';
      ctx.fillText(f.text, f.x, f.y - 60 - t * 26);
      f.life -= 1;
    }
    ctx.globalAlpha = 1;
    this.floats = this.floats.filter((f) => f.life > 0);
  }

  private drawHud(world: World): void {
    const { ctx } = this;
    const player = world.player;
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';

    const alive = world.entities.filter((e) => e.team === 'enemy' && !e.dead).length;
    ctx.fillText(`敌人 ${alive}`, 14, 24);

    if (player) {
      const w = 168;
      ctx.fillStyle = PALETTE.hpBack;
      ctx.fillRect(13, 33, w + 2, 12);
      ctx.fillStyle = PALETTE.hpPlayer;
      ctx.fillRect(14, 34, w * Math.max(0, player.hp / player.maxHp), 10);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`${Math.ceil(player.hp)} / ${player.maxHp}`, 14 + w + 10, 44);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(`动作 ${player.action}`, 14, 62);
    } else {
      ctx.fillStyle = '#e2705c';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('倒下了 · 按 R 重来', this.canvas.width / 2, this.canvas.height / 2);
    }
  }
}
