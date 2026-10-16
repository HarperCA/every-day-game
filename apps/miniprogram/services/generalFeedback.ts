import { callUserData } from './cloudSession';

export const feedbackTypes = [
  { value: 'bug', label: '功能异常' },
  { value: 'suggestion', label: '使用建议' },
  { value: 'data', label: '数据问题' },
  { value: 'other', label: '其他' },
];
export const feedbackStatusLabels: Record<string, string> = { pending: '待处理', processing: '处理中', resolved: '已解决' };
export interface GeneralFeedbackRecord {
  id: string; type: string; content: string; contact: string; status: string;
  publicReply: string; createdAt: string; updatedAt: string;
}
export function submitGeneralFeedback(payload: { type: string; content: string; contact: string; appVersion: string }) {
  return callUserData('submitGeneralFeedback', payload);
}
export function listGeneralFeedback(page: number, pageSize = 20) {
  return callUserData<{ items: GeneralFeedbackRecord[]; total: number; hasMore: boolean }>('listGeneralFeedback', { page, pageSize });
}
export function feedbackDate(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
