// 由 systemd 的 NODE_OPTIONS=--import=/opt/daily-contest/api-usage-hook.mjs 在每个后台 node 进程启动时加载，
// 给全局 fetch 加上接口用量记账（见 api-usage.mjs）。子进程继承 NODE_OPTIONS，流水线里起的脚本也会记。
import { install } from './api-usage.mjs';

install();
