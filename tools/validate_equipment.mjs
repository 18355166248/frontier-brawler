#!/usr/bin/env node

/** M4 装备骨架门禁：验证三槽位、职业限制和武器覆盖链。 */
import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: [
      "export * from './src/core/actions.ts';",
      "export * from './src/core/equipment.ts';",
      "export * from './src/core/run.ts';",
      "export * from './src/core/world.ts';",
      "export * from './src/dev/profession-validation.ts';",
      "export * from './src/render/equipment-icons.ts';",
    ].join('\n'),
    resolveDir: process.cwd(),
    sourcefile: 'equipment-validator-entry.ts',
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
if (!source) throw new Error('无法加载装备模块');
const game = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const {
  EMPTY_INPUT,
  Run,
  WEAPONS,
  WEAPON_ACTIONS,
  ARMOR_IDS,
  ACCESSORY_IDS,
  ProfessionValidationStore,
  EQUIPMENT_ICON_PATHS,
  WEAPON_IDS,
  createProfile,
  createStageProfile,
  resolveAction,
} = game;

function fail(message) {
  throw new Error(`[validate_equipment] ${message}`);
}

const expectedAction = {
  'iron-maul': 'heavyCharged',
  'breaker-maul': 'heavyCharged',
  'wind-sabers': 'slash3',
  'hook-blades': 'slash2',
  'spirit-focus': 'arcanePulse',
  'ember-focus': 'arcanePulse',
};

for (const [weapon, action] of Object.entries(expectedAction)) {
  const profession = WEAPONS[weapon].profession;
  const base = resolveAction(action, profession);
  const equipped = resolveAction(action, profession, weapon);
  if (!WEAPON_ACTIONS[weapon][action]) fail(`${weapon} 没有覆盖声明的 ${action}`);
  if (JSON.stringify(base) === JSON.stringify(equipped)) fail(`${weapon} 没有改变招式手感数据`);
}

const expectedIconIds = [...WEAPON_IDS, ...ARMOR_IDS, ...ACCESSORY_IDS].sort();
const actualIconIds = Object.keys(EQUIPMENT_ICON_PATHS).sort();
if (JSON.stringify(actualIconIds) !== JSON.stringify(expectedIconIds)) {
  fail(`正式装备图标未覆盖完整目录：${JSON.stringify(actualIconIds)}`);
}

const stage = {
  id: 'equipment-smoke',
  index: 1,
  name: '装备烟测',
  theme: {
    skyTop: '#000',
    skyBottom: '#000',
    groundFar: '#000',
    groundNear: '#000',
    lane: '#000',
  },
  maxAttackers: 1,
  startRoom: 'r',
  rooms: [
    {
      id: 'r',
      gridX: 0,
      gridY: 0,
      kind: 'normal',
      size: 'standard',
      encounter: ['grunt'],
      doors: {},
    },
  ],
};

const run = new Run(stage, createProfile());
run.setProfession('heavy');
run.grantEquipment('wind-sabers');
run.grantEquipment('iron-maul');
if (run.equip('wind-sabers')) fail('重击不应能装备疾锋武器');
if (!run.equip('iron-maul')) fail('重击无法装备自己的武器');
if (run.profile.equipment.weapon !== 'iron-maul' || run.player?.weapon !== 'iron-maul') {
  fail('武器没有同步到档案和当前实体');
}
run.setProfession('arcane');
if (run.profile.equipment.weapon !== null || run.player?.weapon !== null) {
  fail('切职业后没有卸下不兼容武器');
}
run.grantEquipment('spirit-focus');
run.grantEquipment('field-armor');
run.grantEquipment('execution-charm');
if (!run.equip('spirit-focus') || !run.equip('field-armor') || !run.equip('execution-charm')) {
  fail('合法三槽位装备失败');
}
if (run.player?.damageTakenMultiplier !== 0.88) fail('行阵甲减伤没有同步到玩家');
if (run.player?.executeHealBonus !== 8) fail('收魂佩处决回复没有同步到玩家');
if (run.player?.speed !== run.profile.speed * 0.94) fail('行阵甲移速代价没有同步到玩家');
if (!run.equip(null, 'weapon') || run.profile.equipment.weapon !== null) fail('卸下武器失败');
if (run.player) run.player.action = 'arcanePulse';
if (run.toggleEquipmentMenu()) fail('攻击动作途中不应允许打开装备面板');
if (run.player) run.player.action = 'idle';
if (!run.toggleEquipmentMenu() || run.phase !== 'equipmentMenu') fail('无法打开装备暂停面板');
const framesBeforeMenuStep = run.stats.frames;
run.step(EMPTY_INPUT);
if (run.stats.frames !== framesBeforeMenuStep) fail('装备面板打开时战斗没有暂停');
if (!run.cycleEquipment('weapon') || run.profile.equipment.weapon !== 'spirit-focus') {
  fail('装备面板无法循环装备职业匹配武器');
}
if (!run.cycleEquipment('weapon') || run.profile.equipment.weapon !== null) {
  fail('装备面板无法循环回空武器槽');
}
if (!run.toggleEquipmentMenu() || run.phase !== 'fighting') fail('无法关闭装备面板');

const armoredPlayer = run.player;
const attacker = run.world.entities.find((entity) => entity.team === 'enemy');
if (!armoredPlayer || !attacker) fail('减伤烟测缺少玩家或敌人');
attacker.pos = { x: armoredPlayer.pos.x + 30, y: armoredPlayer.pos.y };
attacker.facing = -1;
attacker.action = 'slash';
attacker.actionFrame = 8;
const armorEvents = run.step(EMPTY_INPUT);
const armorHit = armorEvents.damage.find((event) => event.target === armoredPlayer.id);
const expectedArmoredDamage = Math.round(resolveAction('slash').hitboxes[0].damage * 0.88);
if (armorHit?.damage !== expectedArmoredDamage) {
  fail(`行阵甲实际承伤应为 ${expectedArmoredDamage}，得到 ${armorHit?.damage ?? '未命中'}`);
}

const dropStage = {
  ...stage,
  id: 'equipment-drop-smoke',
  rooms: [{ ...stage.rooms[0], kind: 'boss', encounter: ['boss'] }],
};
const dropRun = new Run(dropStage, createProfile());
dropRun.setProfession('heavy');
for (const entity of dropRun.world.entities) {
  if (entity.team === 'enemy') {
    entity.hp = 0;
    entity.dead = true;
  }
}
dropRun.step(EMPTY_INPUT);
if (dropRun.phase !== 'equipmentChoice') fail('首领房清空后没有进入装备选择暂停态');
if (
  dropRun.pendingEquipment?.length !== 3 ||
  !dropRun.pendingEquipment.some((id) => WEAPONS[id]?.profession === 'heavy') ||
  !dropRun.pendingEquipment.some((id) => ARMOR_IDS.includes(id)) ||
  !dropRun.pendingEquipment.some((id) => ACCESSORY_IDS.includes(id))
) {
  fail(`首领房没有稳定提供武器/护甲/饰品各一件：${JSON.stringify(dropRun.pendingEquipment)}`);
}
const droppedWeapon = dropRun.pendingEquipment.find((id) => WEAPONS[id]);
if (!droppedWeapon || !dropRun.chooseEquipment(droppedWeapon)) fail('无法领取待选武器');
if (!dropRun.profile.inventory.weapons.includes(droppedWeapon)) fail('领取后没有写入库存');
if (dropRun.pendingEquipment !== null) fail('领取后没有关闭装备选择');
const nextStageProfile = createStageProfile(dropRun.profile);
if (!nextStageProfile.inventory.weapons.includes(droppedWeapon)) fail('首领/精英掉落没有跨关保留');
if (nextStageProfile.hp !== nextStageProfile.maxHp || nextStageProfile.energy !== 0) {
  fail('跨关时战斗资源没有重置');
}

const validationStore = new ProfessionValidationStore(null);
if (!dropRun.equip(droppedWeapon)) fail('领取后的武器无法装备用于分布统计');
const sampleA = dropRun.overallSummary();
validationStore.record(dropRun.stage.id, true, sampleA);
validationStore.record(dropRun.stage.id, false, sampleA);
const variedRun = new Run(stage, createProfile());
variedRun.setProfession('swift');
const sampleB = variedRun.overallSummary();
validationStore.record(variedRun.stage.id, true, sampleB);
const equipmentReport = validationStore.equipmentReport();
if (equipmentReport.totalSamples !== 3 || equipmentReport.topLoadoutShare !== 0.67) {
  fail(`配装分布聚合错误：${JSON.stringify(equipmentReport)}`);
}

console.table(
  Object.entries(WEAPONS).map(([id, def]) => ({
    id,
    profession: def.profession,
    action: expectedAction[id],
  })),
);
console.log('[validate_equipment] 多套配装效果、安全换装、轮换掉落、分布统计与武器覆盖链通过');
