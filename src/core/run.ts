/**
 * 一次闯关的状态机：当前在哪间房、清了哪些、门开没开、进门切到哪。
 *
 * 分层原则（LEVEL_DESIGN 第九节）：
 *   World 只管**一场战斗**，它不知道自己是第几间房。
 *   Run 管**房间之间**的事，它持有 World，反过来不行。
 *
 * 进新房间 = 用新的 arena 和编成建一个新 World。
 * 玩家的血量和能量跨房间保留，所以「玩家档案」必须和「玩家实体」分开——
 * 实体随房间生灭，档案跟着 Run 走完全程。
 */
import type { Direction, RoomDef, StageDef } from './level';
import { OPPOSITE, arenaOf, findRoom } from './level';
import { DEFAULT_PROFESSION } from './types';
import type { Entity, Profession, Vec2, WorldEvents } from './types';
import type { Arena, InputState } from './world';
import { World, createEnemy, createEntity } from './world';
import { RunStats } from './stats';
import type { UpgradeTrackId } from './upgrades';
import { availableTracks, computeUpgradeStats } from './upgrades';

/** 血量成长的基准值，不能让 profile.maxHp 自己滚雪球——见 upgrades.ts 顶部说明。 */
const BASE_MAX_HP = 160;

/** 跨房间保留的玩家状态。实体是一次性的，这份档案不是。 */
export interface PlayerProfile {
  /** M2 职业跨房间保留，后续职业选择界面只改这份档案。 */
  profession: Profession;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  speed: number;
  /** 三条成长路线各选到第几级，见 core/upgrades.ts */
  upgrades: Record<UpgradeTrackId, number>;
}

export function createProfile(): PlayerProfile {
  return {
    profession: DEFAULT_PROFESSION,
    hp: BASE_MAX_HP,
    maxHp: BASE_MAX_HP,
    energy: 0,
    maxEnergy: 100,
    speed: 2.9,
    upgrades: { offense: 0, arcane: 0, guardian: 0 },
  };
}

export type RunPhase =
  /** 房间里还有活敌人 */
  | 'fighting'
  /** 清空了，门已开，等玩家走向出口 */
  | 'cleared'
  /** 站在奖励房里，等玩家三选一 */
  | 'choosing'
  /** 正在切换房间 */
  | 'transition'
  /** 整关打完 */
  | 'stageComplete'
  | 'dead';

/**
 * 清空到开门之间的停顿帧。
 * 斩杀最后一个敌人那一下是有分量的，立刻开门会把它吃掉——
 * 留出时间让飘字、震屏和死亡淡出播完。
 */
const CLEAR_DELAY = 40;

/** 切房间的过渡帧数。不做黑屏加载，只给渲染层一个推镜的时间。 */
const TRANSITION_FRAMES = 20;

/** 门的判定半径。玩家中心进这个圈就算走过去了。 */
const DOOR_RADIUS = 46;

/**
 * 进门后，来路那扇门的豁免帧数——这段时间内它不判定，无论玩家站在哪。
 *
 * 不能靠"玩家走出判定圈才解锁"：checkDoors 只在房间已清空时才会被调用，
 * 房间还在打的时候完全不检测。等到清空那一刻才第一次检测时，玩家可能
 * 刚好因为最后一击的位置或击退，正站在来路门判定圈里——这种情况下
 * "从没检测到走出过"，门会一直锁死，直到 300 帧超时兜底才解开。
 * 固定豁免期不依赖这个可能从未发生的事件，天然没有这个死锁窗口。
 */
const ENTRY_GRACE_FRAMES = 80;

/** 门在场地边缘的位置。渲染层画门、逻辑层判定进门，共用这一个函数。 */
export function doorPosition(arena: Arena, dir: Direction): Vec2 {
  const midX = (arena.minX + arena.maxX) / 2;
  const midY = (arena.minY + arena.maxY) / 2;
  switch (dir) {
    case 'east':
      return { x: arena.maxX, y: midY };
    case 'west':
      return { x: arena.minX, y: midY };
    case 'north':
      return { x: midX, y: arena.minY };
    default:
      return { x: midX, y: arena.maxY };
  }
}

export class Run {
  stage: StageDef;
  room: RoomDef;
  world: World;
  profile: PlayerProfile;

  /** 已清空的房间。清空后不再刷怪，玩家可以自由回走。 */
  cleared = new Set<string>();
  /** 已进过的房间，小地图据此决定画不画 */
  visited = new Set<string>();

  /** 清空后的停顿计时 */
  private clearDelay = 0;
  /** 过渡剩余帧，渲染层读它做推镜 */
  transition = 0;
  /** 从哪个方向进来的，用来决定出生点 */
  private enteredFrom: Direction | null = null;
  /** 进门时锁住来路那扇门，固定 ENTRY_GRACE_FRAMES 帧后自动解锁 */
  private doorLock: Direction | null = null;
  private doorLockFrames = 0;

  /**
   * 奖励房当前待选的路线；不在奖励房或已经选完时为 null。
   * 不为 null 时房间不会被自动标记清空——见 step() 里对 reward 房的特殊处理。
   */
  pendingChoice: UpgradeTrackId[] | null = null;

  /** 整关的累计统计。每间房的 World 各有一份，这里汇总。 */
  stats = new RunStats();

  constructor(stage: StageDef, profile: PlayerProfile = createProfile()) {
    this.stage = stage;
    this.profile = profile;
    const start = findRoom(stage, stage.startRoom);
    if (!start) throw new Error(`关卡 ${stage.id} 找不到起始房间 ${stage.startRoom}`);
    this.room = start;
    this.world = this.buildWorld(start, null);
    this.applyUpgradeStatsToPlayer();
    this.visited.add(start.id);
    this.settleEmptyRoom(start);
  }

  /** 当前房间已开的门。没清空的房间一扇都不开。 */
  get openDoors(): Direction[] {
    if (!this.cleared.has(this.room.id)) return [];
    return (Object.keys(this.room.doors) as Direction[]).filter((d) => this.room.doors[d]);
  }

  get player(): Entity | undefined {
    return this.world.player;
  }

  /**
   * 职业先写档案再同步当前实体：档案保证切房后不丢，实体保证当前房间立刻生效。
   * 后续职业选择界面和开发期调试入口都必须走这里，不能各自只改一边。
   */
  setProfession(profession: Profession): void {
    this.profile.profession = profession;
    if (this.player) this.player.profession = profession;
  }

  /** 整关是否打完：所有房间都清空了 */
  get stageCleared(): boolean {
    return this.stage.rooms.every((r) => this.cleared.has(r.id));
  }

  /**
   * 当前阶段。**从状态推导，不留可写字段**——
   * 一开始是拿字段存的，结果起始房明明已清空、phase 还写着 fighting，
   * 于是「门已开」的提示不显示。这类「事实和标记不同步」的 bug
   * 只要留着可写字段就会反复长出来，推导一次就断根了。
   */
  get phase(): RunPhase {
    if (this.world.stats.died) return 'dead';
    if (this.transition > 0) return 'transition';
    if (this.pendingChoice) return 'choosing';
    if (this.stageCleared) return 'stageComplete';
    if (this.cleared.has(this.room.id)) return 'cleared';
    return 'fighting';
  }

  /**
   * 整局（跨房间）的统计摘要，给结算界面用。
   *
   * `this.stats` 只在切房间那一刻（`enterRoom`）被 `absorb` 过之前几间房的数据，
   * 当前正在打的这间房（包括停在 stageComplete 时的那间房——首领房打完
   * 不会再触发 `enterRoom`）还只存在 `this.world.stats` 里，没被折进来。
   * 这里现算一份合并结果，不直接修改 `this.stats`，避免每帧调用都重复叠加。
   */
  overallSummary(): ReturnType<RunStats['summary']> & { profession: Profession } {
    const merged = new RunStats();
    merged.frames = this.stats.frames;
    merged.died = this.stats.died;
    merged.absorb(this.stats);
    merged.absorb(this.world.stats);
    return { profession: this.profile.profession, ...merged.summary() };
  }

  step(input: InputState): WorldEvents {
    const empty: WorldEvents = {
      damage: [],
      hitStop: 0,
      executes: [],
      skillCasts: [],
      bossPhaseShifts: [],
    };

    if (this.transition > 0) {
      this.transition -= 1;
      return empty;
    }

    const events = this.world.step(input);
    this.syncProfile();
    this.stats.frames += 1;
    // 豁免期按真实经过的逻辑帧计时，不依赖 checkDoors 有没有被调用过——
    // 房间还在打的时候 checkDoors 完全不会跑，见 ENTRY_GRACE_FRAMES 的说明。
    if (this.doorLock) this.doorLockFrames += 1;

    if (this.world.stats.died) {
      this.stats.died = true;
      return events;
    }

    // 奖励房没有敌人，roomIsClear() 恒为 true——不排除的话它会被这条
    // 「没有活敌人就算清空」的规则立刻标记清空，三选一环节直接被跳过。
    // 奖励房只能通过 chooseUpgrade() 清空。
    if (this.room.kind !== 'reward' && !this.cleared.has(this.room.id) && this.roomIsClear()) {
      this.markCleared(this.room);
      // 斩杀最后一个敌人那一下是有分量的，先让飘字和震屏播完再开门
      this.clearDelay = CLEAR_DELAY;
    }

    if (this.clearDelay > 0) {
      this.clearDelay -= 1;
      return events;
    }

    if (this.cleared.has(this.room.id)) {
      this.checkDoors();
    }

    return events;
  }

  private roomIsClear(): boolean {
    return !this.world.entities.some((e) => e.team === 'enemy' && !e.dead);
  }

  private markCleared(room: RoomDef): void {
    this.cleared.add(room.id);
  }

  /**
   * 玩家走进任意一扇开着的门就切房间。
   *
   * 来路那扇门有 ENTRY_GRACE_FRAMES 帧的豁免期，期间不判定——
   * 不管玩家站在哪。出生点离纵深门只有 37px，判定半径却是 46px，
   * 不豁免的话进门瞬间就会被判定成「又走进来路的门」，弹回上一间。
   */
  private checkDoors(): void {
    const player = this.world.player;
    if (!player) return;
    const locked = this.doorLock && this.doorLockFrames < ENTRY_GRACE_FRAMES;
    for (const dir of this.openDoors) {
      if (locked && dir === this.doorLock) continue;
      const target = this.room.doors[dir];
      if (!target) continue;
      const at = doorPosition(this.world.arena, dir);
      const within = Math.hypot(player.pos.x - at.x, player.pos.y - at.y) <= DOOR_RADIUS;
      if (within) {
        this.enterRoom(target, dir);
        return;
      }
    }
  }

  enterRoom(id: string, viaDoor: Direction | null): void {
    const next = findRoom(this.stage, id);
    if (!next) return;
    this.syncProfile();
    // 这间房的 World 就要被换掉、连同它自己的 RunStats 一起丢弃了——
    // 先把数据折进整局的累计统计，不然这间房里打出的击杀、完美取消、
    // 承受伤害等数字会随着旧 World 一起消失，结算界面就只剩最后一间房的数据。
    this.stats.absorb(this.world.stats);
    this.room = next;
    this.enteredFrom = viaDoor ? OPPOSITE[viaDoor] : null;
    this.doorLock = this.enteredFrom;
    this.doorLockFrames = 0;
    this.world = this.buildWorld(next, this.enteredFrom);
    this.applyUpgradeStatsToPlayer();
    this.visited.add(next.id);
    this.transition = TRANSITION_FRAMES;
    this.settleEmptyRoom(next);
  }

  /**
   * 没有战斗编成的房间要不要立即算清空，取决于房间类型：
   * 普通空房间（start 或误配成空编成的房间）直接放行；
   * 奖励房要停下来等三选一，不能被「反正没有编成」这条捷径绕过去。
   */
  private settleEmptyRoom(room: RoomDef): void {
    // 已经清空过就不再处理——不判重的话，原路走回一间选过的奖励房
    // 会重新弹出三选一，玩家靠来回横跳就能无限刷加成。
    if (this.cleared.has(room.id)) return;
    if (room.kind === 'reward') {
      this.beginRewardChoice(room);
      return;
    }
    if (room.encounter.length === 0) this.markCleared(room);
  }

  /** 生成本次奖励房的选项。三条都已满级就没什么可选，直接放行。 */
  private beginRewardChoice(room: RoomDef): void {
    const options = availableTracks(this.profile.upgrades);
    if (options.length === 0) {
      this.markCleared(room);
      return;
    }
    this.pendingChoice = options.slice(0, 3);
  }

  /**
   * 玩家在三选一里选了一条路线。
   * 立即把加成写回当前 world 里的玩家实体——玩家马上要走出这间房继续打，
   * 不能等到下一次 buildWorld 才生效。
   */
  chooseUpgrade(trackId: UpgradeTrackId): void {
    if (!this.pendingChoice || !this.pendingChoice.includes(trackId)) return;
    this.profile.upgrades[trackId] += 1;

    if (trackId === 'guardian') {
      // 血量上限是相对 BASE_MAX_HP 的倍率，不能滚雪球；
      // 涨的那部分直接加到当前血量，选级就该立刻感觉到变强。
      const stats = computeUpgradeStats(this.profile.upgrades);
      const newMaxHp = BASE_MAX_HP * stats.maxHpMultiplier;
      const delta = Math.max(0, newMaxHp - this.profile.maxHp);
      this.profile.maxHp = newMaxHp;
      this.profile.hp = Math.min(newMaxHp, this.profile.hp + delta);
    }

    this.applyUpgradeStatsToPlayer();
    this.pendingChoice = null;
    this.markCleared(this.room);
  }

  /** 把 profile.upgrades 换算出的倍率写到当前玩家实体上 */
  private applyUpgradeStatsToPlayer(): void {
    const player = this.world.player;
    if (!player) return;
    const stats = computeUpgradeStats(this.profile.upgrades);
    player.damageMultiplier = stats.damageMultiplier;
    player.skillDamageMultiplier = stats.skillDamageMultiplier;
    player.skillCostMultiplier = stats.skillCostMultiplier;
    player.executeHealBonus = stats.executeHealBonus;
    player.maxHp = this.profile.maxHp;
    player.hp = this.profile.hp;
  }

  /**
   * 建一间房的 World。
   * 玩家档案在这里注回新实体——这是「跨房间保留状态」的落点。
   */
  private buildWorld(room: RoomDef, from: Direction | null): World {
    const arena = arenaOf(room);
    const w = new World(arena);
    w.maxAttackers = this.stage.maxAttackers;

    const spawn = this.playerSpawn(arena, from);
    w.spawn(
      createEntity('player', spawn, {
        profession: this.profile.profession,
        hp: this.profile.hp,
        maxHp: this.profile.maxHp,
        energy: this.profile.energy,
        maxEnergy: this.profile.maxEnergy,
        speed: this.profile.speed,
        // 从西门进来的朝东走，从东门进来的朝西走
        facing: from === 'east' ? -1 : 1,
      }),
    );

    if (!this.cleared.has(room.id)) {
      this.spawnEncounter(w, arena, room);
    }
    return w;
  }

  /** 玩家出现在进来的那扇门内侧；没有来路（开局）时站在场地左侧 */
  private playerSpawn(arena: Arena, from: Direction | null): Vec2 {
    if (!from) {
      return { x: arena.minX + 120, y: (arena.minY + arena.maxY) / 2 + 20 };
    }
    const at = doorPosition(arena, from);
    const inset = 62;
    switch (from) {
      case 'east':
        return { x: at.x - inset, y: at.y };
      case 'west':
        return { x: at.x + inset, y: at.y };
      case 'north':
        return { x: at.x, y: at.y + inset * 0.6 };
      default:
        return { x: at.x, y: at.y - inset * 0.6 };
    }
  }

  /**
   * 敌人一次性全部入场，撒在远离玩家的那一侧。
   * 不做分批补兵：房间制下「清空」是明确的推进信号，
   * 分批会让玩家以为打完了又冒出来，反而模糊了节奏。
   */
  private spawnEncounter(w: World, arena: Arena, room: RoomDef): void {
    const midY = (arena.minY + arena.maxY) / 2;
    const depth = arena.maxY - arena.minY;
    const n = room.encounter.length;

    // 单个敌人（首领房）不用套多敌人的错位散布公式——那套公式是为了
    // 避免几个敌人叠成一条线设计的，唯一的敌人没有这个问题，
    // 直接站纵深正中央，首领登场才够稳重。
    if (n === 1) {
      w.spawn(createEnemy(room.encounter[0], { x: arena.maxX - 130, y: midY }));
      return;
    }

    room.encounter.forEach((kind, i) => {
      const col = Math.floor(i / 3);
      const x = arena.maxX - 110 - col * 96;
      // 纵深上错开排布，避免站成一条直线
      const spread = depth * 0.34;
      const y = midY + ((i % 3) - 1) * (spread / Math.max(1, Math.min(3, n) - 1 || 1));
      w.spawn(
        createEnemy(kind, {
          x: Math.max(arena.minX + 40, Math.min(arena.maxX - 40, x)),
          y: Math.max(arena.minY + 20, Math.min(arena.maxY - 20, y)),
        }),
      );
    });
  }

  /** 把实体上的血量和能量写回档案，供下一间房用 */
  private syncProfile(): void {
    const p = this.world.player;
    if (!p) return;
    this.profile.hp = p.hp;
    this.profile.energy = p.energy;
  }
}
