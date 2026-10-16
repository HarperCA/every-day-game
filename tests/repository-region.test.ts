import { expect, it, vi } from 'vitest';
const callPublicData = vi.hoisted(() => vi.fn());
vi.mock('../apps/miniprogram/services/cloudSession', () => ({callPublicData}));
import { listCompetitions } from '../apps/miniprogram/services/repository';

it('province selection includes local, regional and national contests without an exact server region filter', async () => {
  const items = [['national','全国'], ['local','浙江'], ['regional','华东'], ['other','广东省']]
    .map(([id,region]) => ({id,name:id,region,professions:[],data_status:'published'}));
  callPublicData.mockResolvedValue({items,total:4,hasMore:false});
  const result=await listCompetitions({region:'浙江省',keyword:'建模',page:1,pageSize:8});
  expect(callPublicData).toHaveBeenCalledWith('list',expect.objectContaining({query:expect.objectContaining({region:'',keyword:'建模'})}));
  expect(result.items.map(item=>item.id)).toEqual(['national','local','regional']);
  expect(result.total).toBe(3);
});
