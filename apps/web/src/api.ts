// 读赛事数据：和小程序调的是同一个公开接口（publicData），拿到的是同一份已发布数据。
import { hydratePublic } from '../../miniprogram/services/publicRecord';

export interface Query {
  keyword?: string;
  registrationStatus?: string;
  eventLevel?: string;
  profession?: string;
  participationFormat?: string;
  teamSizeCategory?: string;
  feeType?: string;
  registrationOrganization?: string;
  registrationWithin?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  pageSize?: number;
}

export async function callPublicData<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch('/api/publicData', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!response.ok) throw new Error(`网络请求失败（${response.status}）`);
  const result = await response.json();
  if (!result?.ok) throw new Error(result?.message === 'public_record_not_found' ? '赛事不存在或已下架' : (result?.message || '加载失败'));
  return result.data as T;
}

export async function listCompetitions(query: Query) {
  const result = await callPublicData<{ items: any[]; total: number; hasMore: boolean }>('list', { query });
  return { ...result, items: result.items.map(hydratePublic) };
}

export async function getCompetition(id: string) {
  return hydratePublic(await callPublicData<any>('get', { id }));
}
