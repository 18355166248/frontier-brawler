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
  Facing,
  Team,
  Vec2,
  WorldEvents,
} from './types';
import { ACTIONS, canInterrupt } from './actions';

export interface Arena {
  /** 可行走区域，纵深范围比横向窄得多——这是横版的空间感来源 */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface InputState {
  moveX: number;
  moveY: number;
  attack: boolean;
  dash: boolean;
}

export const EMPTY_INPUT: InputState = { moveX: 0, moveY: 0, attack: false, dash: false };

let nextId = 1;

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
    dead: false,
    deadFrames: 0,
    ...overrides,
  };
}

export class World {
  entities: Entity[] = [];
  arena: Arena;
  /** 命中定格剩余帧。大于 0 时整个世界冻结，只有表现层继续播。 */
  freezeFrames = 0;
  /** 本轮允许出手的敌人 id。见 enemyThink 里对「攻击令牌」的说明。 */
  attackTokens = new Set<number>();
  /** 同时最多几个敌人能进攻。2 是清版格斗的常用值：有压迫感又留得出反击窗口。 */
  maxAttackers = 2;
  /** 逻辑帧计数，用于让敌人的游走错开相位 */
  tick = 0;
  events: WorldEvents = { damage: [], hitStop: 0 };

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
    this.events = { damage: [], hitStop: 0 };

    // 命中定格：全局冻结几帧，是「打到实处」最廉价也最有效的反馈。
    // 冻结期间不推进任何逻辑，连动画帧也停——这正是它有效的原因。
    if (this.freezeFrames > 0) {
      this.freezeFrames -= 1;
      return this.events;
    }

    this.tick += 1;
    this.updateTokens();

    for (const e of this.entities) {
      if (e.dead) {
        e.deadFrames += 1;
        continue;
      }
      if (e.attackCooldown > 0) e.attackCooldown -= 1;
      const control = e.team === 'player' ? input : this.enemyThink(e);
      this.stepEntity(e, control);
    }

    this.releaseFinishedTokens();

    this.resolveHits();
    this.separate();
    this.clampToArena();

    if (this.events.hitStop > 0) {
      this.freezeFrames = this.events.hitStop;
    }
    return this.events;
  }

  private stepEntity(e: Entity, input: InputState): void {
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

    const def = ACTIONS[e.action];
    const interruptible = canInterrupt(e.action, e.actionFrame);

    // 连招：在收招段按攻击可以接下一段
    if (input.attack && interruptible) {
      const next = def.cancelInto?.[0];
      if (next && e.action !== next) {
        this.setAction(e, next);
      } else if (e.action !== 'slash' && e.action !== 'slash2') {
        this.setAction(e, 'slash');
      }
    } else if (input.dash && interruptible && e.action !== 'dash') {
      this.setAction(e, 'dash');
    }

    // 动作自带的位移（挥砍前冲、冲刺）优先于主动移动
    const motion = ACTIONS[e.action].motion;
    if (motion && e.actionFrame < motion.length) {
      e.pos.x += motion[e.actionFrame] * e.facing;
    } else if (canInterrupt(e.action, e.actionFrame)) {
      const len = Math.hypot(input.moveX, input.moveY);
      if (len > 0.01) {
        const nx = input.moveX / len;
        const ny = input.moveY / len;
        e.pos.x += nx * e.speed;
        // 纵深方向移速压低，否则斜着走会比横着走快，而且纵深过快会破坏横版的空间感
        e.pos.y += ny * e.speed * 0.62;
        if (Math.abs(nx) > 0.2) e.facing = (nx > 0 ? 1 : -1) as Facing;
        if (e.action === 'idle') this.setAction(e, 'move');
      } else if (e.action === 'move') {
        this.setAction(e, 'idle');
      }
    }

    this.advanceAction(e);
  }

  private advanceAction(e: Entity): void {
    const def = ACTIONS[e.action];
    e.actionFrame += 1;
    if (e.actionFrame >= def.frames) {
      if (def.loop) {
        e.actionFrame = 0;
      } else {
        this.setAction(e, 'idle');
      }
    }
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
   */
  private enemyThink(e: Entity): InputState {
    const target = this.player;
    if (!target) return EMPTY_INPUT;
    const dx = target.pos.x - e.pos.x;
    const dy = target.pos.y - e.pos.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    if (Math.abs(dx) > 1) e.facing = (dx > 0 ? 1 : -1) as Facing;

    const reach = 46;
    const standoff = 96;
    const holdsToken = this.attackTokens.has(e.id);

    if (holdsToken) {
      if (dist <= reach) {
        return { moveX: 0, moveY: 0, attack: true, dash: false };
      }
      return { moveX: dx / dist, moveY: dy / dist, attack: false, dash: false };
    }

    // 没令牌：保持在待机圈上，太近就退开，太远就靠拢，同时侧向游走
    const drift = Math.sin((this.tick + e.id * 37) * 0.02) * 0.5;
    if (dist < standoff * 0.85) {
      return { moveX: -dx / dist, moveY: -dy / dist + drift, attack: false, dash: false };
    }
    if (dist > standoff * 1.25) {
      return { moveX: dx / dist, moveY: dy / dist, attack: false, dash: false };
    }
    return { moveX: 0, moveY: drift, attack: false, dash: false };
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
      const attacking = e.action === 'slash' || e.action === 'slash2';
      if (attacking && e.actionFrame >= ACTIONS[e.action].frames - 1) {
        this.attackTokens.delete(id);
        e.attackCooldown = 42;
      }
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
        const cx = attacker.pos.x + box.offset.x * attacker.facing;
        const cy = attacker.pos.y + box.offset.y;

        for (const target of this.entities) {
          if (target.dead || target.team === attacker.team) continue;
          if (target.invulnFrames > 0) continue;
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

  private applyDamage(
    attacker: Entity,
    target: Entity,
    damage: number,
    knockback: number,
    hitStop: number,
  ): void {
    target.hp -= damage;
    target.knockback.x = knockback * attacker.facing;
    target.knockback.y = 0;
    target.stunFrames = 12;
    target.invulnFrames = 20;
    this.setAction(target, 'hit');

    const killed = target.hp <= 0;
    if (killed) {
      target.hp = 0;
      target.dead = true;
    }
    const event: DamageEvent = {
      attacker: attacker.id,
      target: target.id,
      damage,
      at: { x: target.pos.x, y: target.pos.y },
      killed,
    };
    this.events.damage.push(event);
    // 击杀的定格更长一点，让"斩杀"这件事被看见
    this.events.hitStop = Math.max(this.events.hitStop, killed ? hitStop + 4 : hitStop);
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
