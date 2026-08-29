/** Cocos 适配层唯一允许引用的逻辑入口；构建脚本会把依赖图压成单文件模块。 */
export { resolveAction, TICK_RATE } from '../core/actions';
export { createProfile, Run } from '../core/run';
export { STAGES } from '../core/stages';
export { EMPTY_INPUT } from '../core/world';
export { FixedStepClock } from './fixed-step-clock';
export {
  COCOS_BATTLE_CENTER_Y,
  COCOS_WORLD_SCALE,
  COCOS_WORLD_VIEW_WIDTH,
  clampCocosCameraX,
  worldToCocosScreen,
} from './cocos-camera';
export { UPGRADE_TRACKS } from '../core/upgrades';
export { ACCESSORIES, ARMORS, WEAPONS } from '../core/equipment';
export {
  COCOS_BOSS_ROWS,
  COCOS_GRUNT_ROWS,
  COCOS_HERO_ROWS,
  resolveCocosSpriteAction,
} from './cocos-sprite-map';
