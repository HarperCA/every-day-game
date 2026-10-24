import { getProfessionOptions, listHomeCompetitions } from '../../services/repository';
import { getFavoriteIds, toggleFavorite } from '../../services/favorites';
import { getReminderRecords } from '../../services/reminders';
import { loadCompetitionPreferences, saveCompetitionPreferences, saveSurveyStatus, shouldShowPreferenceSurvey, takePreferenceSurveyRequest, surveyProvinceOptions, uploadCompetitionPreferences } from '../../services/competitionPreferences';
import { levelOptions, participationFormatOptions, teamSizeOptions, feeTypeOptions, registrationOrganizationOptions, registrationWithinOptions, registrationWithinValues } from '../../services/filterOptions';
import { withCard } from '../../services/cardCover';

// 首页筛选（2026-10-24 改版，用户定）：
// - 筛选栏左边三个状态标签，一定有一个选中（默认报名中）；右边“筛选”打开面板。
// - 地区、专业大类放进面板，和级别、参赛形式等连成一长列，往下滑时左边高亮跟着走。
// - 有搜索词时搜索第一优先，不分标签、不按偏好筛；搜索后再改筛选（点标签也算）就清空搜索框。
// - 一次请求走新版列表（listVersion 2），收藏、提醒用每轮筛选或搜索时拍的快照，翻页时顺序不跳。
export const STATUS_TABS = [
  { label:'报名中', groups:['报名中'] },
  { label:'未开始', groups:['时间待公布'] },
  { label:'已截止', groups:['比赛中', '比赛已结束'] },
];
const ALL = '不限';
// 地区只放“不限”“全国”两个按钮，具体省份点“选择省份”从底部滚轮里选（2026-10-24，用户定）
const NATIONWIDE = '全国';
const provinceOptions = surveyProvinceOptions.filter(item => item !== NATIONWIDE);
const categoryOptions = [ALL, ...getProfessionOptions()];
export const FILTER_SECTIONS = ['地区', '专业大类', '赛事级别', '参赛形式', '队伍人数', '报名费用', '报名方式', '报名时间'];
const PANEL_FIELDS = ['eventLevel', 'participationFormat', 'teamSizeCategory', 'feeType', 'registrationOrganization', 'registrationWithin'] as const;
const draftField = (field: string) => `draft${field[0].toUpperCase()}${field.slice(1)}`;
const MAX_MARKED_IDS = 200;
const TAB_DEBOUNCE_MS = 300;
let latestListRequestId = 0;
let latestPreviewRequestId = 0;

// 收藏和“已授权、还没到时间”的提醒对应的比赛编号
function markedSnapshot() {
  const reminderIds = getReminderRecords()
    .filter(item => item.authorizationStatus === 'accepted' && (item.deliveryStatus === 'pending' || item.deliveryStatus === 'queued'))
    .map(item => item.editionId);
  return {
    favoriteIds:[...new Set(getFavoriteIds())].slice(0, MAX_MARKED_IDS),
    reminderIds:[...new Set(reminderIds)].slice(0, MAX_MARKED_IDS),
  };
}

// 助手带过来的报名状态换成标签：没有或认不出时用默认的“报名中”
function tabForStatus(status: string) {
  if (status === '即将报名' || status === '时间待公布') return 1;
  if (status === '已截止') return 2;
  return 0;
}

Page({
  preferenceSnapshot: '',
  pendingLoadMore: false,
  marked: { favoriteIds:[] as string[], reminderIds:[] as string[] },
  tabTimer: 0 as any,
  sectionTops: [] as number[],
  optionsHeight: 0,
  spyLockedUntil: 0,
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
    statusTabs: STATUS_TABS.map(tab => tab.label),
    statusTab: 0,
    keyword: '',
    appliedKeyword: '',
    // 搜索词映射出的专业大类（服务器给的），搜索时打开面板显示它
    searchCategories: [] as string[],
    // 当前生效的条件：地区为空 = 不限；地区、专业大类没改过面板时来自偏好
    region: '',
    categories: [] as string[],
    eventLevel: '',
    participationFormat: '',
    teamSizeCategory: '',
    feeType: '',
    registrationOrganization: '',
    registrationWithin: '',
    // 面板里还没点“确定”的条件
    draftRegion: '',
    draftCategories: [] as string[],
    draftEventLevel: '',
    draftParticipationFormat: '',
    draftTeamSizeCategory: '',
    draftFeeType: '',
    draftRegistrationOrganization: '',
    draftRegistrationWithin: '',
    provinceOptions,
    provincePickerIndex: 0,
    categoryChips: categoryOptions.map((label, index) => ({ label, selected: index === 0 })),
    levelOptions: levelOptions.slice(1),
    participationFormatOptions,
    teamSizeOptions,
    feeTypeOptions,
    registrationOrganizationOptions,
    registrationWithinOptions,
    registrationWithinValues,
    filterSections: FILTER_SECTIONS,
    sectionMarks: FILTER_SECTIONS.map(() => false),
    activeSection: 0,
    sectionScrollInto: '',
    morePanelVisible: false,
    filterCount: 0,
    morePreviewCount: 0,
    items: [] as any[],
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
    this.setData({ categories:saved.categories, region:saved.province }, () => this.updateFilterCount());
    this.load(true, true);
    if (shouldShowPreferenceSurvey()) this.openPreferenceSurvey();
  },
  onShow() {
    if (takePreferenceSurveyRequest()) this.openPreferenceSurvey();
    this.refreshCompetitionPreferences();
    this.applyAssistantFilters();
    this.refreshFavoriteState();
    const ready = getApp<any>().globalData.userDataReady;
    if (ready) ready.then(()=>{ this.refreshFavoriteState(); this.refreshCompetitionPreferences(); }).catch(()=>undefined);
  },
  onUnload() { clearTimeout(this.tabTimer); },
  openPreferencesEditor() { wx.navigateTo({ url:'/pages/preferences/preferences' }); },
  // 改了偏好就按最新偏好筛（第一步规则：以最后一次改动为准）
  refreshCompetitionPreferences() {
    const saved = loadCompetitionPreferences();
    const snapshot = JSON.stringify(saved);
    if (!this.preferenceSnapshot || snapshot === this.preferenceSnapshot) return;
    this.preferenceSnapshot = snapshot;
    this.setData({ categories:saved.categories, region:saved.province }, () => { this.updateFilterCount(); this.load(true, true); });
  },
  // 下拉刷新沿用这一轮的收藏、提醒快照
  onPullDownRefresh() { this.load(true).finally(() => wx.stopPullDownRefresh()); },
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
      this.setData({surveyVisible:false, categories:this.data.surveyCategories, region:province},
        () => { this.updateFilterCount(); this.load(true, true); });
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
    this.setData({ keyword, appliedKeyword: keyword, searchCategories: [] }, () => this.load(true, true));
  },
  // 点状态标签：搜索中点也算改筛选，清空搜索；连续快速点只按停手 0.3 秒后的那一个发请求
  onStatusTab(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= STATUS_TABS.length) return;
    if (index === this.data.statusTab && !this.data.appliedKeyword) return;
    this.setData({ statusTab: index, keyword: '', appliedKeyword: '', searchCategories: [], loading: true });
    clearTimeout(this.tabTimer);
    this.tabTimer = setTimeout(() => this.load(true, true), TAB_DEBOUNCE_MS);
  },
  updateFilterCount() {
    const filterCount = [this.data.region, this.data.categories.length, ...PANEL_FIELDS.map(field => (this.data as any)[field])].filter(Boolean).length;
    this.setData({ filterCount });
  },
  updateSectionMarks() {
    const d = this.data as any;
    // 专业大类是多选，选没选中在这里算好：页面模板不支持 indexOf 这类方法调用，写在模板里会一直算成没选中
    const categoryChips = categoryOptions.map((label, index) => ({ label, selected: index === 0 ? !d.draftCategories.length : d.draftCategories.includes(label) }));
    this.setData({ categoryChips, sectionMarks: [d.draftRegion, d.draftCategories.length, ...PANEL_FIELDS.map(field => d[draftField(field)])].map(Boolean) });
  },
  // 打开面板：搜索时显示搜索实际用的条件（不限地区 + 搜索词映射出的专业大类），否则显示当前条件
  openMoreFilters() {
    const searching = Boolean(this.data.appliedKeyword);
    const drafts: Record<string, unknown> = {
      draftRegion: searching ? '' : this.data.region,
      draftCategories: searching ? this.data.searchCategories : this.data.categories,
    };
    for (const field of PANEL_FIELDS) drafts[draftField(field)] = (this.data as any)[field];
    this.sectionTops = [];
    drafts.provincePickerIndex = Math.max(0, provinceOptions.indexOf(String(drafts.draftRegion)));
    this.setData({ ...drafts, activeSection: 0, sectionScrollInto: '', morePanelVisible: true }, () => {
      this.updateSectionMarks();
      this.refreshMorePreview();
      this.measureSections();
    });
  },
  closeMoreFilters() { this.setData({ morePanelVisible: false }); },
  blockPanelTap() {},
  // 记下每一类小标题在右侧滚动区里的位置，滑动时据此高亮左边
  measureSections() {
    const query = wx.createSelectorQuery().in(this as any);
    query.select('.filter-options').boundingClientRect();
    query.selectAll('.filter-section').boundingClientRect();
    query.exec((res: any) => {
      const box = res?.[0];
      const sections = res?.[1] || [];
      if (!box || !sections.length) return;
      this.optionsHeight = box.height;
      this.sectionTops = sections.map((rect: any) => rect.top - box.top);
    });
  },
  // 点左边某一类：右边滚到这一类；滚动途中不让滑动高亮来回跳
  selectFilterSection(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= FILTER_SECTIONS.length) return;
    this.spyLockedUntil = Date.now() + 600;
    this.setData({ activeSection: index, sectionScrollInto: `fsec-${index}` });
  },
  onFilterScroll(event: any) {
    if (Date.now() < this.spyLockedUntil || !this.sectionTops.length) return;
    const { scrollTop, scrollHeight } = event.detail;
    let active = 0;
    this.sectionTops.forEach((top, index) => { if (top <= scrollTop + 24) active = index; });
    // 滑到底时最后几类到不了顶上，直接高亮最后一类
    if (this.optionsHeight && scrollTop + this.optionsHeight >= scrollHeight - 4) active = FILTER_SECTIONS.length - 1;
    if (active !== this.data.activeSection) this.setData({ activeSection: active });
  },
  // 省份滚轮选好：这个按钮显示省名
  onProvincePick(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value);
    const province = provinceOptions[index];
    if (!province) return;
    this.setData({ draftRegion: province, provincePickerIndex: index }, () => { this.updateSectionMarks(); this.refreshMorePreview(); });
  },
  // 面板里单选的条件：再点一次取消
  selectMoreOption(event: WechatMiniprogram.TouchEvent) {
    const kind = String(event.currentTarget.dataset.kind || '');
    const value = String(event.currentTarget.dataset.value || '');
    if (kind === 'region') {
      this.setData({ draftRegion: value === ALL || value === this.data.draftRegion ? '' : value }, () => { this.updateSectionMarks(); this.refreshMorePreview(); });
      return;
    }
    // 专业大类可以多选；点“不限”清空
    if (kind === 'categories') {
      const current = this.data.draftCategories;
      const next = value === ALL ? [] : current.includes(value) ? current.filter(item => item !== value) : [...current, value];
      this.setData({ draftCategories: next }, () => { this.updateSectionMarks(); this.refreshMorePreview(); });
      return;
    }
    if (!(PANEL_FIELDS as readonly string[]).includes(kind)) return;
    const field = draftField(kind);
    const next = String((this.data as any)[field] || '') === value ? '' : value;
    this.setData({ [field]: next }, () => { this.updateSectionMarks(); this.refreshMorePreview(); });
  },
  // 清空选择：面板里的全部条件，包括地区和专业大类
  resetMoreFilters() {
    const drafts: Record<string, unknown> = { draftRegion: '', draftCategories: [] };
    for (const field of PANEL_FIELDS) drafts[draftField(field)] = '';
    this.setData(drafts, () => { this.updateSectionMarks(); this.refreshMorePreview(); });
  },
  // 点“确定”：按面板条件筛；搜索中改筛选就清空搜索框
  applyMoreFilters() {
    const applied: Record<string, unknown> = { region: this.data.draftRegion, categories: this.data.draftCategories };
    for (const field of PANEL_FIELDS) applied[field] = (this.data as any)[draftField(field)];
    this.setData({ ...applied, keyword: '', appliedKeyword: '', searchCategories: [], morePanelVisible: false }, () => {
      this.updateFilterCount();
      this.load(true, true);
    });
  },
  // 面板底部“确定 · N 场赛事”：按点确定以后的条件（不带搜索词、当前标签）算
  async refreshMorePreview() {
    const requestId = ++latestPreviewRequestId;
    const d = this.data as any;
    const query: Record<string, any> = { categories: d.draftCategories, province: d.draftRegion, listGroups: STATUS_TABS[d.statusTab].groups, page: 1, pageSize: 1 };
    for (const field of PANEL_FIELDS) query[field] = d[draftField(field)];
    try {
      const result = await listHomeCompetitions(query);
      if (requestId === latestPreviewRequestId && this.data.morePanelVisible) this.setData({ morePreviewCount: result.total });
    } catch (_error) {
      if (requestId === latestPreviewRequestId && this.data.morePanelVisible) this.setData({ morePreviewCount: 0 });
    }
  },
  retry() { this.load(true); },
  openDetail(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` }); },
  openAssistant() { wx.navigateTo({ url: '/pages/assistant/assistant' }); },
  // 从赛事助手点“去找比赛页看全部”过来：换成助手用的那组条件（见 services/assistant.ts 的 filtersForIndexPage）。
  // 只用一次，取走就清掉；没有带条件就什么都不做。首页没有排序方式了，助手的排序不带过来。
  applyAssistantFilters() {
    const app = getApp<any>();
    const filters = app.globalData.assistantFilters;
    if (!filters) return;
    app.globalData.assistantFilters = null;
    this.setData({
      keyword: filters.keyword || '', appliedKeyword: filters.keyword || '', searchCategories: [],
      categories: filters.competitionCategories || [],
      region: filters.region || '',
      statusTab: tabForStatus(filters.registrationStatus || ''),
      eventLevel: filters.eventLevel || '',
      participationFormat: filters.participationFormat || '', teamSizeCategory: '', feeType: filters.feeType || '', registrationOrganization: '',
      registrationWithin: filters.registrationWithin || '',
      morePanelVisible: false,
    }, () => { this.updateFilterCount(); this.load(true, true); });
  },
  // 点收藏不马上重排：只改星标，下一次筛选或搜索时才按新的收藏排
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
    if (keyword) this.setData({ keyword, appliedKeyword: keyword, searchCategories: [] }, () => this.load(true, true));
  },
  // 海报加载失败：只把这一张卡片改成文字封面，不重传整个列表（几张同时失败时整表重绘会卡）
  onPosterError(event: WechatMiniprogram.TouchEvent) {
    const { id, index } = event.currentTarget.dataset;
    const at = this.data.items[index]?.id === id ? Number(index) : this.data.items.findIndex((item: any) => item.id === id);
    if (at >= 0) this.setData({ [`items[${at}].posterFailed`]: true });
  },
  // reset：从第 1 页重来；snapshot：重新拍收藏、提醒快照（筛选、搜索、改偏好时拍，翻页和下拉刷新沿用）
  async load(reset: boolean, snapshot = false) {
    clearTimeout(this.tabTimer);
    const requestId = ++latestListRequestId;
    const page = reset ? 1 : this.data.page + 1;
    if (reset) this.pendingLoadMore = false;
    if (snapshot) this.marked = markedSnapshot();
    this.setData({ loading: true, error: '' });
    const d = this.data as any;
    const query: Record<string, any> = {
      keyword: d.appliedKeyword, categories: d.categories, province: d.region, listGroups: STATUS_TABS[d.statusTab].groups,
      ...this.marked, page,
      // 双列卡片一页 16 张，和原来单列 8 张差不多高，第一屏能滚得动
      pageSize: 16,
    };
    for (const field of PANEL_FIELDS) query[field] = d[field];
    try {
      const result = await listHomeCompetitions(query);
      if (requestId !== latestListRequestId) return;
      const favoriteIds = new Set(getFavoriteIds());
      const resultItems = result.items.map((item: any) => ({ ...item, isFavorite: favoriteIds.has(item.id) }));
      this.setItems(resultItems, {
        total: result.total,
        hasMore: result.hasMore,
        page,
        loading: false,
        ...(result.appliedCategories ? { searchCategories: result.appliedCategories } : {}),
      });
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
