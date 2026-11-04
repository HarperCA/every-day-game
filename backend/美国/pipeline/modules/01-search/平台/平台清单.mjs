// 登记了哪些针对性平台：名字 → 平台脚本。加平台就在这里加一行，再建一个同名文件夹。
import { 搜天池 } from './天池/index.mjs';
import { 搜辽宁 } from './辽宁/index.mjs';

export const PLATFORMS = { 天池: 搜天池, 辽宁: 搜辽宁 };
