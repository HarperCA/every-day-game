// 跑后台界面的小服务器：准备好各功能要用的东西（比赛库、用户副本、回传北京……），交给 建服务.mjs 起服务。只听本机。
//   node backend/美国/后台/服务.mjs     然后打开 http://localhost:4318
// 比赛库用 美国/db 的默认位置（DB_DIR/比赛库.db，不设 DB_DIR 时是 backend/美国/db/数据/），第一次打开会建空库。
// 口令（2026-11-03）：设了 ADMIN_TOKEN 或 ADMIN_TOKEN_FILE 就要先登录（美国服务器上指向旧后台的口令文件）；本机预览不设，不用登录。
// 美国服务器上挂在 https://107-175-111-18.sslip.io/new-admin/（nginx 转到本机 4318）。
import fs from 'node:fs';
import { openDb, 用户副本 } from '../db/index.mjs';
import { 回传 as 回传到北京 } from '../../沟通/审核结果回传/美国端.mjs';
import { 列出几晚, 读一晚, 读最近失败 } from '../pipeline/小数据库/index.mjs';
import { logRoot } from '../pipeline/shared/paths.mjs';
import { 建服务 } from './建服务.mjs';

const PORT = Number(process.env.PORT || 4318);
const 读文件 = 文件 => (文件 ? fs.readFileSync(文件, 'utf8').trim() : '');

let db = null;
// 日志、流程监测几页要的读取函数：每晚流程的运行文件夹（PIPELINE_LOG_DIR），AI 总管的用量库（第一次用到时才打开）
const 每晚失败 = 选项 => 读最近失败({ 根: logRoot(), ...选项 });
const AI = () => import('../ai/index.mjs');
const AI问题 = async 从哪天 => (await AI()).usage.problemsSince(从哪天);
const 每晚记录 = { 列出: () => 列出几晚({ 根: logRoot() }), 读一晚: 名 => 读一晚({ 根: logRoot(), 名 }) };
const AI用量 = { report: async (从, 到) => (await AI()).usage.report(从, 到), fixedFees: async 月 => (await AI()).usage.fixedFees(月) };
// 用户反馈几页（访问异常、问卷统计、意见反馈、纠错审核）：北京同步来的用户副本只读打开；处理结果经 回传 写回北京（同步秘钥只在这里读，数据库.mjs 碰不到）
let 副本库 = null;
let 可写副本 = null;
const 同步秘钥 = () => process.env.SYNC_SECRET || 读文件(process.env.SYNC_SECRET_FILE);
const 回传 = 参数 => 回传到北京({ 地址: process.env.SYNC_REVIEW_ENDPOINT || '', 秘钥: 同步秘钥(), 副本库: (可写副本 ||= 用户副本.open()), ...参数 });
const 环境 = () => ({ db: (db ||= openDb()), 用户副本库: (副本库 ||= 用户副本.open({ readOnly: true })), 回传, 每晚失败, AI问题, 每晚记录, AI用量 });

const 口令 = process.env.ADMIN_TOKEN || 读文件(process.env.ADMIN_TOKEN_FILE);
建服务({ 口令, 环境 }).listen(PORT, '127.0.0.1', () => console.log(`后台界面：http://localhost:${PORT}${口令 ? '（要登录）' : '（本机预览，不用登录）'}`));
