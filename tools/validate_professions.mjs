#!/usr/bin/env node

/**
 * M2 职业差异机械门禁。
 *
 * 这里验证的是“数据结构上确实要求三种不同打法”，不能替代真人六关验收。
 * 脚本直接打包并加载 actions.ts，避免另抄一份数值后与游戏真实配置漂移。
 */
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/core/actions.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
  logLevel: 'silent',
});

const source = bundled.outputFiles[0]?.text;
if (!source) throw new Error('无法加载 src/core/actions.ts');
const actions = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const {
  HEAVY_FULL_CHARGE_FRAMES,
  resolveAction,
  resolveDashCooldown,
  resolveExecuteRange,
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
