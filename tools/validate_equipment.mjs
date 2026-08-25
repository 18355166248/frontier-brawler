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

const { EMPTY_INPUT, Run, WEAPONS, WEAPON_ACTIONS, createProfile, resolveAction } = game;

function fail(message) {
  throw new Error(`[validate_equipment] ${message}`);
}

const expectedAction = {
  'iron-maul': 'heavyCharged',
  'wind-sabers': 'slash3',
  'spirit-focus': 'arcanePulse',
};

for (const [weapon, action] of Object.entries(expectedAction)) {
  const profession = WEAPONS[weapon].profession;
  const base = resolveAction(action, profession);
  const equipped = resolveAction(action, profession, weapon);
  if (!WEAPON_ACTIONS[weapon][action]) fail(`${weapon} 没有覆盖声明的 ${action}`);
  if (JSON.stringify(base) === JSON.stringify(equipped)) fail(`${weapon} 没有改变招式手感数据`);
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
if (!run.equip(null, 'weapon') || run.profile.equipment.weapon !== null) fail('卸下武器失败');

const dropStage = {
  ...stage,
  id: 'equipment-drop-smoke',
  rooms: [{ ...stage.rooms[0], kind: 'elite', encounter: ['elite'] }],
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
const expectedDrop = ['iron-maul', 'field-armor', 'execution-charm'];
if (dropRun.phase !== 'equipmentChoice') fail('精英房清空后没有进入装备选择暂停态');
if (JSON.stringify(dropRun.pendingEquipment) !== JSON.stringify(expectedDrop)) {
  fail(`精英房掉落不正确：${JSON.stringify(dropRun.pendingEquipment)}`);
}
if (!dropRun.chooseEquipment('iron-maul')) fail('无法领取待选装备');
if (!dropRun.profile.inventory.weapons.includes('iron-maul')) fail('领取后没有写入库存');
if (dropRun.pendingEquipment !== null) fail('领取后没有关闭装备选择');

console.table(
  Object.entries(WEAPONS).map(([id, def]) => ({
    id,
    profession: def.profession,
    action: expectedAction[id],
  })),
);
console.log('[validate_equipment] 三槽位、职业限制、武器覆盖链与精英掉落通过');
