import { getProfessionOptions, listCompetitions } from '../../services/repository';
import { getFavoriteIds, toggleFavorite } from '../../services/favorites';
import { loadCompetitionPreferences, saveCompetitionPreferences, saveSurveyStatus, shouldShowPreferenceSurvey, takePreferenceSurveyRequest, surveyProvinceOptions, uploadCompetitionPreferences } from '../../services/competitionPreferences';
import { statusOptions, levelOptions, participationFormatOptions, teamSizeOptions, feeTypeOptions, registrationOrganizationOptions, regionAllOption, registrationWithinOptions, registrationWithinValues, sortByOptions, sortByValues, sortOrderOptions, sortOrderValues } from '../../services/filterOptions';
import { splitColumns, withCover } from '../../services/waterfall';

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

Page({
  preferenceSnapshot: '',
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
    leftItems: [] as any[],
    rightItems: [] as any[],
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
  onReachBottom() { if (this.data.hasMore && !this.data.loading && !this.data.morePanelVisible && !this.data.surveyVisible) this.load(false); },
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
  // 列表整体和左右两列一起更新，瀑布流始终跟 items 保持一致；每张卡片带上文字封面，没海报时用
  setItems(items: any[], extra: Record<string, unknown> = {}) {
    const withCovers = items.map(withCover);
    this.setData({ items: withCovers, ...splitColumns(withCovers), ...extra });
  },
  // 海报加载失败：这张卡片改用文字封面
  onPosterError(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id;
    this.setItems(this.data.items.map((item: any) => item.id === id ? { ...item, posterFailed: true } : item));
  },
  async load(reset: boolean) {
    const requestId = ++latestListRequestId;
    const page = reset ? 1 : this.data.page + 1;
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
        pageSize: 8,
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
    } catch (error) {
      if (requestId !== latestListRequestId) return;
      this.setData({ loading: false, error: error instanceof Error ? error.message : '加载失败，请重试' });
    }
  },
});
