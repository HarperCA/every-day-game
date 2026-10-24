const server = require('./server');

const DETAIL_PAGE = 'pages/detail/detail';

function line(label, value) {
  const text = Array.isArray(value) ? value.join('、') : String(value || '').trim();
  return text ? `${label}：${text}` : '';
}

// 比赛详情：只转述赛事库里写了的内容，没写的不让模型补
// 编号规则与服务器 publicQuery.js 的 normalizePublicRecordId 一致：不合格的直接拒绝，不发到服务器
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

async function getCompetitionDetail({ id } = {}) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id.trim())) {
    return { isError: true, content: [{ type: 'text', text: '比赛编号不对，请先用 askAssistant 查到比赛，再用列表里的 id 查看详情。' }] };
  }
  id = id.trim();
  let item;
  try {
    item = await server.getCompetition(id);
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: '没找到这场比赛，可能已下线。请重新查询。' }] };
  }
  const facts = [
    line('比赛', item.edition_name || item.name),
    line('主办方', item.organizer),
    line('级别', item.event_level),
    line('报名状态', item.registration_status),
    line('报名开始', item.registration_start),
    line('报名截止', item.registration_end || item.registration_end_note),
    line('参赛对象', item.participants),
    line('参赛资格', item.eligibility),
    line('比赛形式', item.format_and_rules),
    line('组队', item.team_size),
    line('报名方式', item.registration_method),
    line('费用', item.fees),
  ].filter(Boolean);
  return {
    isError: false,
    content: [{ type: 'text', text: `以下是竞赛雷达赛事库里的信息，只按这些内容回答，没写到的告诉用户“以官方通知为准”：\n${facts.join('\n')}` }],
    structuredContent: {
      id: item.id,
      name: item.name,
      registrationStatus: item.registration_status || '',
      registrationEnd: item.registration_end || '',
      pagePath: `${DETAIL_PAGE}?id=${encodeURIComponent(item.id)}`,
    },
    // 接力页面（2026-10-24）：用户点“账号卡片”进入这场比赛的详情页，页面按 id 读详情（pages/detail/detail 的 onLoad）
    handoff: () => ({ query: `id=${encodeURIComponent(item.id)}` }),
  };
}

module.exports = getCompetitionDetail;
