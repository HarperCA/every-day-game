// 接口用量：DeepSeek、Codex 等接口每晚、每个模块用了多少，花了多少钱。 取数据 → 数据库.mjs；整理 → 整理.mjs；画界面 → 呈现.mjs。
import { 定义功能 } from '../../../框架/功能.mjs';
import { 整理 } from './整理.mjs';
import { 呈现 } from './呈现.mjs';

export default 定义功能({
  id: '接口用量',
  目录: '流程监测/接口用量',
  标题: '接口用量',
  说明: 'DeepSeek、Codex 等接口每晚、每个模块用了多少，花了多少钱。',
  整理,
  呈现,
});
