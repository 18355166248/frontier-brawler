/**
 * 世界推进：固定步长的逻辑帧。不引用任何渲染 API。
 *
 * 横版割草的战场是「带纵深的平面」：
 *   x 横向推进（左右走、面朝方向）
 *   y 是站位纵深（上下走，决定谁站前谁站后，也决定攻击能不能够到）
 * 屏幕上的绘制顺序按 y 排，y 大的画在后面（更远），这样遮挡关系是对的。
 */
import type {
  ActionState,
  DamageEvent,
  Entity,
  EnemyKind,
  Facing,
  InputIntent,
  Projectile,
  Team,
  Vec2,
  WorldEvents,
} from './types';
import {
  ACTIONS,
  DASH_COOLDOWN,
  EXECUTE_RANGE,
  EXECUTE_THRESHOLD,
  SKILL_COST,
  canInterrupt,
  isActionInvulnerable,
} from './actions';
import { ENEMY_PROFILES, think } from './enemies';
import { RunStats } from './stats';

export interface Arena {
  /** 可行走区域，纵深范围比横向窄得多——这是横版的空间感来源 */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 玩家输入比 AI 意图多两个键：技能和处决。 */
export interface InputState extends InputIntent {
  skill: boolean;
  execute: boolean;
}

export const EMPTY_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  attack: false,
  dash: false,
  skill: false,
  execute: false,
};

/**
 * 会自动接续的动作链。远程和冲锋的「预警段 → 生效段」靠它衔接：
 * 预警段播完不回 idle，而是进入真正带判定的那一段。
 * 拆成两个动作而不是一个长动作，是为了让预警帧数可以单独调，
 * 调难度时不牵动判定窗口。
 */
const ACTION_CHAIN: Partial<Record<ActionState, ActionState>> = {
  aim: 'shoot',
  charge: 'rush',
};

/** 敌人攻击链的收尾动作，播完才交还令牌 */
const TOKEN_RELEASING: ActionState[] = ['slash', 'slash2', 'shoot', 'rush', 'heavy'];

/** 命中回能。想放技能就得先打进去，这是 GAME_DESIGN 3.4 的第 4 条约束。 */
const ENERGY_PER_HIT = 7;
const ENERGY_PER_EXECUTE = 25;

/** 处决的回报。给得太少玩家不会主动贴脸，验收第 3 条就永远不达标。 */
const EXECUTE_HEAL = 14;

let nextId = 1;
let nextProjectileId = 1;

export function createEntity(team: Team, pos: Vec2, overrides: Partial<Entity> = {}): Entity {
  return {
    id: nextId++,
    team,
    pos: { ...pos },
    velocity: { x: 0, y: 0 },
    facing: team === 'player' ? 1 : -1,
    hp: 100,
    maxHp: 100,
    speed: 2.4,
    radius: 16,
    hurtbox: { offset: { x: 0, y: 0 }, halfWidth: 16, halfDepth: 12, height: 60 },
    action: 'idle',
    actionFrame: 0,
    hitTargets: new Set(),
    stunFrames: 0,
    invulnFrames: 0,
    knockback: { x: 0, y: 0 },
    attackCooldown: 0,
    energy: 0,
    maxEnergy: 100,
    dashCooldown: 0,
    dashDir: { x: 1, y: 0 },
    damageMultiplier: 1,
    skillDamageMultiplier: 1,
    skillCostMultiplier: 1,
    executeHealBonus: 0,
    telegraph: null,
    ai: { turnCooldown: 0, repositionFrames: 0 },
    dead: false,
    deadFrames: 0,
    ...overrides,
  };
}

/** 按类型建敌人。数值全部来自 ENEMY_PROFILES，避免散落在关卡代码里。 */
export function createEnemy(kind: EnemyKind, pos: Vec2): Entity {
  const p = ENEMY_PROFILES[kind];
  return createEntity('enemy', pos, {
    kind,
    hp: p.hp,
    maxHp: p.hp,
    speed: p.speed,
    radius: p.radius,
    frontalGuard: p.frontalGuard,
    backstabMultiplier: p.backstabMultiplier,
    hurtbox: {
      offset: { x: 0, y: 0 },
      halfWidth: p.radius,
      halfDepth: Math.round(p.radius * 0.78),
      height: 60,
    },
  });
}

export class World {
  entities: Entity[] = [];
  projectiles: Projectile[] = [];
  arena: Arena;
  /** 命中定格剩余帧。大于 0 时整个世界冻结，只有表现层继续播。 */
  freezeFrames = 0;
  /** 本轮允许出手的敌人 id。见 enemyThink 里对「攻击令牌」的说明。 */
  attackTokens = new Set<number>();
  /** 同时最多几个敌人能进攻。2 是清版格斗的常用值：有压迫感又留得出反击窗口。 */
  maxAttackers = 2;
  /** 逻辑帧计数，用于让敌人的游走错开相位 */
  tick = 0;
  events: WorldEvents = { damage: [], hitStop: 0, executes: [], skillCasts: [] };
  stats = new RunStats();

  constructor(arena: Arena) {
    this.arena = arena;
  }

  spawn(entity: Entity): Entity {
    this.entities.push(entity);
    return entity;
  }

  get player(): Entity | undefined {
    return this.entities.find((e) => e.team === 'player' && !e.dead);
  }

  /** 推进一个逻辑帧。input 只作用于玩家。 */
  step(input: InputState): WorldEvents {
    this.events = { damage: [], hitStop: 0, executes: [], skillCasts: [] };

    // 命中定格：全局冻结几帧，是「打到实处」最廉价也最有效的反馈。
    // 冻结期间不推进任何逻辑，连动画帧也停——这正是它有效的原因。
    if (this.freezeFrames > 0) {
      this.freezeFrames -= 1;
      return this.events;
    }

    this.tick += 1;
    this.stats.frames += 1;
    this.updateTokens();

    for (const e of this.entities) {
      if (e.dead) {
        e.deadFrames += 1;
        continue;
      }
      if (e.attackCooldown > 0) e.attackCooldown -= 1;
      if (e.dashCooldown > 0) e.dashCooldown -= 1;
      const control = e.team === 'player' ? input : this.enemyThink(e);
      this.stepEntity(e, control);
    }

    this.releaseFinishedTokens();

    this.resolveHits();
    this.updateProjectiles();
    this.separate();
    this.clampToArena();
    this.updateTelegraphs();

    if (this.events.hitStop > 0) {
      this.freezeFrames = this.events.hitStop;
    }
    return this.events;
  }

  private stepEntity(e: Entity, input: InputState | InputIntent): void {
    if (e.invulnFrames > 0) e.invulnFrames -= 1;

    // 击退独立于主动移动，逐帧衰减。分开处理才能做到「被打飞时不能立刻走回来」。
    e.pos.x += e.knockback.x;
    e.pos.y += e.knockback.y;
    e.knockback.x *= 0.82;
    e.knockback.y *= 0.82;
    if (Math.abs(e.knockback.x) < 0.05) e.knockback.x = 0;
    if (Math.abs(e.knockback.y) < 0.05) e.knockback.y = 0;

    if (e.stunFrames > 0) {
      e.stunFrames -= 1;
      this.advanceAction(e);
      return;
    }

    // 远程的放箭帧：弹丸在这里生成，判定交给弹丸自己走
    if (e.action === 'shoot' && e.actionFrame === 2) {
      this.spawnProjectile(e);
    }

    const def = ACTIONS[e.action];
    const interruptible = canInterrupt(e.action, e.actionFrame);
    const player = e.team === 'player' ? (input as InputState) : null;

    if (player && interruptible) {
      // 处决优先于普攻：残血目标在手边时，玩家按处决键不该被解释成挥空刀
      if (player.execute && this.tryExecute(e)) {
        // 已切入处决动作
      } else if (player.skill && e.energy >= SKILL_COST * e.skillCostMultiplier) {
        e.energy -= SKILL_COST * e.skillCostMultiplier;
        this.setAction(e, 'skill');
        this.stats.recordAction('skill');
      } else if (player.attack) {
        this.startAttack(e, def.cancelInto?.[0]);
      } else if (player.dash && e.action !== 'dash' && e.dashCooldown <= 0) {
        this.setAction(e, 'dash');
        this.lockDashDirection(e, player);
        e.dashCooldown = DASH_COOLDOWN;
        this.stats.recordAction('dash');
      }
    } else if (!player && input.attack && interruptible) {
      // 敌人：起手动作由类型决定（贴脸挥砍 / 瞄准 / 蓄力冲锋 / 重击）
      const profile = ENEMY_PROFILES[e.kind ?? 'grunt'];
      if (e.action !== profile.attackAction) {
        this.setAction(e, profile.attackAction);
      }
    }

    // 动作自带的位移（挥砍前冲、冲刺、突进）优先于主动移动
    const motion = ACTIONS[e.action].motion;
    const before = { x: e.pos.x, y: e.pos.y };
    if (motion && e.actionFrame < motion.length) {
      const step = motion[e.actionFrame];
      if (e.action === 'dash') {
        // 冲刺走锁定方向；纵深照样压 62%，否则斜冲会比直冲快，空间感就塌了
        e.pos.x += step * e.dashDir.x;
        e.pos.y += step * e.dashDir.y * 0.62;
      } else {
        e.pos.x += step * e.facing;
      }
    } else if (canInterrupt(e.action, e.actionFrame)) {
      const len = Math.hypot(input.moveX, input.moveY);
      if (len > 0.01) {
        const nx = input.moveX / len;
        const ny = input.moveY / len;
        e.pos.x += nx * e.speed;
        // 纵深方向移速压低，否则斜着走会比横着走快，而且纵深过快会破坏横版的空间感
        e.pos.y += ny * e.speed * 0.62;
        this.faceTowards(e, nx);
        if (e.action === 'idle') this.setAction(e, 'move');
      } else if (e.action === 'move') {
        this.setAction(e, 'idle');
      }
    }

    if (e.team === 'player') {
      this.stats.recordMove(e.pos.x - before.x, e.pos.y - before.y);
    }

    this.advanceAction(e);
  }

  /**
   * 冲刺起手时锁定方向：有方向键就按方向键，没有就沿朝向前冲。
   * 锁定而不是逐帧跟随输入，是因为闪避一旦开始就该是一段确定的位移——
   * 中途还能拐弯的话，无敌帧就变成了「随便乱按也能贴脸游走」。
   */
  private lockDashDirection(e: Entity, input: InputState): void {
    const len = Math.hypot(input.moveX, input.moveY);
    if (len > 0.01) {
      e.dashDir = { x: input.moveX / len, y: input.moveY / len };
      if (Math.abs(input.moveX) > 0.2) {
        e.facing = (input.moveX > 0 ? 1 : -1) as Facing;
      }
      return;
    }
    e.dashDir = { x: e.facing, y: 0 };
  }

  /** 普攻起手／接续连段，顺手记账供验收统计用。 */
  private startAttack(e: Entity, chained: ActionState | undefined): void {
    if (chained && e.action !== chained) {
      this.setAction(e, chained);
      if (chained === 'slash2') this.stats.recordAction('slash2');
      else if (chained === 'slash') this.stats.recordAction('slash');
      return;
    }
    if (e.action !== 'slash' && e.action !== 'slash2') {
      this.setAction(e, 'slash');
      this.stats.recordAction('slash');
    }
  }

  /**
   * 转向。盾兵慢半拍——这不是手感瑕疵而是设计要求：
   * 转身即时的话玩家永远绕不到它背后，正面减伤就只是血量膨胀。
   */
  private faceTowards(e: Entity, nx: number): void {
    if (Math.abs(nx) <= 0.2) return;
    const want = (nx > 0 ? 1 : -1) as Facing;
    if (want === e.facing) {
      e.ai.turnCooldown = 0;
      return;
    }
    const delay = e.team === 'enemy' ? ENEMY_PROFILES[e.kind ?? 'grunt'].turnDelay : 0;
    if (delay <= 0) {
      e.facing = want;
      return;
    }
    e.ai.turnCooldown += 1;
    if (e.ai.turnCooldown >= delay) {
      e.facing = want;
      e.ai.turnCooldown = 0;
    }
  }

  /**
   * 处决：找手边最近的残血敌人。找不到就返回 false，
   * 让按键回落成普攻，而不是原地播一个空动作——那样按错一次就白挨一轮打。
   */
  private tryExecute(player: Entity): boolean {
    let best: Entity | null = null;
    let bestDist = Infinity;
    for (const e of this.entities) {
      if (e.dead || e.team === 'player') continue;
      if (e.hp / e.maxHp >= EXECUTE_THRESHOLD) continue;
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.y - player.pos.y);
      if (d <= EXECUTE_RANGE && d < bestDist) {
        best = e;
        bestDist = d;
      }
    }
    if (!best) return false;
    // 处决要转向目标，否则背对着按会砍空，玩家会以为是判定不准
    if (Math.abs(best.pos.x - player.pos.x) > 1) {
      player.facing = (best.pos.x > player.pos.x ? 1 : -1) as Facing;
    }
    this.setAction(player, 'execute');
    this.stats.recordAction('execute');
    return true;
  }

  private advanceAction(e: Entity): void {
    const def = ACTIONS[e.action];
    e.actionFrame += 1;
    if (e.actionFrame < def.frames) return;

    if (def.loop) {
      e.actionFrame = 0;
      return;
    }
    // 预警段播完自动进入生效段（aim→shoot、charge→rush）
    const next = ACTION_CHAIN[e.action];
    this.setAction(e, next ?? 'idle');
  }

  setAction(e: Entity, state: ActionState): void {
    e.action = state;
    e.actionFrame = 0;
    e.hitTargets.clear();
  }

  /**
   * 敌人 AI：抢到「攻击令牌」的才准出手，其余的在外围绕。
   *
   * 这是清版格斗的标准解法。不做令牌的话，五个敌人同时贴脸输出，
   * 玩家每次受击进 20 帧硬直，永远轮不到自己出手——实测就是站着被打死，
   * 而且不是数值问题：把敌人伤害调到 1 也一样操作不了。
   * 令牌把「同时能打你的人数」压到 1-2 个，其余的负责制造包围感，
   * 玩家因此始终有出手窗口，围殴的压迫感却还在。
   *
   * 具体的走位和起手条件按类型分流，见 enemies.ts。
   */
  private enemyThink(e: Entity): InputIntent {
    const target = this.player;
    if (!target) return EMPTY_INPUT;
    // 已经在出招途中就不再改朝向，否则冲锋会在突进中途拐弯，预警线就成了谎话
    const busy = e.action !== 'idle' && e.action !== 'move';
    if (!busy) {
      const dx = target.pos.x - e.pos.x;
      if (Math.abs(dx) > 1) this.faceTowards(e, dx);
    }
    return think(e, target, this.tick, this.attackTokens.has(e.id));
  }

  /** 发放攻击令牌：把最近的若干敌人选为本轮进攻者。 */
  private updateTokens(): void {
    const target = this.player;
    if (!target) {
      this.attackTokens.clear();
      return;
    }
    // 已经在出手的保留令牌，避免招式打到一半被收走导致动作中断
    for (const id of [...this.attackTokens]) {
      const e = this.entities.find((x) => x.id === id);
      if (!e || e.dead) this.attackTokens.delete(id);
    }
    if (this.attackTokens.size >= this.maxAttackers) return;

    const candidates = this.entities
      .filter(
        (e) =>
          e.team === 'enemy' &&
          !e.dead &&
          !this.attackTokens.has(e.id) &&
          // 刚出完手的要等冷却，否则同一个敌人会立刻把令牌抢回去，
          // 轮流进攻就退化成一个人贴着你连打。
          e.attackCooldown <= 0,
      )
      .map((e) => ({ e, d: Math.hypot(e.pos.x - target.pos.x, e.pos.y - target.pos.y) }))
      .sort((a, b) => a.d - b.d);

    while (this.attackTokens.size < this.maxAttackers && candidates.length) {
      const next = candidates.shift();
      if (next) this.attackTokens.add(next.e.id);
    }
  }

  /** 出手结束就交还令牌，让下一个敌人接上，形成轮流进攻的节奏。 */
  private releaseFinishedTokens(): void {
    for (const id of [...this.attackTokens]) {
      const e = this.entities.find((x) => x.id === id);
      if (!e || e.dead) {
        this.attackTokens.delete(id);
        continue;
      }
      // 预警段（aim/charge）不释放令牌，它们后面还接着真正的生效段
      const attacking = TOKEN_RELEASING.includes(e.action);
      if (attacking && e.actionFrame >= ACTIONS[e.action].frames - 1) {
        this.attackTokens.delete(id);
        e.attackCooldown = ENEMY_PROFILES[e.kind ?? 'grunt'].tokenCooldown;
      }
    }
  }

  /**
   * 预警更新。逻辑层只声明「这一招现在看得见」，形状怎么画是渲染层的事。
   * 只给敌人生成——玩家不需要预告自己要干什么。
   */
  private updateTelegraphs(): void {
    for (const e of this.entities) {
      if (e.dead || e.team !== 'enemy') {
        e.telegraph = null;
        continue;
      }
      const tel = ACTIONS[e.action].telegraph;
      if (!tel || e.actionFrame >= tel.until) {
        e.telegraph = null;
        continue;
      }
      e.telegraph = { shape: tel.shape, frame: e.actionFrame, frames: tel.until };
    }
  }

  /** 攻击判定：只在 hitbox 生效帧内检测，且每次动作对同一目标只结算一次。 */
  private resolveHits(): void {
    for (const attacker of this.entities) {
      if (attacker.dead) continue;
      const def = ACTIONS[attacker.action];
      for (const box of def.hitboxes) {
        if (attacker.actionFrame < box.activeFrom || attacker.actionFrame >= box.activeTo) {
          continue;
        }
        // 环形判定不跟朝向翻转，范围技才能真正打到背后的人
        const cx = attacker.pos.x + (box.radial ? 0 : box.offset.x * attacker.facing);
        const cy = attacker.pos.y + box.offset.y;

        if (box.radial && attacker.team === 'player' && attacker.actionFrame === box.activeFrom) {
          this.events.skillCasts.push({ at: { x: cx, y: cy }, radius: box.halfWidth });
        }

        for (const target of this.entities) {
          if (target.dead || target.team === attacker.team) continue;
          if (this.isInvulnerable(target)) continue;
          if (attacker.hitTargets.has(target.id)) continue;

          const tx = target.pos.x + target.hurtbox.offset.x;
          const ty = target.pos.y + target.hurtbox.offset.y;
          const overlapX = Math.abs(tx - cx) <= box.halfWidth + target.hurtbox.halfWidth;
          const overlapY = Math.abs(ty - cy) <= box.halfDepth + target.hurtbox.halfDepth;
          if (!overlapX || !overlapY) continue;

          attacker.hitTargets.add(target.id);
          this.applyDamage(attacker, target, box.damage, box.knockback, box.hitStop);
        }
      }
    }
  }

  /** 无敌判定合并了两个来源：受击后的保护帧，和动作自带的无敌区间（冲刺、处决）。 */
  private isInvulnerable(e: Entity): boolean {
    return e.invulnFrames > 0 || isActionInvulnerable(e.action, e.actionFrame);
  }

  private spawnProjectile(shooter: Entity): void {
    const target = this.player;
    if (!target) return;
    const dx = target.pos.x - shooter.pos.x;
    const dy = target.pos.y - shooter.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = 6.2;
    this.projectiles.push({
      id: nextProjectileId++,
      team: shooter.team,
      owner: shooter.id,
      pos: { x: shooter.pos.x + shooter.facing * 18, y: shooter.pos.y - 4 },
      velocity: { x: (dx / len) * speed, y: (dy / len) * speed * 0.62 },
      radius: 7,
      damage: 11,
      knockback: 3.0,
      life: 150,
      dead: false,
    });
  }

  private updateProjectiles(): void {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.pos.x += p.velocity.x;
      p.pos.y += p.velocity.y;
      p.life -= 1;
      if (
        p.life <= 0 ||
        p.pos.x < this.arena.minX - 60 ||
        p.pos.x > this.arena.maxX + 60 ||
        p.pos.y < this.arena.minY - 60 ||
        p.pos.y > this.arena.maxY + 60
      ) {
        p.dead = true;
        continue;
      }
      for (const target of this.entities) {
        if (target.dead || target.team === p.team) continue;
        if (this.isInvulnerable(target)) continue;
        const dx = target.pos.x + target.hurtbox.offset.x - p.pos.x;
        const dy = target.pos.y + target.hurtbox.offset.y - p.pos.y;
        if (
          Math.abs(dx) > p.radius + target.hurtbox.halfWidth ||
          Math.abs(dy) > p.radius + target.hurtbox.halfDepth
        ) {
          continue;
        }
        const owner = this.entities.find((e) => e.id === p.owner);
        p.dead = true;
        this.applyProjectileDamage(owner, target, p);
        break;
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  private applyProjectileDamage(owner: Entity | undefined, target: Entity, p: Projectile): void {
    const dir: Facing = p.velocity.x >= 0 ? 1 : -1;
    this.dealDamage(target, p.damage, p.knockback, 5, dir, {
      attacker: owner?.id ?? -1,
      // 弹丸来自 aim 段，那 24 帧的射线就是它的预警
      telegraphed: true,
      attackerKind: owner?.kind,
    });
  }

  private applyDamage(
    attacker: Entity,
    target: Entity,
    damage: number,
    knockback: number,
    hitStop: number,
  ): void {
    let dealt = damage;

    // 玩家的成长加成（锋芒/玄术路线）。处决走的是必杀逻辑，不受这两条影响，
    // 所以放在 isExecute 覆盖之前应用没问题——反正后面会被直接盖掉。
    if (attacker.team === 'player') {
      dealt *=
        attacker.action === 'skill' ? attacker.skillDamageMultiplier : attacker.damageMultiplier;
    }

    let backstab = false;
    let guarded = false;

    // 盾兵的正反面差异。判断依据是攻击者站在防守者的哪一侧，
    // 不是攻击者自己的朝向——玩家绕到背后砍，砍的方向是朝回来的。
    if (target.frontalGuard !== undefined) {
      const fromFront = (attacker.pos.x - target.pos.x) * target.facing > 0;
      if (fromFront) {
        dealt *= target.frontalGuard;
        guarded = true;
      } else {
        dealt *= target.backstabMultiplier ?? 1;
        backstab = true;
      }
    }

    const isExecute = attacker.action === 'execute';
    if (isExecute) {
      // 处决只对残血目标起手，这里直接终结，不再走减伤
      dealt = target.hp;
      guarded = false;
    }

    const telegraphed = attacker.team === 'enemy' ? this.wasTelegraphed(attacker) : true;
    const killed = this.dealDamage(target, dealt, knockback, hitStop, attacker.facing, {
      attacker: attacker.id,
      backstab,
      guarded,
      execute: isExecute,
      telegraphed,
      attackerKind: attacker.kind,
    });

    // 玩家命中回能，攒够才能放技能——这条约束是「不无脑平 A」的支点之一
    if (attacker.team === 'player') {
      attacker.energy = Math.min(
        attacker.maxEnergy,
        attacker.energy + (isExecute ? ENERGY_PER_EXECUTE : ENERGY_PER_HIT),
      );
    }

    if (isExecute && killed) {
      const healed = EXECUTE_HEAL + attacker.executeHealBonus;
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + healed);
      this.stats.executes += 1;
      this.events.executes.push({ at: { x: target.pos.x, y: target.pos.y }, healed });
    }
  }

  /**
   * 伤害结算的唯一出口。近战和弹丸都走这里，
   * 免得「超级护甲」「无敌帧」「统计埋点」这些规则在两处各写一遍然后慢慢跑偏。
   */
  private dealDamage(
    target: Entity,
    damage: number,
    knockback: number,
    hitStop: number,
    dir: Facing,
    meta: {
      attacker: number;
      backstab?: boolean;
      guarded?: boolean;
      execute?: boolean;
      telegraphed?: boolean;
      attackerKind?: EnemyKind;
    },
  ): boolean {
    target.hp -= damage;
    const killed = target.hp <= 0;

    // 超级护甲：照常掉血，但不进硬直、不换动作。
    // 精英因此「打不断」，玩家只能靠走位躲而不是靠输出压制。
    const armored = ACTIONS[target.action].superArmor === true;
    if (armored) {
      // 仍给几帧无敌，防的是同一帧被多段判定重复结算，不是防连击
      target.invulnFrames = Math.max(target.invulnFrames, 6);
    } else {
      target.knockback.x = knockback * dir;
      target.knockback.y = 0;
      target.stunFrames = 12;
      target.invulnFrames = 20;
      this.setAction(target, 'hit');
    }

    if (killed) {
      target.hp = 0;
      target.dead = true;
      if (target.team === 'enemy') this.stats.recordKill(target.kind);
      if (target.team === 'player') this.stats.died = true;
    }

    if (target.team === 'player') {
      this.stats.recordDamageTaken(
        damage,
        meta.telegraphed === true,
        meta.attackerKind ?? 'unknown',
        killed,
      );
    }

    const event: DamageEvent = {
      attacker: meta.attacker,
      target: target.id,
      damage: Math.round(damage),
      at: { x: target.pos.x, y: target.pos.y },
      killed,
      backstab: meta.backstab,
      guarded: meta.guarded,
      execute: meta.execute,
      telegraphed: meta.telegraphed,
    };
    this.events.damage.push(event);
    // 击杀的定格更长一点，让"斩杀"这件事被看见
    this.events.hitStop = Math.max(this.events.hitStop, killed ? hitStop + 4 : hitStop);
    return killed;
  }

  /**
   * 这一招有没有给过预警。M1 验收第 4 条要求「所有致死伤害都有可见预警」，
   * 判定依据就是攻击动作本身是否声明了 telegraph，
   * 以及它是不是某个预警段接续下来的生效段（rush 接 charge、shoot 接 aim）。
   */
  private wasTelegraphed(attacker: Entity): boolean {
    if (ACTIONS[attacker.action].telegraph) return true;
    for (const [pre, post] of Object.entries(ACTION_CHAIN)) {
      if (post === attacker.action && ACTIONS[pre as ActionState].telegraph) return true;
    }
    return false;
  }

  /** 简单的圆形推挤，防止敌人叠在同一个点上变成一坨。 */
  private separate(): void {
    const list = this.entities.filter((e) => !e.dead);
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const dx = b.pos.x - a.pos.x;
        const dy = (b.pos.y - a.pos.y) * 1.6; // 纵深方向更"厚"，避免前后重叠
        const dist = Math.hypot(dx, dy) || 0.001;
        const min = a.radius + b.radius;
        if (dist >= min) continue;
        const push = (min - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        a.pos.x -= nx * push;
        a.pos.y -= (ny * push) / 1.6;
        b.pos.x += nx * push;
        b.pos.y += (ny * push) / 1.6;
      }
    }
  }

  private clampToArena(): void {
    for (const e of this.entities) {
      e.pos.x = Math.min(this.arena.maxX, Math.max(this.arena.minX, e.pos.x));
      e.pos.y = Math.min(this.arena.maxY, Math.max(this.arena.minY, e.pos.y));
    }
  }
}
