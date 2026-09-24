import { describe, expect, it } from 'vitest';
import { compareOne } from '../scripts/server/verify-public-cache.mjs';

const doc = { name:'测试竞赛', event_level:'国家级', registration_status:'报名中', professions:['计算机与AI'], data_status:'published' };

describe('发布验收', () => {
  it('已发布记录取得到且字段一致时通过', () => {
    expect(compareOne({ id:'a', name:'测试竞赛', dataStatus:'published' }, { doc }, { ok:true, data:{ ...doc } })).toBeNull();
  });
  it('已发布却取不到、字段不一致、不该公开却能取到，都报出来', () => {
    expect(compareOne({ id:'a', name:'x', dataStatus:'published' }, { doc }, { ok:false, message:'public_record_not_found' }).problem).toContain('公开接口取不到');
    const diff = compareOne({ id:'a', name:'x', dataStatus:'archived' }, { doc }, { ok:true, data:{ ...doc, event_level:'省级/区域级' } });
    expect(diff.diffs).toEqual([{ field:'event_level', expected:'国家级', actual:'省级/区域级' }]);
    expect(compareOne({ id:'a', name:'x', dataStatus:'offline' }, { error:'x' }, { ok:true, data:doc }).problem).toBe('不该公开却能取到');
    expect(compareOne({ id:'a', name:'x', dataStatus:'draft' }, { error:'x' }, { ok:false })).toBeNull();
  });
  it('管理记录已过不了公开门槛时单独报出，并注明用户是否仍看得到', () => {
    expect(compareOne({ id:'a', name:'CACC', dataStatus:'archived' }, { error:'public_cache_competition_out_of_scope' }, { ok:true, data:doc }))
      .toMatchObject({ problem:'管理记录过不了公开缓存门槛：public_cache_competition_out_of_scope', publicVisible:true });
  });
});
