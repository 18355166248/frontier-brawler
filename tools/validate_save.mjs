#!/usr/bin/env node

import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: [
      "export * from './src/core/save.ts';",
      "export * from './src/core/run.ts';",
      "export * from './src/core/economy.ts';",
      "export * from './src/core/stages.ts';",
    ].join('\n'),
    resolveDir: process.cwd(),
    sourcefile: 'save-validation-entry.ts',
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
if (!source) throw new Error('无法加载存档核心');
const save = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const {
  CAMPAIGN_SAVE_KEY,
  CAMPAIGN_SAVE_VERSION,
  clearCampaignSave,
  createProfile,
  createStageProfile,
  decodeCampaignSave,
  encodeCampaignSave,
  loadCampaignSave,
  nextCampaignStageIndex,
  writeCampaignSave,
} = save;

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

expect(nextCampaignStageIndex(0) === 1, '普通关卡没有推进到下一关');
expect(nextCampaignStageIndex(5) === 0, '最终关没有环回第一关开启新远征');
expect(nextCampaignStageIndex(-1) === 0, '非法关卡索引没有安全降级到第一关');

const profile = createProfile();
profile.profession = 'arcane';
profile.inventory.weapons = ['ember-focus'];
profile.inventory.armors = ['ritual-robe'];
profile.inventory.accessories = ['focus-bead'];
profile.equipment = { weapon: 'ember-focus', armor: 'ritual-robe', accessory: 'focus-bead' };
profile.base.completedStageRuns = 3;
profile.base.completedBuildings = ['archive', 'alchemyLab'];
profile.base.resources = { materials: 23, blueprints: 4, rareMaterials: 2 };
profile.base.archiveTrack = 'arcane';
profile.base.tonics = 2;
profile.base.lastActiveAtMs = 1_000;
profile.base.offlineProductionUnits = 5;
profile.base.constructionQueue = [{ building: 'forge', startsAtMs: 2_000, completesAtMs: 3_000 }];
profile.base.resourceLedger = [{ sequence: 1, resource: 'materials', amount: 23, reason: 'test' }];
profile.base.nextLedgerSequence = 2;
profile.hp = 1;
profile.energy = 72;
profile.upgrades.offense = 3;

const encoded = encodeCampaignSave(4, profile, 9_000);
expect(typeof encoded === 'string', '合法档案无法编码');
const decoded = decodeCampaignSave(encoded, 6);
expect(decoded?.stageIndex === 4 && decoded.savedAtMs === 9_000, '关卡或保存时间没有往返');
expect(decoded?.profile.profession === 'arcane', '职业没有往返');
expect(decoded?.profile.equipment.weapon === 'ember-focus', '配装没有往返');
expect(decoded?.profile.base.resources.materials === 23, '基地资源没有往返');
expect(decoded?.profile.base.completedBuildings.join(',') === 'archive,alchemyLab', '建筑没有往返');
expect(decoded?.profile.base.constructionQueue[0]?.building === 'forge', '建造队列没有往返');
expect(decoded?.profile.base.archiveTrack === 'arcane' && decoded.profile.base.tonics === 2, '基地能力没有往返');
expect(decoded?.profile.hp === decoded?.profile.maxHp, '局内生命不应写回新关卡');
expect(decoded?.profile.energy === 0 && decoded?.profile.upgrades.offense === 0, '局内能量或成长没有重置');

const sortie = createStageProfile(decoded?.profile);
expect(sortie?.energy === sortie?.maxEnergy && sortie?.base.tonics === 1, '读档出击没有恰好消耗一份补给');
expect(sortie?.upgrades.arcane === 1, '读档出击没有应用藏经阁起始路线');

expect(decodeCampaignSave('{broken', 6) === null, '损坏 JSON 没有降级为空档');
expect(decodeCampaignSave(JSON.stringify({ version: CAMPAIGN_SAVE_VERSION + 1 }), 6) === null, '未知版本被错误接纳');
expect(decodeCampaignSave(encoded, 0) === null, '非法关卡总数被错误接纳');
const clamped = decodeCampaignSave(JSON.stringify({
  version: CAMPAIGN_SAVE_VERSION,
  savedAtMs: 1,
  stageIndex: 999,
  profile: {},
}), 6);
expect(clamped?.stageIndex === 5, '越界关卡没有钳制到最终关');

const malformed = decodeCampaignSave(JSON.stringify({
  version: CAMPAIGN_SAVE_VERSION,
  savedAtMs: 1,
  stageIndex: -2,
  profile: {
    profession: 'heavy',
    inventory: {
      weapons: ['iron-maul', 'iron-maul', 'invalid'],
      armors: [],
      accessories: [],
    },
    equipment: { weapon: 'ember-focus' },
    base: {
      completedBuildings: ['forge', 'forge', 'invalid'],
      resources: { materials: -1, blueprints: 2.5, rareMaterials: 3 },
      constructionQueue: [
        { building: 'archive', startsAtMs: 20, completesAtMs: 10 },
        { building: 'resourceField', startsAtMs: 100, completesAtMs: 200 },
        { building: 'alchemyLab', startsAtMs: 50, completesAtMs: 300 },
      ],
      lastActiveAtMs: 'yesterday',
      resourceLedger: [
        { sequence: 1, resource: 'materials', amount: 1, reason: 'ok' },
        { sequence: 2, resource: 'invalid', amount: 1, reason: 'bad' },
      ],
    },
  },
}), 6);
expect(malformed?.stageIndex === 0, '负关卡没有降级到第一关');
expect(malformed?.profile.inventory.weapons.join(',') === 'iron-maul', '库存非法项或重复项未清理');
expect(malformed?.profile.equipment.weapon === null, '不在库存或职业不兼容的武器仍被装备');
expect(malformed?.profile.base.completedBuildings.join(',') === 'forge', '建筑非法项或重复项未清理');
expect(malformed?.profile.base.resources.materials === 0 && malformed.profile.base.resources.rareMaterials === 3, '非法资源余额没有逐项降级');
expect(malformed?.profile.base.constructionQueue.length === 1, '畸形或非串行建造任务没有移除');
expect(malformed?.profile.base.lastActiveAtMs === null, '非法离线时钟没有重新锚定');
expect(malformed?.profile.base.resourceLedger.length === 1, '非法资源流水没有移除');

const memory = new Map();
const storage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
};
expect(writeCampaignSave(storage, 2, profile, 10_000), '写入内存存储失败');
expect(memory.has(CAMPAIGN_SAVE_KEY), '写入使用了错误的存储键');
expect(loadCampaignSave(storage, 6)?.stageIndex === 2, '从存储加载失败');
expect(clearCampaignSave(storage) && !memory.has(CAMPAIGN_SAVE_KEY), '清除存档失败');

const throwingStorage = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
  removeItem() { throw new Error('blocked'); },
};
expect(loadCampaignSave(throwingStorage, 6) === null, '读取异常没有降级为空档');
expect(!writeCampaignSave(throwingStorage, 0, profile, 1), '写入异常没有返回失败');
expect(!clearCampaignSave(throwingStorage), '删除异常没有返回失败');

if (failures.length) {
  for (const message of failures) console.error(`[validate_save] FAIL: ${message}`);
  process.exitCode = 1;
} else {
  console.log('[validate_save] PASS: versioning, roundtrip, sanitization, stage reset, storage fallback');
}
