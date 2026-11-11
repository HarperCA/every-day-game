// 测试用：打开内存里的主库（时间固定），放进两个比赛、四届的样例。不碰任何真实库文件。
import { openDb } from '../../index.mjs';

export const fixedNow = () => new Date('2026-10-29T12:00:00.000Z');
export const open = () => openDb({ file: ':memory:', now: fixedNow });

export function seed(db) {
  db.transaction(tx => {
    tx.insert('competition', 'event-math', { name: '全国大学生数学建模竞赛', aliases: ['国赛数模'], level: '国家级', professions: ['数学类', '计算机类'] });
    tx.insert('competition', 'event-art', { name: '省大学生艺术展演', level: '省级/区域级', professions: ['艺术类'], organizer: '省教育厅' });
    tx.insert('edition', 'ed-math-2025', { competition_id: 'event-math', ordinal: 1, edition_name: '2025 年数学建模', registration_end: '2025-09-01T00:00:00+08:00' });
    tx.insert('edition', 'ed-math-2026', { competition_id: 'event-math', ordinal: 2, edition_name: '2026 年数学建模', registration_end: '2026-11-01T08:00:00+08:00', status: '已发布' });
    // 同一时刻的两种写法：北京时间 10-31 08:00 = 国际时间 10-31 00:00
    tx.insert('edition', 'ed-art-2026', { competition_id: 'event-art', ordinal: 1, edition_name: '第八届艺术展演', level: '国家级', registration_end: '2026-10-31T00:00:00+00:00' });
    tx.insert('edition', 'ed-art-next', { competition_id: 'event-art', ordinal: 2, edition_name: '第九届艺术展演' });
  });
}
