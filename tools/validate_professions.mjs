#!/usr/bin/env node

/**
 * M2 职业差异机械门禁。
 *
 * 这里验证的是“数据结构上确实要求三种不同打法”，不能替代真人六关验收。
 * 脚本直接打包并加载 actions.ts，避免另抄一份数值后与游戏真实配置漂移。
 */
import { build } from 'esbuild';

async function load(contents, sourcefile) {
  const bundled = await build({
    stdin: { contents, resolveDir: process.cwd(), sourcefile, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
    logLevel: 'silent',
  });
  const text = bundled.outputFiles[0]?.text;
  if (!text) throw new Error(`无法加载 ${sourcefile}`);
  return import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
}

const actions = await load("export * from './src/core/actions.ts';", 'profession-entry.ts');

const {
  HEAVY_FULL_CHARGE_FRAMES,
  resolveAction,
  resolveDashCooldown,
  resolveExecuteHeal,
  resolveExecuteRange,
  resolveProfessionDamageTakenMultiplier,
  resolveSkillCost,
} = actions;

function fail(message) {
  throw new Error(`[validate_professions] ${message}`);
}

function hit(action) {
  const box = action.hitboxes[0];
  if (!box) fail(`${action.id} 没有攻击判定`);
  return box;
}

/** 玩家最快能接下一次攻击的帧；与 canInterrupt 的隐式规则保持一致。 */
function cycleFrames(action) {
  if (action.cancelFrom !== undefined) return action.cancelFrom;
  if (action.hitboxes.length) return Math.max(...action.hitboxes.map((box) => box.activeTo));
  return action.frames - 1;
}

function damagePerSecond(damage, frames) {
  return Number(((damage * 60) / frames).toFixed(1));
}

const swiftChain = ['slash', 'slash2', 'slash3'].map((id) => resolveAction(id, 'swift'));
const heavyCharge = resolveAction('heavyCharge', 'heavy');
const heavyRelease = resolveAction('heavyCharged', 'heavy');
const heavyExecute = resolveAction('execute', 'heavy');
const arcanePulse = resolveAction('arcanePulse', 'arcane');
const arcaneSkill = resolveAction('skill', 'arcane');

const swiftDamage = swiftChain.reduce((sum, action) => sum + hit(action).damage, 0);
const swiftFrames = swiftChain.reduce((sum, action) => sum + cycleFrames(action), 0);
const heavyHit = hit(heavyRelease);
const heavyFrames = HEAVY_FULL_CHARGE_FRAMES + cycleFrames(heavyRelease);
const arcaneHit = hit(arcanePulse);
const arcaneFrames = cycleFrames(arcanePulse);

const rows = [
  {
    profession: '重击',
    pattern: '满蓄力单段',
    strikes: 1,
    damage: heavyHit.damage,
    cycleFrames: heavyFrames,
    dps: damagePerSecond(heavyHit.damage, heavyFrames),
    reach: Math.abs(heavyHit.offset.x) + heavyHit.halfWidth,
    dashCooldown: resolveDashCooldown('heavy'),
    skillCost: resolveSkillCost('heavy'),
    executeRange: resolveExecuteRange('heavy'),
  },
  {
    profession: '疾锋',
    pattern: '三段取消链',
    strikes: swiftChain.length,
    damage: swiftDamage,
    cycleFrames: swiftFrames,
    dps: damagePerSecond(swiftDamage, swiftFrames),
    reach: Math.max(...swiftChain.map((action) => {
      const box = hit(action);
      return Math.abs(box.offset.x) + box.halfWidth;
    })),
    dashCooldown: resolveDashCooldown('swift'),
    skillCost: resolveSkillCost('swift'),
    executeRange: resolveExecuteRange('swift'),
  },
  {
    profession: '术法',
    pattern: '中距离范围',
    strikes: 1,
    damage: arcaneHit.damage,
    cycleFrames: arcaneFrames,
    dps: damagePerSecond(arcaneHit.damage, arcaneFrames),
    reach: Math.abs(arcaneHit.offset.x) + arcaneHit.halfWidth,
    dashCooldown: resolveDashCooldown('arcane'),
    skillCost: resolveSkillCost('arcane'),
    executeRange: resolveExecuteRange('arcane'),
  },
];

// 重击：用最长防御位移代价换超级护甲和最高单次伤害。
if (!heavyCharge.superArmor || !heavyRelease.superArmor) fail('重击蓄力/释放必须全程超级护甲');
if (heavyHit.damage < arcaneHit.damage * 2) fail('重击满蓄力单次伤害不够突出');
if (resolveDashCooldown('heavy') <= resolveDashCooldown('arcane')) fail('重击冲刺冷却必须最长');
if (resolveProfessionDamageTakenMultiplier('heavy') >= resolveProfessionDamageTakenMultiplier('swift')) {
  fail('重击必须用基础减伤落实抗压定位');
}
if (resolveExecuteHeal('heavy') <= resolveExecuteHeal('swift')) fail('重击处决回复必须最高');
if (heavyExecute.frames <= resolveAction('execute', 'swift').frames) fail('重击处决动画必须更长');

// 疾锋：三段高频连击，冲刺最频繁但单次无敌窗最短。
if (swiftChain.length !== 3 || swiftChain.some((action) => !hit(action))) fail('疾锋三段链不完整');
if (resolveDashCooldown('swift') >= resolveDashCooldown('arcane')) fail('疾锋冲刺冷却必须最短');
const swiftInvuln = resolveAction('dash', 'swift').invuln;
const sharedInvuln = resolveAction('dash', 'arcane').invuln;
if (!swiftInvuln || !sharedInvuln || swiftInvuln.to - swiftInvuln.from >= sharedInvuln.to - sharedInvuln.from) {
  fail('疾锋单次冲刺无敌窗必须短于通用职业');
}

// 术法：基础攻击和技能都在前方形成圆形范围，且资源/处决鼓励保持中距离。
if (!arcaneHit.radial || arcaneHit.offset.x < 50) fail('术法普攻必须是前方中距离范围判定');
const arcaneSkillHit = hit(arcaneSkill);
if (!arcaneSkillHit.radial || arcaneSkillHit.offset.x <= 0) fail('术法技能必须在前方形成范围爆发');
if (resolveSkillCost('arcane') >= resolveSkillCost('swift')) fail('术法技能消耗必须最低');
if (resolveExecuteRange('arcane') <= resolveExecuteRange('swift')) fail('术法处决距离必须最远');

// 纯数据只能先挡住数量级失衡；真实成功率仍以同关三局真人样本为准。
const dpsValues = rows.map((row) => row.dps);
if (Math.max(...dpsValues) / Math.min(...dpsValues) >= 2) {
  fail(`理论输出曲线相差超过 2 倍：${dpsValues.join(' / ')}`);
}

console.table(rows);
console.log('[validate_professions] 三职业战斗签名与理论输出曲线通过');

/**
 * M2/M4 验收面板的呈现门禁。
 *
 * 面板画在 canvas 上，截图断不了言，所以把"报告 → 可画的行"抽成了纯函数
 * `buildValidationPanelModel`，这里直接断言它。重点是三种数据形态：
 * 无样本、单一配装、多配装——尤其是无样本，聚合器为了除零兜底会把成功率
 * 和各项均值都算成 0，面板若照搬就会把"还没有样本"显示成"成功率 0%"，
 * 这两个结论在验收会上是相反的。
 */
const panelModule = await load(
  [
    "export * from './src/dev/validation-panel.ts';",
    "export * from './src/dev/profession-validation.ts';",
  ].join('\n'),
  'validation-panel-entry.ts',
);
const { buildValidationPanelModel, TOP_LOADOUT_SHARE_TARGET, ProfessionValidationStore } =
  panelModule;

function panelFail(message) {
  throw new Error(`[validate_professions] 验收面板：${message}`);
}

function summaryOf(profession, equipment, overrides = {}) {
  return {
    profession,
    equipment,
    seconds: 180,
    totalMoveDistance: 4200,
    averageEngagementDistance: 70,
    actions: { slash: 20, dash: 6, execute: 3 },
    ...overrides,
  };
}

// --- 场景 1：完全没有样本 ---
const emptyStore = new ProfessionValidationStore(null);
const emptyModel = buildValidationPanelModel(
  emptyStore.report(),
  emptyStore.equipmentReport(),
  (id) => id,
  emptyStore.coverage(['s1', 's2']),
);
if (emptyModel.totalSamples !== 0) panelFail('无样本时总数应为 0');
if (emptyModel.professions.length !== 3) panelFail('三张职业卡必须恒定存在');
if (!emptyModel.professions.every((card) => card.empty && card.samples === 0)) {
  panelFail('无样本时三张职业卡都应标记为空');
}
if (!emptyModel.professions.every((card) => card.stats.every((row) => row.value === '—'))) {
  panelFail('无样本时不能把兜底出来的 0 当成真实成功率/均值显示');
}
if (!emptyModel.professions.every((card) => card.actions.length === 0)) {
  panelFail('无样本时不应有动作分布行');
}
if (!emptyModel.equipment.empty || emptyModel.equipment.rows.length !== 0) {
  panelFail('无样本时配装区应为空');
}
if (emptyModel.equipment.verdictText !== '暂无样本 · 无法判定') {
  panelFail(`无样本时必须说"无法判定"而不是"未达标"，得到 ${emptyModel.equipment.verdictText}`);
}
if (!emptyModel.professions.every((card) => card.coverageText.includes('0/2'))) {
  panelFail('无样本时关卡覆盖必须明确显示 0/2');
}

// --- 场景 2：只有一套配装（头部必然 100%，应判未达标）---
const singleStore = new ProfessionValidationStore(null);
const soloLoadout = { weapon: 'iron-maul', armor: 'field-armor', accessory: 'war-sigil' };
singleStore.record('s', true, summaryOf('heavy', soloLoadout));
singleStore.record('s', false, summaryOf('heavy', soloLoadout));
const singleModel = buildValidationPanelModel(
  singleStore.report(),
  singleStore.equipmentReport(),
  (id) => id,
  singleStore.coverage(['s', 'missing']),
);
if (singleModel.totalSamples !== 2) panelFail('单一配装样本总数应为 2');
if (singleModel.equipment.rows.length !== 1) panelFail('单一配装应只有一行');
if (singleModel.equipment.rows[0].shareText !== '100%' || !singleModel.equipment.rows[0].isTop) {
  panelFail(`单一配装占比应为 100% 且标记为头部：${JSON.stringify(singleModel.equipment.rows[0])}`);
}
if (singleModel.equipment.passesDiversityTarget) panelFail('单一配装不可能通过多样性门槛');
if (!singleModel.equipment.verdictText.includes('未达标')) {
  panelFail(`单一配装应显式判为未达标，得到 ${singleModel.equipment.verdictText}`);
}
const heavyCard = singleModel.professions.find((card) => card.profession === 'heavy');
const swiftCard = singleModel.professions.find((card) => card.profession === 'swift');
if (!heavyCard || heavyCard.empty || heavyCard.samples !== 2) panelFail('重击卡应聚合到 2 份样本');
if (heavyCard.stats[0].value !== '50%') {
  panelFail(`两局一胜一负成功率应为 50%，得到 ${heavyCard.stats[0].value}`);
}
if (!heavyCard.actions.length || heavyCard.actions[0].label !== 'slash') {
  panelFail('动作分布应按次数降序，slash 最多');
}
if (!swiftCard || !swiftCard.empty) panelFail('没有样本的职业卡仍应标记为空，不能借用别人的数据');
if (heavyCard.coverageComplete || !heavyCard.coverageText.includes('0/2')) {
  panelFail(`同一关只有 2 局不能冒充六关覆盖：${heavyCard.coverageText}`);
}

singleStore.record('s', true, summaryOf('heavy', soloLoadout));
singleStore.record('missing', true, summaryOf('heavy', soloLoadout));
singleStore.record('missing', false, summaryOf('heavy', soloLoadout));
singleStore.record('missing', true, summaryOf('heavy', soloLoadout));
const completedCoverage = singleStore.coverage(['s', 'missing']).find(
  (row) => row.profession === 'heavy',
);
if (!completedCoverage?.complete || completedCoverage.readyStages !== 2) {
  panelFail(`两关分别达到 3 局后应完成覆盖：${JSON.stringify(completedCoverage)}`);
}

// --- 场景 3：多套配装，且要能跨过 40% 门槛 ---
const manyStore = new ProfessionValidationStore(null);
const loadouts = [
  { weapon: 'iron-maul', armor: 'field-armor', accessory: 'war-sigil' },
  { weapon: 'breaker-maul', armor: 'scout-coat', accessory: 'focus-bead' },
  { weapon: 'wind-sabers', armor: 'ritual-robe', accessory: 'execution-charm' },
  { weapon: 'hook-blades', armor: 'scout-coat', accessory: 'war-sigil' },
];
for (const loadout of loadouts) {
  manyStore.record('s', true, summaryOf('swift', loadout));
}
const manyModel = buildValidationPanelModel(
  manyStore.report(),
  manyStore.equipmentReport(),
  (id) => id,
);
if (manyModel.equipment.rows.length !== 4) panelFail('四套配装应各占一行');
if (Math.abs(manyModel.equipment.topLoadoutShare - 0.25) > 1e-6) {
  panelFail(`四套均分时头部占比应为 0.25，得到 ${manyModel.equipment.topLoadoutShare}`);
}
if (!manyModel.equipment.passesDiversityTarget) panelFail('25% 应低于 40% 门槛');
if (!manyModel.equipment.verdictText.includes('达标')) {
  panelFail(`应显式判为达标，得到 ${manyModel.equipment.verdictText}`);
}
if (manyModel.equipment.rows.some((row) => row.loadout.includes('none'))) {
  panelFail('配装名应已翻译，不应残留原始 none');
}

// 折叠：超过展示上限时必须给出剩余套数，否则会被误读成"只有这几套"
const overflowStore = new ProfessionValidationStore(null);
for (let i = 0; i < 9; i += 1) {
  overflowStore.record('s', true, summaryOf('arcane', {
    weapon: 'spirit-focus',
    armor: 'ritual-robe',
    accessory: i % 2 === 0 ? 'focus-bead' : 'war-sigil',
    // 用饰品之外再拼一个变量制造 9 套不同 key
    ...(i > 1 ? { armor: `robe-${i}` } : {}),
  }));
}
const overflowModel = buildValidationPanelModel(
  overflowStore.report(),
  overflowStore.equipmentReport(),
  (id) => id,
);
if (overflowModel.equipment.rows.length !== 6) {
  panelFail(`配装行数应截断到 6 行，得到 ${overflowModel.equipment.rows.length}`);
}
// 9 套里展示 6 套，剩下 3 套必须报出来，否则会被误读成"总共只有这 6 套"
if (overflowModel.equipment.overflow !== 3) {
  panelFail(`折叠套数应为 3，得到 ${overflowModel.equipment.overflow}`);
}

if (TOP_LOADOUT_SHARE_TARGET !== 0.4) {
  panelFail(`门槛常量应与 ROADMAP 的 <40% 一致，得到 ${TOP_LOADOUT_SHARE_TARGET}`);
}

console.log(
  '[validate_professions] 验收面板呈现通过：无样本 / 单一配装 / 多配装 / 折叠四种形态',
);
