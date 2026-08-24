/**
 * 五种敌人的配置与行为。
 *
 * 设计纪律（GAME_DESIGN 3.5）：**差异必须体现在要求玩家做不同的事**，
 * 光改血量和伤害不算差异。所以每种敌人在这里都要能回答一句话——
 * 「它逼玩家做什么」。答不上来的类型就该砍掉，而不是调数值。
 *
 *   杂兵   贴脸压制        → 练连段，基础清怪
 *   盾兵   正面减伤 + 慢转身 → 用纵深绕到背后
 *   远程   远距离直线射击   → 用纵深躲线，或冲刺切进去
 *   冲锋   长蓄力后直线突进 → 读预警，侧向闪避
 *   精英   超级护甲 + 重击   → 拉开打，不能贴脸莽
 */
import type { ActionState, EnemyKind, Entity, InputIntent } from './types';

export interface EnemyProfile {
  kind: EnemyKind;
  /** 渲染层和调试面板用的短名 */
  label: string;
  hp: number;
  speed: number;
  radius: number;
  /** 进入攻击的距离 */
  reach: number;
  /** 没令牌时游走的待机圈半径 */
  standoff: number;
  /** 拿到令牌后起手的动作 */
  attackAction: ActionState;
  /** 交还令牌后的冷却帧，越长则该类型进攻频率越低 */
  tokenCooldown: number;
  /** 正面减伤系数（盾兵） */
  frontalGuard?: number;
  /** 背后受击的伤害倍率（盾兵弱点） */
  backstabMultiplier?: number;
  /** 转身所需的冷却帧，0 表示即时转向 */
  turnDelay: number;
}

export const ENEMY_PROFILES: Record<EnemyKind, EnemyProfile> = {
  grunt: {
    kind: 'grunt',
    label: '杂兵',
    hp: 42,
    speed: 1.35,
    radius: 15,
    reach: 46,
    standoff: 96,
    attackAction: 'slash',
    tokenCooldown: 42,
    turnDelay: 0,
  },

  /**
   * 盾兵：正面只吃 30% 伤害，背后吃 1.7 倍。
   * 转身要 26 帧才生效，这段窗口就是玩家绕后的机会——
   * 没有这个延迟，正面减伤只会变成「血更厚的杂兵」。
   */
  shield: {
    kind: 'shield',
    label: '盾兵',
    hp: 68,
    speed: 1.0,
    radius: 17,
    reach: 44,
    standoff: 84,
    attackAction: 'slash',
    tokenCooldown: 50,
    frontalGuard: 0.3,
    backstabMultiplier: 1.7,
    turnDelay: 26,
  },

  /**
   * 远程：血最薄，靠距离活着。玩家有两条解法——
   * 用纵深躲开射线，或者一个冲刺切进去秒掉。两条都通才算设计成立。
   */
  ranged: {
    kind: 'ranged',
    label: '远程',
    hp: 28,
    speed: 1.15,
    radius: 14,
    reach: 300,
    standoff: 240,
    attackAction: 'aim',
    tokenCooldown: 64,
    turnDelay: 0,
  },

  /**
   * 冲锋：只在中远距离起手，贴脸时反而不突进（近了就先拉开）。
   * 这条约束是为了让它的威胁始终以「一条看得见的线」的形式出现，
   * 而不是贴在脸上突然撞一下——后者就是玩家眼里的「凭空掉血」。
   */
  charger: {
    kind: 'charger',
    label: '冲锋',
    hp: 46,
    speed: 1.5,
    radius: 15,
    // 起手线压在突进距离之内，否则蓄力演完也够不着人
    reach: 215,
    standoff: 190,
    attackAction: 'charge',
    tokenCooldown: 70,
    turnDelay: 0,
  },

  /**
   * 精英：超级护甲，硬直打不断。血厚、伤害高、前摇长。
   * 因为打不断，玩家贴脸输出会被重击换掉大半条血，只能拉开找窗口。
   */
  elite: {
    kind: 'elite',
    label: '精英',
    hp: 130,
    speed: 1.2,
    radius: 20,
    reach: 74,
    standoff: 120,
    attackAction: 'heavy',
    tokenCooldown: 78,
    turnDelay: 0,
  },

  /**
   * 首领：不逼玩家学一件新事，而是把前五关学到的东西全部收进一场考试——
   * 绕位躲重击、读预警躲突进、阶段二拉开躲范围技、处决收尾。
   *
   * tokenCooldown 定在杂兵之上（50 vs 杂兵 42）：首领已经在伤害和判定范围
   * 两个维度都远超杂兵，**不能再让出手频率也最高**——实测第一版给了 26 帧
   * （全场最短），结果 bot 在 11 秒内被打死，boss 自己的血还没掉到能触发
   * 阶段二。伤害、范围、频率三个维度同时拉满，等于把 M1 已经验证过的
   * 「同时能打你的人数决定能不能玩」的教训，换了个形式在单体身上重演——
   * 招架不住不是因为技术不够，是节奏上没有给反应的窗口。
   */
  boss: {
    kind: 'boss',
    label: '首领',
    hp: 420,
    speed: 1.1,
    radius: 26,
    reach: 96,
    standoff: 150,
    attackAction: 'bossSlam',
    tokenCooldown: 50,
    turnDelay: 0,
  },
};

/**
 * 分类型的 AI。返回的是「意图」，由 world 统一翻译成动作与位移——
 * AI 不直接改实体状态，这样出手时机才全部收敛在令牌系统里。
 */
export function think(
  e: Entity,
  target: Entity,
  tick: number,
  holdsToken: boolean,
): InputIntent {
  const profile = ENEMY_PROFILES[e.kind ?? 'grunt'];
  const dx = target.pos.x - e.pos.x;
  const dy = target.pos.y - e.pos.y;
  const dist = Math.hypot(dx, dy) || 0.001;

  // 侧向游走：错开相位，五个敌人才不会像一个整体那样平移
  const drift = Math.sin((tick + e.id * 37) * 0.02) * 0.5;

  if (holdsToken) {
    switch (profile.kind) {
      case 'ranged':
        // 远程在射程内就地起手；太近先退开，贴脸射击等于放弃了自己的定位
        if (dist < 130) {
          return { moveX: -dx / dist, moveY: -dy / dist + drift, attack: false, dash: false };
        }
        if (dist <= profile.reach) {
          return { moveX: 0, moveY: 0, attack: true, dash: false };
        }
        break;

      case 'charger':
        // 冲锋要有助跑空间才起手，贴脸时先拉开
        if (dist < 120) {
          return { moveX: -dx / dist, moveY: -dy / dist, attack: false, dash: false };
        }
        if (dist <= profile.reach) {
          return { moveX: 0, moveY: 0, attack: true, dash: false };
        }
        break;

      case 'boss': {
        // 太远：先靠近，不在这个距离浪费一次突进——那样冲到一半就落空了
        if (dist > 230) break;
        // 中距离：突进拉近，逼玩家读预警侧移，和冲锋的道理一样但覆盖范围更大。
        // 这一条不看「上一招是什么」，纯按距离触发——所以重击收招后玩家一旦
        // 后撤到这个区间，下一次决策自然会追出一次突进。这是「衔接」而不是
        // 巧合：招式选择是无记忆的纯距离判断，撤退本身就会被读成新的起手线。
        if (dist > 140) {
          return { moveX: 0, moveY: 0, attack: true, dash: false, action: 'bossCharge' };
        }
        // 连续技：范围技收招后，只要玩家还在重击范围内（没能借着 bossNova
        // 30 帧的长前摇拉开距离到 140 外），下一招强制接重击，不吃平时的
        // 节奏轮换判定。「没躲开范围技」和「躲开了但还站在原地」都该有代价——
        // 否则阶段二唯一的范围判定打完就是孤立的一次性事件，学会站位躲一次
        // 之后，后续再没有跟进压力，逼玩家拉开距离这件事就只剩这一下的分量。
        if (e.ai.bossPhase === 2 && e.action === 'bossNova') {
          return { moveX: 0, moveY: 0, attack: true, dash: false, action: 'bossSlam' };
        }
        // 近距离：阶段二每隔一段固定节奏换一次范围技，制造节奏变化但保持确定性
        // （不用随机数，是为了自动化验证能重复同一套招式序列）
        if (e.ai.bossPhase === 2 && Math.floor(tick / 200) % 3 === 2) {
          return { moveX: 0, moveY: 0, attack: true, dash: false, action: 'bossNova' };
        }
        return { moveX: 0, moveY: 0, attack: true, dash: false, action: 'bossSlam' };
      }

      default:
        if (dist <= profile.reach) {
          return { moveX: 0, moveY: 0, attack: true, dash: false };
        }
        break;
    }
    return { moveX: dx / dist, moveY: dy / dist, attack: false, dash: false };
  }

  // 没令牌：在待机圈上游走，制造包围感但不出手
  const ring = profile.standoff;
  if (dist < ring * 0.85) {
    return { moveX: -dx / dist, moveY: -dy / dist + drift, attack: false, dash: false };
  }
  if (dist > ring * 1.25) {
    return { moveX: dx / dist, moveY: dy / dist, attack: false, dash: false };
  }
  return { moveX: 0, moveY: drift, attack: false, dash: false };
}
