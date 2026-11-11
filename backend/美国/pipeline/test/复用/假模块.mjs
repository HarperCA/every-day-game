// 测试用：假模块、假条目、空结果；临时日志目录用全后端复用的那个。
export { tempRoot } from '../../../../共用/test/复用/临时目录.mjs';

// 假模块：name 和 run 必填，其余同 总控/零件/modules.mjs 的清单
export const fake = (name, run, extra = {}) => ({ name, title: name, critical: false, timeoutMs: 5000, run, ...extra });

export const item = (key, status = '进行中', data = {}, extra = {}) => ({ key, kind: 'candidate', status, data, ...extra });

export const empty = () => ({ items: [], changes: [], problems: [] });
