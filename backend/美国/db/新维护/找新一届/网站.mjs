// 找新一届 · 网站种类（2026-11-13 从 index.mjs 挪出来，新维护官网打不开时找高校转发（高校转发.mjs）也用）：
//   主机之(网址) → 去掉 www 的小写主机名；根域(主机)；学校站(主机)：.edu.cn；是二级edu(主机)；垃圾站(主机)：备案、统计、分享这类
//   官方主机们(db, 比赛, 届们, 屏蔽) → Set<主机>：比赛 website、搜索记忆里核实过的官方域名、来源表官方有效来源的网站；学校部门网站、屏蔽网站不算
import { 搜索记忆, 屏蔽网站 } from '../../index.mjs';
import { 学校部门前缀 } from '../判断官网.mjs';

export const 主机之 = 网址 => { try { return new URL(网址).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
export const 根域 = h => h.split('.').slice(/\.(edu|gov|com|org|net|ac)\.cn$/.test(h) ? -3 : -2).join('.');
export const 学校站 = h => /\.edu\.cn$/.test(h);
export const 垃圾站 = h => /(beian|miit\.gov|gongan|12377|baidu\.com|weibo\.com|google|w3\.org|jiathis|bshare|cnzz|51\.la|qq\.com$|wps\.cn|adobe|microsoft|apple\.com|cac\.gov|12321|jubao)/.test(h);
export const 是二级edu = h => /^[^.]+\.edu\.cn$/.test(h);

export function 官方主机们(db, 比赛, 届们, 屏蔽) {
  const 集 = new Set();
  const 加 = h => {
    if (!h || 屏蔽网站.isBlockedHost(h, 屏蔽)) return;
    if (学校站(h) && !是二级edu(h) && 学校部门前缀.includes(h.split('.')[0])) return;
    集.add(h);
  };
  加(主机之(比赛.website));
  let 节 = null;
  try { 节 = 搜索记忆.读(db, 比赛.id)?.节; } catch { /* 记忆格式坏了就不用 */ }
  for (const 条 of 节?.官方域名 || []) {
    if (/还没核实/.test(条)) continue;
    const m = /([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i.exec(条);
    if (m) 加(m[1].toLowerCase().replace(/^www\./, ''));
  }
  for (const 届 of 届们) {
    for (const 源 of db.find('source', { edition_id: 届.id })) if (源.is_official === true && 源.validity_status === 'valid') 加(主机之(源.url));
  }
  return 集;
}
