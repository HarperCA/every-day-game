import { getProfessionOptions, listCompetitions } from '../../services/repository';
import { getFavoriteIds, toggleFavorite } from '../../services/favorites';
import { loadCompetitionPreferences, saveCompetitionPreferences, saveSurveyStatus, shouldShowPreferenceSurvey, takePreferenceSurveyRequest, surveyProvinceOptions, uploadCompetitionPreferences } from '../../services/competitionPreferences';
import { statusOptions, levelOptions, participationFormatOptions, teamSizeOptions, feeTypeOptions, registrationOrganizationOptions, regionAllOption, registrationWithinOptions, registrationWithinValues, sortByOptions, sortByValues, sortOrderOptions, sortOrderValues } from '../../services/filterOptions';
import { closingSoon, withCard } from '../../services/cardCover';

const professionOptions = ['全部专业大类', ...getProfessionOptions()];
const moreFieldMap: Record<string, string> = {
  participationFormat: 'draftParticipationFormat',
  teamSizeCategory: 'draftTeamSizeCategory',
  feeType: 'draftFeeType',
  registrationOrganization: 'draftRegistrationOrganization',
  eventLevel: 'draftEventLevel',
  registrationWithin: 'draftRegistrationWithin',
  sortBy: 'draftSortBy',
  sortOrder: 'draftSortOrder',
};
let latestListRequestId = 0;
let latestPreviewRequestId = 0;
let latestSoonRequestId = 0;

Page({
  preferenceSnapshot: '',
  pendingLoadMore: false,
  data: {
    surveyVisible: false,
    surveyStep: 0,
    surveyCategories: [] as string[],
    surveyCategoryWheelIndex: [0],
    surveyCategoryWheelChanged: false,
    surveyCategoryOptions: [{label:'不限', value:'', selected:true}, ...getProfessionOptions().map(label => ({label, value:label, selected:false}))],
    surveyProvinceOptions,
    surveyProvinceIndex: 0,
    surveyDontShowAgain: false,
    competitionCategories: [] as string[],
    preferenceProvince: '',
    keyword: '',
    appliedKeyword: '',
    statusOptions,
    levelOptions,
    professionOptions,
    participationFormatOptions,
    teamSizeOptions,
    feeTypeOptions,
    registrationOrganizationOptions,
    regionOptions: ['全国', ...surveyProvinceOptions.slice(1)],
    registrationWithinOptions,
    registrationWithinValues,
    sortByOptions,
    sortByValues,
    sortOrderOptions,
    sortOrderValues,
    regionIndex: 0,
    statusIndex: 0,
    levelIndex: 0,
    professionIndex: 0,
    participationFormat: '',
    teamSizeCategory: '',
    feeType: '',
    registrationOrganization: '',
    region: '',
    registrationWithin: '' as string,
    sortBy: '' as string,
    sortOrder: '' as string,
    draftParticipationFormat: '',
    draftTeamSizeCategory: '',
    draftFeeType: '',
    draftRegistrationOrganization: '',
    draftEventLevel: '',
    draftRegion: '',
    draftRegistrationWithin: '' as string,
    draftSortBy: '' as string,
    draftSortOrder: '' as string,
    morePanelVisible: false,
    filterCategories: ['参赛形式', '队伍人数', '报名费用', '报名方式', '赛事级别', '报名时间', '排序方式'],
    activeFilterCategoryIndex: 0,
    moreFilterCount: 0,
    morePreviewCount: 0,
    selectedConditions: [] as Array<{ kind: string; label: string }>,
    items: [] as any[],
    closingSoon: [] as any[],
    // 没结果时推荐的搜索词：覆盖理工、经管、语言、设计、双创几类常见方向
    suggestKeywords: ['数学建模', '程序设计', '创新创业', '英语', '设计'],
    total: 0,
    page: 1,
    hasMore: false,
    loading: true,
    error: '',
  },
  onLoad() {
    const saved = loadCompetitionPreferences();
    this.preferenceSnapshot = JSON.stringify(saved);
    this.setData({professionIndex:saved.categories.length === 1 ? Math.max(0, professionOptions.indexOf(saved.categories[0])) : 0, competitionCategories:saved.categories, preferenceProvince:saved.province, region:saved.province, draftRegion:saved.province});
    this.updateSelectedConditions();
    this.load(true);
    this.loadRegionOptions();
    if (shouldShowPreferenceSurvey()) this.openPreferenceSurvey();
  },
  onShow() {
    if (takePreferenceSurveyRequest()) this.openPreferenceSurvey();
    this.refreshCompetitionPreferences();
    this.refreshFavoriteState();
    const ready = getApp<any>().globalData.userDataReady;
    if (ready) ready.then(()=>{ this.refreshFavoriteState(); this.refreshCompetitionPreferences(); }).catch(()=>undefined);
  },
  openPreferencesEditor() { wx.navigateTo({ url:'/pages/preferences/preferences' }); },
  refreshCompetitionPreferences() {
    const saved = loadCompetitionPreferences();
    const snapshot = JSON.stringify(saved);
    if (!this.preferenceSnapshot || snapshot === this.preferenceSnapshot) return;
    this.preferenceSnapshot = snapshot;
    this.setData({professionIndex:saved.categories.length === 1 ? Math.max(0, professionOptions.indexOf(saved.categories[0])) : 0,
      competitionCategories:saved.categories, preferenceProvince:saved.province, region:saved.province, draftRegion:saved.province},
      () => { this.updateSelectedConditions(); this.load(true); });
  },
  onPullDownRefresh() { this.load(true).finally(() => wx.stopPullDownRefresh()); },
  async loadRegionOptions() {
    try {
      const result = await listCompetitions({ page: 5, pageSize: 100 });
      const regions = [...new Set(result.items.map((item: any) => String(item.region || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
      const regionOptions = [...new Set(['全国', ...surveyProvinceOptions.slice(1), ...regions.filter(value => value !== regionAllOption)])];
      if (this.data.region && !regionOptions.includes(this.data.region)) regionOptions.push(this.data.region);
      this.setData({ regionOptions, regionIndex: Math.max(0, regionOptions.indexOf(this.data.region)) });
    } catch (_error) {
      // 地区列表加载失败时保留“不限”，不影响其余筛选条件。
    }
  },
  openPreferenceSurvey() {
    const saved = loadCompetitionPreferences();
    this.setData({surveyVisible:true, surveyStep:0, morePanelVisible:false,
      surveyCategories:saved.categories,
      surveyCategoryWheelIndex:[saved.categories.length ? Math.max(0, getProfessionOptions().indexOf(saved.categories[0]) + 1) : 0], surveyCategoryWheelChanged:false,
      surveyCategoryOptions:[{label:'不限', value:'', selected:!saved.categories.length}, ...getProfessionOptions().map(label => ({label, value:label, selected:saved.categories.includes(label)}))],
      surveyProvinceIndex:Math.max(0, surveyProvinceOptions.indexOf(saved.province)), surveyDontShowAgain:saved.dontShowAgain});
  },
  selectSurveyCategory(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '');
    const current = this.data.surveyCategories;
    const categories = !value ? [] : current.includes(value) ? current.filter(item => item !== value) : [...current, value];
    this.setData({surveyCategories:categories, surveyCategoryWheelChanged:false, surveyCategoryOptions:[{label:'不限', value:'', selected:!categories.length}, ...getProfessionOptions().map(label => ({label, value:label, selected:categories.includes(label)}))]});
  },
  onSurveyCategoryChange(event: any) { this.setData({surveyCategoryWheelIndex:[Number(event.detail.value[0])], surveyCategoryWheelChanged:true}); },
  onSurveyProvinceChange(event: any) { this.setData({surveyProvinceIndex:Number(event.detail.value[0])}); },
  onSurveyDontShowAgainChange(event: any) { this.setData({surveyDontShowAgain:event.detail.value.includes('hide')}); },
  previousPreferenceSurveyStep() { this.setData({surveyStep:Math.max(0, this.data.surveyStep - 1)}); },
  confirmPreferenceSurveyStep() {
    if (this.data.surveyStep < 1) {
      this.setData({surveyStep:this.data.surveyStep + 1});
      return;
    }
    this.completePreferenceSurvey();
  },
  skipPreferenceSurvey() {
    try {
      saveCompetitionPreferences({...loadCompetitionPreferences(), dontShowAgain:this.data.surveyDontShowAgain});
      saveSurveyStatus('skipped');
      // 已登录的存进账号；失败不打扰用户，下次登录时再补传
      uploadCompetitionPreferences('skipped').catch(() => {});
    } catch (_error) { wx.showToast({title:'未能记住弹窗设置', icon:'none'}); }
    this.setData({surveyVisible:false});
  },
  completePreferenceSurvey() {
    if (this.data.surveyCategoryWheelChanged) {
      const value = this.data.surveyCategoryOptions[this.data.surveyCategoryWheelIndex[0]]?.value || '';
      this.setData({surveyCategories:value ? [...new Set([...this.data.surveyCategories, value])] : [], surveyCategoryWheelChanged:false});
    }
    const province = this.data.surveyProvinceIndex ? surveyProvinceOptions[this.data.surveyProvinceIndex] : '';
    try {
      saveCompetitionPreferences({profession:'', categories:this.data.surveyCategories, province, dontShowAgain:this.data.surveyDontShowAgain});
      this.preferenceSnapshot = JSON.stringify(loadCompetitionPreferences());
      saveSurveyStatus('completed');
      uploadCompetitionPreferences('completed').catch(() => {});
      this.setData({surveyVisible:false, professionIndex:this.data.surveyCategories.length === 1 ? Math.max(0, professionOptions.indexOf(this.data.surveyCategories[0])) : 0,
        competitionCategories:this.data.surveyCategories, preferenceProvince:province, region:province, draftRegion:province},
        () => { this.updateSelectedConditions(); this.load(true); });
    } catch (_error) { wx.showToast({title:'保存失败，请重试', icon:'none'}); }
  },
  onReachBottom() {
    if (!this.data.hasMore || this.data.morePanelVisible || this.data.surveyVisible) return;
    // 到底时正在加载：先记下，加载完再接着取下一页。微信只在“进入”底部区域时触发一次，
    // 页面没变高就不会再触发——双列卡片一屏能放下的多，第一页刚加载完常常还停在底部区域（2026-10）
    if (this.data.loading) { this.pendingLoadMore = true; return; }
    this.load(false);
  },
  onKeywordInput(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }); },
  onSearch() {
    const keyword = this.data.keyword.trim();
    this.setData({ keyword, appliedKeyword: keyword }, () => this.load(true));
  },
  onStatusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ statusIndex: Number(event.detail.value) }, () => { this.updateSelectedConditions(); this.load(true); });
  },
  onComprehensiveTap() {
    if (!this.data.region && !this.data.preferenceProvince && !this.data.competitionCategories.length && !this.data.professionIndex && !this.data.statusIndex) return;
    this.setData({
      statusIndex: 0, professionIndex: 0, regionIndex: 0,
      competitionCategories: [], preferenceProvince:'',
      region: '', draftRegion: '',
    }, () => { this.updateSelectedConditions(); this.load(true); });
  },
  onRegionChange(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value);
    const region = this.data.regionOptions[index] || '';
    this.setData({ region, draftRegion: region, preferenceProvince: '' }, () => { this.updateSelectedConditions(); this.load(true); });
  },
  onLevelChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ levelIndex: Number(event.detail.value) }, () => { this.updateSelectedConditions(); this.load(true); });
  },
  onProfessionChange(event: WechatMiniprogram.PickerChange) {
    const professionIndex = Number(event.detail.value);
    this.setData({ professionIndex, competitionCategories: professionIndex ? [professionOptions[professionIndex]] : [] }, () => { this.updateSelectedConditions(); this.load(true); });
  },
  updateSelectedConditions() {
    const selectedConditions: Array<{ kind: string; label: string }> = [];
    if (this.data.competitionCategories.length) selectedConditions.push({kind:'competitionCategories', label:`专业大类：${this.data.competitionCategories.join('、')}`});
    if (this.data.preferenceProvince && !this.data.region) selectedConditions.push({kind:'preferenceProvince', label:`地区：${this.data.preferenceProvince}及全国赛事`});
    if (this.data.statusIndex) selectedConditions.push({ kind: 'status', label: statusOptions[this.data.statusIndex] });
    if (this.data.levelIndex) selectedConditions.push({ kind: 'level', label: levelOptions[this.data.levelIndex] });
    if (this.data.participationFormat) selectedConditions.push({ kind: 'participationFormat', label: `参赛形式：${this.data.participationFormat}` });
    if (this.data.teamSizeCategory) selectedConditions.push({ kind: 'teamSizeCategory', label: `队伍人数：${this.data.teamSizeCategory}` });
    if (this.data.feeType) selectedConditions.push({ kind: 'feeType', label: `报名费用：${this.data.feeType}` });
    if (this.data.registrationOrganization) selectedConditions.push({ kind: 'registrationOrganization', label: `报名组织：${this.data.registrationOrganization}` });
    if (this.data.region) selectedConditions.push({ kind: 'region', label: `赛事地区：${this.data.region}` });
    if (this.data.registrationWithin) {
      const label = registrationWithinOptions[registrationWithinValues.indexOf(this.data.registrationWithin)];
      selectedConditions.push({ kind: 'registrationWithin', label: `距离报名：${label}` });
    }
    if (this.data.sortBy || this.data.sortOrder) {
      const byLabel = this.data.sortBy ? sortByOptions[sortByValues.indexOf(this.data.sortBy)] : '推荐排序';
      const orderLabel = this.data.sortOrder ? `·${sortOrderOptions[sortOrderValues.indexOf(this.data.sortOrder)]}` : '';
      selectedConditions.push({ kind: 'sort', label: `排序：${byLabel}${orderLabel}` });
    }
    const moreFilterCount = [
      this.data.participationFormat, this.data.teamSizeCategory, this.data.feeType, this.data.registrationOrganization,
      this.data.levelIndex, this.data.registrationWithin, this.data.sortBy, this.data.sortOrder,
    ].filter(Boolean).length;
    this.setData({ selectedConditions, moreFilterCount, regionIndex: Math.max(0, this.data.regionOptions.indexOf(this.data.region)) });
  },
  clearFilters() {
    this.setData({
      levelIndex: 0,
      participationFormat: '', teamSizeCategory: '', feeType: '', registrationOrganization: '',
      registrationWithin: '', sortBy: '', sortOrder: '',
      draftParticipationFormat: '', draftTeamSizeCategory: '', draftFeeType: '', draftRegistrationOrganization: '',
      draftEventLevel: '', draftRegistrationWithin: '', draftSortBy: '', draftSortOrder: '',
      morePanelVisible: false,
    }, () => { this.updateSelectedConditions(); this.load(true); });
  },
  openMoreFilters() {
    this.setData({
      draftParticipationFormat: this.data.participationFormat,
      draftTeamSizeCategory: this.data.teamSizeCategory,
      draftFeeType: this.data.feeType,
      draftRegistrationOrganization: this.data.registrationOrganization,
      draftEventLevel: this.data.levelIndex ? levelOptions[this.data.levelIndex] : '',
      draftRegion: this.data.region,
      draftRegistrationWithin: this.data.registrationWithin,
      draftSortBy: this.data.sortBy,
      draftSortOrder: this.data.sortOrder,
      activeFilterCategoryIndex: 0,
      morePanelVisible: true,
    }, () => this.refreshMorePreview());
  },
  closeMoreFilters() { this.setData({ morePanelVisible: false }); },
  blockPanelTap() {},
  selectFilterCategory(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isInteger(index) && index >= 0 && index < this.data.filterCategories.length) {
      this.setData({ activeFilterCategoryIndex: index });
    }
  },
  selectMoreOption(event: WechatMiniprogram.TouchEvent) {
    const kind = String(event.currentTarget.dataset.kind || '');
    const value = String(event.currentTarget.dataset.value || '');
    const field = moreFieldMap[kind];
    if (!field) return;
    const current = String((this.data as any)[field] || '');
    const next = current === value ? '' : value;
    // 时间顺序只有在按报名时间排序时才有意义，避免界面显示已选而查询没有变化。
    if (kind === 'sortOrder') {
      this.setData({ draftSortOrder: next, ...(next ? { draftSortBy: 'time' } : {}) }, () => this.refreshMorePreview());
      return;
    }
    if (kind === 'sortBy') {
      this.setData({ draftSortBy: next, draftSortOrder: next ? this.data.draftSortOrder : '' }, () => this.refreshMorePreview());
      return;
    }
    this.setData({ [field]: next }, () => this.refreshMorePreview());
  },
  resetMoreFilters() {
    this.setData({
      draftParticipationFormat: '', draftTeamSizeCategory: '', draftFeeType: '', draftRegistrationOrganization: '',
      draftEventLevel: '', draftRegistrationWithin: '', draftSortBy: '', draftSortOrder: '',
    }, () => this.refreshMorePreview());
  },
  applyMoreFilters() {
    this.setData({
      participationFormat: this.data.draftParticipationFormat,
      teamSizeCategory: this.data.draftTeamSizeCategory,
      feeType: this.data.draftFeeType,
      registrationOrganization: this.data.draftRegistrationOrganization,
      levelIndex: Math.max(0, levelOptions.indexOf(this.data.draftEventLevel)),
      region: this.data.draftRegion,
      preferenceProvince: this.data.draftRegion ? '' : this.data.preferenceProvince,
      registrationWithin: this.data.draftRegistrationWithin,
      sortBy: this.data.draftSortBy,
      sortOrder: this.data.draftSortOrder,
      morePanelVisible: false,
    }, () => { this.updateSelectedConditions(); this.load(true); });
  },
  async refreshMorePreview() {
    const requestId = ++latestPreviewRequestId;
    try {
      const result = await listCompetitions({
        searchUnion: true,
        competitionCategories:this.data.competitionCategories,
        preferenceProvince:this.data.draftRegion ? '' : this.data.preferenceProvince,
        keyword: this.data.appliedKeyword,
        registrationStatus: this.data.statusIndex ? statusOptions[this.data.statusIndex] : '',
        eventLevel: this.data.draftEventLevel,
        profession: '',
        participationFormat: this.data.draftParticipationFormat,
        teamSizeCategory: this.data.draftTeamSizeCategory,
        feeType: this.data.draftFeeType,
        registrationOrganization: this.data.draftRegistrationOrganization,
        region: this.data.draftRegion,
        registrationWithin: this.data.draftRegistrationWithin as any,
        sortBy: this.data.draftSortBy as any,
        sortOrder: this.data.draftSortOrder as any,
        page: 1,
        pageSize: 1000,
      });
      if (requestId === latestPreviewRequestId && this.data.morePanelVisible) this.setData({ morePreviewCount: result.total });
    } catch (_error) {
      if (requestId === latestPreviewRequestId && this.data.morePanelVisible) this.setData({ morePreviewCount: 0 });
    }
  },
  retry() { this.load(true); },
  openDetail(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` }); },
  async toggleFavorite(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '');
    if (!id) return;
    try {
      if (!await getApp<any>().requestWechatLogin()) return;
    } catch (_error) { return; }
    const favorited = toggleFavorite(id);
    this.refreshFavoriteState();
    wx.showToast({ title: favorited ? '已收藏' : '已取消收藏', icon: favorited ? 'success' : 'none' });
  },
  refreshFavoriteState() {
    const favoriteIds = new Set(getFavoriteIds());
    this.setItems(this.data.items.map((item: any) => ({ ...item, isFavorite: favoriteIds.has(item.id) })));
  },
  // 更新列表：每张卡片带上文字封面、截止倒计时、级别和推荐等级；翻页时保留已知加载失败的海报，不再重试一遍
  setItems(items: any[], extra: Record<string, unknown> = {}) {
    const failed = new Set(this.data.items.filter((item: any) => item.posterFailed).map((item: any) => item.id));
    const now = new Date();
    this.setData({ items: items.map(item => withCard(failed.has(item.id) ? { ...item, posterFailed: true } : item, now)), ...extra });
  },
  // 卡片右上角星标（模板 templates/poster-card.wxml 里叫 onStarTap，收藏页同名方法是取消收藏）
  onStarTap(event: WechatMiniprogram.TouchEvent) { return this.toggleFavorite(event); },
  // 没结果时点推荐词：按这个词重新搜
  searchSuggestion(event: WechatMiniprogram.TouchEvent) {
    const keyword = String(event.currentTarget.dataset.keyword || '');
    if (keyword) this.setData({ keyword, appliedKeyword: keyword }, () => this.load(true));
  },
  // 即将截止：和当前地区、专业大类筛选一致，取报名中的赛事，挑 7 天内截止的；失败就不显示，不影响列表
  async loadClosingSoon() {
    const requestId = ++latestSoonRequestId;
    try {
      const result = await listCompetitions({
        competitionCategories: this.data.competitionCategories,
        preferenceProvince: this.data.region ? '' : this.data.preferenceProvince,
        region: this.data.region,
        registrationStatus: '报名中',
        page: 1,
        pageSize: 100,
      });
      if (requestId === latestSoonRequestId) this.setData({ closingSoon: closingSoon(result.items) });
    } catch (_error) {
      if (requestId === latestSoonRequestId) this.setData({ closingSoon: [] });
    }
  },
  // 海报加载失败：只把这一张卡片改成文字封面，不重传整个列表（几张同时失败时整表重绘会卡）
  onPosterError(event: WechatMiniprogram.TouchEvent) {
    const { id, index } = event.currentTarget.dataset;
    const at = this.data.items[index]?.id === id ? Number(index) : this.data.items.findIndex((item: any) => item.id === id);
    if (at >= 0) this.setData({ [`items[${at}].posterFailed`]: true });
  },
  async load(reset: boolean) {
    const requestId = ++latestListRequestId;
    const page = reset ? 1 : this.data.page + 1;
    if (reset) this.pendingLoadMore = false;
    this.setData({ loading: true, error: '' });
    try {
      const result = await listCompetitions({
        searchUnion: true,
        competitionCategories:this.data.competitionCategories,
        preferenceProvince:this.data.region ? '' : this.data.preferenceProvince,
        keyword: this.data.appliedKeyword,
        registrationStatus: this.data.statusIndex ? statusOptions[this.data.statusIndex] : '',
        eventLevel: this.data.levelIndex ? levelOptions[this.data.levelIndex] : '',
        profession: '',
        participationFormat: this.data.participationFormat,
        teamSizeCategory: this.data.teamSizeCategory,
        feeType: this.data.feeType,
        registrationOrganization: this.data.registrationOrganization,
        region: this.data.region,
        registrationWithin: this.data.registrationWithin as any,
        sortBy: this.data.sortBy as any,
        sortOrder: this.data.sortOrder as any,
        page,
        // 双列卡片一页 16 张，和原来单列 8 张差不多高，第一屏能滚得动
        pageSize: 16,
      });
      if (requestId !== latestListRequestId) return;
      const favoriteIds = new Set(getFavoriteIds());
      const resultItems = result.items.map((item: any) => ({ ...item, isFavorite: favoriteIds.has(item.id) }));
      this.setItems(resultItems, {
        total: result.total,
        hasMore: result.hasMore,
        page,
        loading: false,
      });
      // 列表出来后再取“即将截止”，不跟列表抢网络；筛选变了它也跟着变，搜索时不显示就不取
      if (reset && !this.data.appliedKeyword) this.loadClosingSoon();
      if (this.pendingLoadMore) {
        this.pendingLoadMore = false;
        if (result.hasMore) this.load(false);
      }
    } catch (error) {
      if (requestId !== latestListRequestId) return;
      this.pendingLoadMore = false;
      this.setData({ loading: false, error: error instanceof Error ? error.message : '加载失败，请重试' });
    }
  },
});
