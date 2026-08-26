#!/usr/bin/env node

/**
 * M2/M4 自动玩家：跑真实 Run/World 状态机，但明确只产“模拟样本”。
 * 它用于提前发现职业无法通关、动作分布坍缩或关卡异常，不能替代真人手感验收。
 */
import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: [
      "export * from './src/core/actions.ts';",
      "export * from './src/core/run.ts';",
      "export * from './src/core/stages.ts';",
      "export * from './src/core/world.ts';",
      "export * from './src/dev/profession-validation.ts';",
    ].join('\n'),
    resolveDir: process.cwd(),
    sourcefile: 'simulation-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
  logLevel: 'silent',
});

const source = bundled.outputFiles[0]?.text;
if (!source) throw new Error('无法加载游戏核心');
const game = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const {
  EMPTY_INPUT,
  ProfessionValidationStore,
  Run,
  STAGES,
  createProfile,
  createStageProfile,
  resetWorldIdsForTesting,
} = game;

const PROFESSIONS = ['heavy', 'swift', 'arcane'];
const RUNS_PER_STAGE = 3;
const MAX_FRAMES = 60 * 300;
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;

const store = new ProfessionValidationStore(null);
const samples = [];

for (const profession of PROFESSIONS) {
  for (const stage of STAGES) {
    for (let variant = 0; variant < RUNS_PER_STAGE; variant += 1) {
      const { sample } = simulateStage(stage, profession, variant);
      samples.push(sample);
      store.record(stage.id, sample.cleared, sample.summary);
    }
  }
}

const professionReport = store.report();
const campaignStore = new ProfessionValidationStore(null);
const campaignSamples = [];
for (const profession of PROFESSIONS) {
  for (let variant = 0; variant < RUNS_PER_STAGE; variant += 1) {
    let profile = createProfile();
    for (const stage of STAGES) {
      const result = simulateStage(stage, profession, variant, profile, 'campaign');
      campaignSamples.push(result.sample);
      campaignStore.record(stage.id, result.sample.cleared, result.sample.summary);
      profile = createStageProfile(result.profile);
    }
  }
}
const equipmentReport = campaignStore.equipmentReport();
const coverage = store.coverage(
  STAGES.map((stage) => stage.id),
  RUNS_PER_STAGE,
);
const perStage = PROFESSIONS.flatMap((profession) =>
  STAGES.map((stage) => {
    const rows = samples.filter(
      (sample) => sample.profession === profession && sample.stageId === stage.id,
    );
    return {
      profession,
      stage: stage.id,
      attempts: rows.length,
      clears: rows.filter((row) => row.cleared).length,
      successRate: round(rows.filter((row) => row.cleared).length / Math.max(1, rows.length)),
      averageSeconds: round(average(rows.map((row) => row.summary.seconds))),
      averageDamageTaken: round(average(rows.map((row) => row.summary.damageTaken))),
    };
  }),
);

const successRates = professionReport.map((row) => row.successRate);
const stageSuccessRateSpreads = STAGES.map((stage) => {
  const rates = perStage
    .filter((row) => row.stage === stage.id)
    .map((row) => row.successRate);
  return {
    stage: stage.id,
    spread: round(Math.max(...rates) - Math.min(...rates)),
  };
});
const maximumStageSuccessRateSpread = Math.max(
  ...stageSuccessRateSpreads.map((row) => row.spread),
);
const overallSuccessRateSpread = Math.max(...successRates) - Math.min(...successRates);
const report = {
  schemaVersion: 1,
  sampleType: 'simulation-not-human',
  generatedAt: new Date().toISOString(),
  config: {
    professions: PROFESSIONS,
    stages: STAGES.map((stage) => stage.id),
    runsPerStage: RUNS_PER_STAGE,
    maxFramesPerStage: MAX_FRAMES,
    equipment: 'elite and boss drops auto-equipped; campaign inventory carries between stages',
  },
  professionReport,
  equipmentReport,
  coverage,
  perStage,
  stageSuccessRateSpreads,
  equipmentCampaign: {
    description: 'six-stage progression with inventory and loadout carried between stages',
    report: equipmentReport,
    samples: campaignSamples,
  },
  acceptanceSignals: {
    allStageRunsCompleted: samples.every((sample) => sample.terminal),
    allCoverageComplete: coverage.every((row) => row.complete),
    overallSuccessRateSpread: round(overallSuccessRateSpread),
    overallSuccessRateSpreadBelow20Percent: overallSuccessRateSpread < 0.2,
    maximumStageSuccessRateSpread: round(maximumStageSuccessRateSpread),
    sameStageSuccessRateSpreadBelow20Percent: maximumStageSuccessRateSpread < 0.2,
    equipmentTopLoadoutShare: equipmentReport.topLoadoutShare,
    equipmentTopLoadoutShareBelow40Percent: equipmentReport.passesDiversityTarget,
  },
  samples,
};

console.table(
  professionReport.map((row) => ({
    profession: row.profession,
    samples: row.samples,
    successRate: `${Math.round(row.successRate * 100)}%`,
    seconds: row.averageSeconds,
    move: row.averageMoveDistance,
    engagement: row.averageEngagementDistance,
  })),
);
console.table(perStage);
console.log('[simulate_validation] 连续战役头部配装占比', equipmentReport.topLoadoutShare);
console.log('[simulate_validation] 模拟样本，不可替代真人验收');
console.log(JSON.stringify(report.acceptanceSignals, null, 2));

if (outputPath) {
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[simulate_validation] 报告已写入 ${outputPath}`);
}

function simulateStage(stage, profession, variant, profile = createProfile(), mode = 'isolated') {
  // Entity id 会参与敌人游走相位；每份样本重置后才不会受上一局路径长短影响。
  resetWorldIdsForTesting();
  const run = new Run(stage, profile);
  run.setProfession(profession);
  let frame = 0;

  while (frame < MAX_FRAMES && run.phase !== 'dead' && run.phase !== 'stageComplete') {
    if (run.pendingChoice) {
      // 自动玩家优先选择容错路线，模拟“以通关为目标”的正常决策，不给角色改数值。
      const option = run.pendingChoice.includes('guardian')
        ? 'guardian'
        : run.pendingChoice[(variant + run.cleared.size) % run.pendingChoice.length];
      run.chooseUpgrade(option);
      continue;
    }
    if (run.pendingEquipment) {
      const option = run.pendingEquipment[variant % run.pendingEquipment.length];
      run.chooseEquipment(option);
      // 连续战役里 Boss 掉落会带进下一关；独立关卡也保留最终配装，便于复核掉落链。
      run.equip(option);
      continue;
    }

    if (run.cleared.has(run.room.id)) {
      const nextRoom = nextUnclearedRoom(run);
      if (nextRoom) {
        run.enterRoom(nextRoom, null);
        continue;
      }
    }

    run.step(botInput(run, frame, variant));
    frame += 1;
  }

  return {
    profile: run.profile,
    sample: {
      mode,
      profession,
      stageId: stage.id,
      variant,
      terminal: run.phase === 'dead' || run.phase === 'stageComplete',
      cleared: run.phase === 'stageComplete',
      finalPhase: run.phase,
      finalRoom: run.room.id,
      remainingEnemies: run.world.entities
        .filter((entity) => entity.team === 'enemy' && !entity.dead)
        .map((entity) => ({
          kind: entity.kind,
          hp: round(entity.hp),
          x: round(entity.pos.x),
          y: round(entity.pos.y),
        })),
      framesSimulated: frame,
      summary: run.overallSummary(),
    },
  };
}

/** 找到通往任意未清房间的下一步；只跳过走到门口的机械耗时，不跳过战斗。 */
function nextUnclearedRoom(run) {
  const byId = new Map(run.stage.rooms.map((room) => [room.id, room]));
  const queue = [[run.room.id]];
  const seen = new Set([run.room.id]);
  while (queue.length) {
    const path = queue.shift();
    const room = byId.get(path[path.length - 1]);
    if (!room) continue;
    if (!run.cleared.has(room.id)) return path[1] ?? room.id;
    for (const target of Object.values(room.doors)) {
      if (!target || seen.has(target)) continue;
      seen.add(target);
      queue.push([...path, target]);
    }
  }
  return null;
}

function botInput(run, frame, variant) {
  const player = run.player;
  if (!player) return EMPTY_INPUT;
  const enemies = run.world.entities.filter((entity) => entity.team === 'enemy' && !entity.dead);
  if (!enemies.length) return EMPTY_INPUT;
  // 远程兵有优先级，但不能高到让机器人穿过贴脸精英追屏幕另一端的弓手。
  const rangedEnemies = enemies.filter((enemy) => enemy.kind === 'ranged');
  const targetPool =
    run.profile.profession !== 'arcane' && rangedEnemies.length >= 2 ? rangedEnemies : enemies;
  const targetScore = (enemy) => distance(player, enemy) - (enemy.kind === 'ranged' ? 40 : 0);
  const target = targetPool.reduce((best, enemy) =>
    targetScore(enemy) < targetScore(best) ? enemy : best,
  );
  const dx = target.pos.x - player.pos.x;
  const dy = target.pos.y - player.pos.y;
  const distanceToTarget = Math.hypot(dx, dy);
  const desired = run.profile.profession === 'arcane' ? 70 : run.profile.profession === 'heavy' ? 48 : 42;
  // 四分钟仍未结束就进入决胜阶段，停止无限规避；剩余一分钟必须打出通关或死亡终局。
  const committingToRanged =
    run.profile.profession !== 'arcane' &&
    target.kind === 'ranged' &&
    distance(player, target) < 110;
  const dangerous =
    frame < 60 * 240
      ? enemies.filter(
          (enemy) =>
            !(committingToRanged && enemy.action === 'aim') && isDangerous(enemy, player),
        )
      : [];
  const executeRange = run.profile.profession === 'arcane' ? 100 : 70;
  const executable = enemies.some(
    (enemy) =>
      enemy.hp / enemy.maxHp <= 0.25 &&
      distance(player, enemy) <= executeRange &&
      Math.abs(enemy.pos.y - player.pos.y) <= 30,
  );

  if (dangerous.length && !executable) {
    const threat = dangerous.reduce((best, enemy) =>
      distance(player, enemy) < distance(player, best) ? enemy : best,
    );
    const awayX = Math.sign(player.pos.x - threat.pos.x) || (variant % 2 ? 1 : -1);
    const { minY, maxY } = run.world.arena;
    let evadeY = Math.sign(player.pos.y - threat.pos.y) || (variant % 2 ? 1 : -1);
    if (player.pos.y <= minY + 24) evadeY = 1;
    if (player.pos.y >= maxY - 24) evadeY = -1;
    const radial = threat.action === 'bossNova' || threat.action === 'bossSlam' || threat.action === 'heavy';
    const retreatX =
      threat.action === 'bossNova' ||
      (run.profile.profession !== 'arcane' && (threat.action === 'bossSlam' || threat.action === 'heavy'));
    const imminent =
      !threat.telegraph || threat.telegraph.frame >= Math.max(0, threat.telegraph.frames - 14);
    return {
      // 术法躲重击时保留横向施法距离，只沿纵深脱离；Nova 覆盖纵深，仍需全力拉开。
      moveX: retreatX ? awayX : 0,
      moveY: evadeY,
      attack: false,
      attackHeld: false,
      // 长预警刚出现时先走位；过早交闪避会在判定生效前结束无敌/腾空。
      dash: radial && imminent && player.dashCooldown <= 0,
      jump: !radial && imminent && player.jumpCooldown <= 0,
      skill: false,
      execute: false,
    };
  }

  // 攻击输入同时带朝向，避免目标切到另一侧后站在原地背身挥空。
  // 盾兵则以其背面为目标点，利用慢转身窗口落实绕后机制。
  const shieldBackX = target.kind === 'shield' ? target.pos.x - target.facing * desired : target.pos.x;
  const attackDx = shieldBackX - player.pos.x;
  let moveX = Math.sign(attackDx);
  if (target.kind !== 'shield' && Math.abs(dx) <= desired) {
    moveX = run.profile.profession === 'arcane' && Math.abs(dx) < 38 ? -Math.sign(dx) : Math.sign(dx);
  }
  const moveY = Math.abs(dy) > 9 ? Math.sign(dy) : 0;
  const aligned = Math.abs(dy) <= (run.profile.profession === 'arcane' ? 34 : 25);
  const inRange =
    aligned &&
    Math.abs(dx) <= (run.profile.profession === 'arcane' ? 100 : 72) &&
    // 术法贴得太近时要先后撤；若后撤和攻击同帧，输入层会朝移动方向转身并打反。
    (run.profile.profession !== 'arcane' || Math.abs(dx) >= 38);

  if (run.profile.profession === 'heavy') {
    const charging = player.action === 'heavyCharge';
    // 自动玩家缺少“安全满蓄力窗口”的判断，三档以短/中蓄力覆盖稳定攻防循环；
    // 满蓄力机制本身由 validate:professions 的确定性断言覆盖。
    const chargeTarget = [1, 4, 8][variant] ?? 4;
    return {
      moveX,
      moveY,
      attack: !charging && inRange,
      attackHeld: charging && player.actionFrame < chargeTarget,
      dash: !inRange && Math.abs(dx) > desired + 70 && player.dashCooldown <= 0,
      jump: false,
      skill: player.energy >= 50 && enemies.filter((enemy) => distance(player, enemy) < 100).length >= 2,
      execute: executable,
    };
  }

  return {
    moveX,
    moveY,
    // 持续刷新 8 帧输入缓冲，动作一进入取消窗口就能自然接段。
    attack: inRange,
    attackHeld: false,
    dash:
      run.profile.profession === 'swift' &&
      !inRange &&
      Math.abs(dx) > desired + 70 &&
      player.dashCooldown <= 0,
    jump: false,
    skill:
      player.energy >= (run.profile.profession === 'arcane' ? 30 : 50) &&
      (run.profile.profession === 'arcane' || enemies.filter((enemy) => distance(player, enemy) < 100).length >= 2),
    execute: executable,
  };
}

/** 预警段和即将生效的高威胁动作都进入规避态，弥补只读上一帧 telegraph 的延迟。 */
function isDangerous(enemy, player) {
  const d = distance(enemy, player);
  if (enemy.action === 'slash') return d < 92 && enemy.actionFrame < 12;
  if (enemy.action === 'slash2' || enemy.action === 'slash3') return d < 100 && enemy.actionFrame < 14;
  if (enemy.action === 'aim') return d < 380;
  if (enemy.action === 'charge' || enemy.action === 'bossCharge') {
    return d < 300 && Math.abs(enemy.pos.y - player.pos.y) < 58;
  }
  if (enemy.action === 'shoot') return d < 330 && enemy.actionFrame < 4;
  if (enemy.action === 'rush') {
    return d < 280 && Math.abs(enemy.pos.y - player.pos.y) < 48 && enemy.actionFrame < 18;
  }
  if (enemy.action === 'bossRush') {
    return d < 300 && Math.abs(enemy.pos.y - player.pos.y) < 52 && enemy.actionFrame < 17;
  }
  if (enemy.action === 'heavy') {
    if ((player.profession === 'arcane' || player.profession === 'heavy') && enemy.actionFrame < 8) {
      return false;
    }
    return d < 110 && enemy.actionFrame < 38;
  }
  if (enemy.action === 'bossSlam') {
    // 44 帧长前摇足够术法安全打一发脉冲；过早逃跑会让远程职业永远没有反击窗口。
    if (player.profession === 'arcane' && enemy.actionFrame < 20) return false;
    if (player.profession === 'heavy' && enemy.actionFrame < 14) return false;
    return d < 135 && enemy.actionFrame < 51;
  }
  if (enemy.action === 'bossNova') return d < 190 && enemy.actionFrame < 34;
  return false;
}

function distance(a, b) {
  return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value) {
  return Number(value.toFixed(2));
}
