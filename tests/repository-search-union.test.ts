import { beforeEach, expect, it, vi } from 'vitest';
const callPublicData = vi.hoisted(() => vi.fn());
vi.mock('../apps/miniprogram/services/cloudSession', () => ({callPublicData}));
import { listCompetitions } from '../apps/miniprogram/services/repository';

const records = [
  {id:'primary',name:'地方赛事',registration_status:'报名中',fee_type:'免费'},
  {id:'both',name:'数学比赛',registration_status:'报名中',fee_type:'免费'},
  {id:'search',name:'数学竞赛',registration_status:'即将报名',fee_type:'免费'},
  {id:'closed',name:'数学往届',registration_status:'已截止',data_status:'archived',fee_type:'免费'},
  {id:'paid',name:'数学收费',registration_status:'报名中',fee_type:'收费'},
];
beforeEach(() => {
  callPublicData.mockReset();
  callPublicData.mockImplementation(async (_action,{query}) => {
    let items = records.filter(item => !query.feeType || item.fee_type === query.feeType);
    if (query.registrationStatus) items = items.filter(item => item.registration_status === query.registrationStatus);
    if (query.keyword) items = items.filter(item => item.name.includes(query.keyword));
    const visible = (query.page || 1) * (query.pageSize || 8);
    return {items:items.slice(0,visible),total:items.length,hasMore:visible < items.length};
  });
});

it('unions primary and keyword branches, deduplicates and applies shared secondary filters',async () => {
  const result = await listCompetitions({searchUnion:true,keyword:'数学',registrationStatus:'报名中',feeType:'免费',page:1,pageSize:2});
  expect(result.items.map(item=>item.id)).toEqual(['both','search']);
  expect(result.total).toBe(4);
  expect(result.hasMore).toBe(true);
  const next = await listCompetitions({searchUnion:true,keyword:'数学',registrationStatus:'报名中',feeType:'免费',page:2,pageSize:2});
  expect(next.items.map(item=>item.id)).toEqual(['both','search','primary','closed']);
  expect(next.hasMore).toBe(false);
  expect(callPublicData.mock.calls.every(([,arg])=>arg.query.feeType === '免费' && !('searchUnion' in arg.query))).toBe(true);
});

it('with no primary filters only searches instead of unioning all contests',async () => {
  const result = await listCompetitions({searchUnion:true,keyword:'数学',feeType:'免费'});
  expect(result.items.map(item=>item.id)).toEqual(['both','search','closed']);
  expect(callPublicData).toHaveBeenCalledTimes(1);
});

it('without keyword uses normal primary filtering',async () => {
  const result = await listCompetitions({searchUnion:true,registrationStatus:'报名中',feeType:'免费'});
  expect(result.items.map(item=>item.id)).toEqual(['primary','both']);
  expect(callPublicData).toHaveBeenCalledTimes(1);
});

it('explicit sorting preserves the backend global order across union branches',async () => {
  const result = await listCompetitions({searchUnion:true,keyword:'数学',registrationStatus:'报名中',feeType:'免费',sortBy:'time',sortOrder:'asc'});
  expect(result.items.map(item=>item.id)).toEqual(['primary','both','search','closed']);
});

it('keyword results can cross province, category and registration status while retaining secondary constraints',async () => {
  const candidates = [
    {id:'local',name:'安徽商赛',region:'安徽省',professions:['经管与商科'],registration_status:'报名中',fee_type:'免费'},
    {id:'cross',name:'数学建模',region:'广东省',professions:['数学'],registration_status:'即将报名',fee_type:'免费'},
    {id:'paid-cross',name:'数学收费',region:'广东省',professions:['数学'],registration_status:'报名中',fee_type:'收费'},
    {id:'unrelated',name:'广东艺术赛',region:'广东省',professions:['设计与艺术'],registration_status:'报名中',fee_type:'免费'},
  ];
  callPublicData.mockImplementation(async (_action,{query}) => {
    const items = candidates.filter(item => (!query.feeType || item.fee_type === query.feeType)
      && (!query.registrationStatus || item.registration_status === query.registrationStatus)
      && (!query.keyword || item.name.includes(query.keyword)));
    return {items,total:items.length,hasMore:false};
  });
  const result = await listCompetitions({searchUnion:true,region:'安徽省',competitionCategories:['经管与商科'],registrationStatus:'报名中',keyword:'数学',feeType:'免费'});
  expect(result.items.map(item=>item.id)).toEqual(['cross','local']);
  expect(result.total).toBe(2);
});
