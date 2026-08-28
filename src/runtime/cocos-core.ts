/** Cocos 适配层唯一允许引用的逻辑入口；构建脚本会把依赖图压成单文件模块。 */
export { resolveAction, TICK_RATE } from '../core/actions';
export { createProfile, Run } from '../core/run';
export { STAGES } from '../core/stages';
export { EMPTY_INPUT } from '../core/world';
export { FixedStepClock } from './fixed-step-clock';
