// 赛事助手（体验版）：调接口、把返回的卡片整理成页面要的样子、把助手用的条件转成“找比赛”页的筛选。
// 接口约定见 docs/赛事助手-体验版-第一步后端执行文档.md 第 4 节。
import { callAssistant } from './cloudSession';
import { loadCompetitionPreferences } from './competitionPreferences';
import { getRemindersForEdition } from './reminders';

export type AssistantStatus = 'answered' | 'empty' | 'clarify' | 'chat' | 'blocked';
export interface AssistantCard {
  id: string; name: string; editionName: string; eventLevel: string;
  registrationStatus: string; registrationEnd: string | null; registrationEndNote: string; daysLeft: number | null;
}
export interface AssistantFilters {
  keyword?: string; professions?: string[]; eventLevel?: string; participationFormats?: string[];
  registrationStatus?: string; registrationWithin?: string; region?: string; feeType?: string; sortBy?: string;
}
export interface AssistantAnswer {
  turnId: string; sessionId: string; status: AssistantStatus; reply: string; aiGenerated: boolean;
  options: string[]; cards: AssistantCard[]; total: number; filters: AssistantFilters | null;
}

export const MAX_QUESTION_CHARS = 300;
export const SOON_DAYS = 7;

export function askAssistant(message: string, sessionId: string): Promise<AssistantAnswer> {
  const profileCategories = loadCompetitionPreferences().categories;
  return callAssistant<AssistantAnswer>({ message, ...(sessionId ? { sessionId } : {}), profileCategories });
}

// 接口错误码 → 给用户看的话（不出现错误码）
const ERROR_TEXT: Record<string, string> = {
  assistant_input_invalid: `问题不能为空，也不能超过 ${MAX_QUESTION_CHARS} 字。`,
  assistant_timeout: '这次想得太久了，请再发一次。',
  assistant_ai_failed: '助手暂时没能回答，请再发一次。',
  assistant_check_failed: '暂时没法回答，请稍后再试。',
};
export function assistantErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  return ERROR_TEXT[message] || (/网络/.test(message) ? message : '网络不太稳定，这条没有发出去。');
}

function monthDay(date: string | null): string {
  const match = String(date || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return match ? `${Number(match[1])}月${Number(match[2])}日` : '';
}

// 卡片一行：名称；“截止 10月28日 · 还剩 12 天”，7 天内变红
export function cardView(card: AssistantCard) {
  const end = monthDay(card.registrationEnd);
  const closed = card.registrationStatus === '已截止';
  const left = closed ? '已截止' : card.daysLeft === null ? '' : card.daysLeft === 0 ? '今天截止' : `还剩 ${card.daysLeft} 天`;
  const deadline = end ? `截止 ${end}` : card.registrationEndNote || (card.registrationStatus || '时间待公布');
  return { ...card, deadline, left, soon: !closed && card.daysLeft !== null && card.daysLeft <= SOON_DAYS };
}

export const QUICK_QUESTIONS = ['最近要截止的比赛', '能组队的国家级比赛', '适合我专业的比赛', '有没有围棋比赛'];

export interface ChatMessage {
  id: string; role: 'user' | 'bot'; text: string; aiGenerated?: boolean; error?: boolean; retryText?: string;
  cards?: any[]; options?: string[]; optionsUsed?: boolean; moreText?: string; filters?: AssistantFilters | null;
}

let messageSeq = 0;
export const nextMessageId = () => `m${++messageSeq}`;

// 开场白不是 AI 写的：固定文案，带上用户选过的专业大类（偏好里没有年级）
export function welcomeText() {
  const categories = loadCompetitionPreferences().categories;
  const base = '你好，告诉我你的专业、年级和想找的比赛，我从赛事库里帮你查。';
  return categories.length ? `${base}已看到你选的专业大类：${categories.join('、')}。` : base;
}

export function withReminderState(cards: any[]) {
  return cards.map(card => ({ ...card, hasReminder: getRemindersForEdition(card.id).length > 0 }));
}

// 接口结果 → 一条助手消息
export function botMessage(answer: AssistantAnswer): ChatMessage {
  const cards = withReminderState(answer.cards.map(cardView));
  const rest = answer.total - cards.length;
  return {
    id: nextMessageId(), role: 'bot', text: answer.reply, aiGenerated: answer.aiGenerated,
    cards, options: answer.options, optionsUsed: false,
    moreText: rest > 0 ? `还有 ${rest} 场，去找比赛页看全部` : '',
    filters: answer.filters,
  };
}

// 助手用的条件 → “找比赛”页的筛选。找比赛页的参赛形式只能选一个：助手选了多个时不带这一项（宁可多给，不漏给）。
// 找比赛页的地区和关键词规则与助手不完全相同（地区会连带全国比赛，关键词会合并专业匹配），两边查到的数量不一定相同。
export function filtersForIndexPage(filters: AssistantFilters | null) {
  const value = filters || {};
  return {
    keyword: value.keyword || '',
    competitionCategories: value.professions || [],
    eventLevel: value.eventLevel || '',
    registrationStatus: value.registrationStatus || '',
    participationFormat: value.participationFormats?.length === 1 ? value.participationFormats[0] : '',
    registrationWithin: value.registrationWithin || '',
    region: value.region || '',
    feeType: value.feeType || '',
    // 找比赛页只有“按报名时间”一种排序，没有按截止日排；助手的 deadline 不带过去
    sortBy: value.sortBy === 'time' ? 'time' : '',
  };
}
