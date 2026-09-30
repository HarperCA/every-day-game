import { getProfessionOptions, listCompetitions } from '../../services/repository';
import { getFavoriteIds, toggleFavorite } from '../../services/favorites';
import { statusOptions, levelOptions, participationFormatOptions, teamSizeOptions, feeTypeOptions, registrationOrganizationOptions, registrationWithinOptions, registrationWithinValues, sortByOptions, sortByValues, sortOrderOptions, sortOrderValues } from '../../services/filterOptions';

const professionOptions = ['全部适合专业', ...getProfessionOptions()];
const moreFieldMap: Record<string, string> = {
  participationFormat: 'draftParticipationFormat',
  teamSizeCategory: 'draftTeamSizeCategory',
  feeType: 'draftFeeType',
  registrationOrganization: 'draftRegistrationOrganization',
  registrationWithin: 'draftRegistrationWithin',
  sortBy: 'draftSortBy',
  sortOrder: 'draftSortOrder',
};

Page({
  data: {
    keyword: '',
    statusOptions,
    levelOptions,
    professionOptions,
    participationFormatOptions,
    teamSizeOptions,
    feeTypeOptions,
    registrationOrganizationOptions,
    registrationWithinOptions,
    registrationWithinValues,
    sortByOptions,
    sortByValues,
    sortOrderOptions,
    sortOrderValues,
    statusIndex: 0,
    levelIndex: 0,
    professionIndex: 0,
    participationFormat: '',
    teamSizeCategory: '',
    feeType: '',
    registrationOrganization: '',
    registrationWithin: '' as string,
    sortBy: '' as string,
    sortOrder: '' as string,
    draftParticipationFormat: '',
    draftTeamSizeCategory: '',
    draftFeeType: '',
    draftRegistrationOrganization: '',
    draftRegistrationWithin: '' as string,
    draftSortBy: '' as string,
    draftSortOrder: '' as string,
    morePanelVisible: false,
    moreFilterCount: 0,
    moreFilterLabel: '更多筛选',
    morePreviewCount: 0,
    selectedConditions: [] as Array<{ kind: string; label: string }>,
    items: [] as any[],
    total: 0,
    page: 1,
    hasMore: false,
    loading: true,
    error: '',
  },
  onLoad() { this.load(true); },
  onShow() {
    this.refreshFavoriteState();
    const ready = getApp<any>().globalData.userDataReady;
    if (ready) ready.then(()=>this.refreshFavoriteState()).catch(()=>undefined);
  },
  onPullDownRefresh() { this.load(true).finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (this.data.hasMore && !this.data.loading && !this.data.morePanelVisible) this.load(false); },
  onKeywordInput(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }); },
  onSearch() { this.load(true); },
  onStatusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ statusIndex: Number(event.detail.value) }, () => { this.updateSelectedConditions(); this.load(true); });
  },
  onLevelChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ levelIndex: Number(event.detail.value) }, () => { this.updateSelectedConditions(); this.load(true); });
  },
  onProfessionChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ professionIndex: Number(event.detail.value) }, () => { this.updateSelectedConditions(); this.load(true); });
  },
  updateSelectedConditions() {
    const selectedConditions: Array<{ kind: string; label: string }> = [];
    if (this.data.statusIndex) selectedConditions.push({ kind: 'status', label: statusOptions[this.data.statusIndex] });
    if (this.data.levelIndex) selectedConditions.push({ kind: 'level', label: levelOptions[this.data.levelIndex] });
    if (this.data.professionIndex) selectedConditions.push({ kind: 'profession', label: professionOptions[this.data.professionIndex] });
    if (this.data.participationFormat) selectedConditions.push({ kind: 'participationFormat', label: `参赛形式：${this.data.participationFormat}` });
    if (this.data.teamSizeCategory) selectedConditions.push({ kind: 'teamSizeCategory', label: `队伍人数：${this.data.teamSizeCategory}` });
    if (this.data.feeType) selectedConditions.push({ kind: 'feeType', label: `报名费用：${this.data.feeType}` });
    if (this.data.registrationOrganization) selectedConditions.push({ kind: 'registrationOrganization', label: `报名组织：${this.data.registrationOrganization}` });
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
      this.data.registrationWithin, this.data.sortBy, this.data.sortOrder,
    ].filter(Boolean).length;
    this.setData({ selectedConditions, moreFilterCount, moreFilterLabel: moreFilterCount ? `更多筛选·${moreFilterCount}` : '更多筛选' });
  },
  removeCondition(event: WechatMiniprogram.TouchEvent) {
    const kind = String(event.currentTarget.dataset.kind || '');
    if (kind === 'sort') {
      this.setData({ sortBy: '', sortOrder: '' }, () => { this.updateSelectedConditions(); this.load(true); });
      return;
    }
    const field: Record<string, string> = {
      status: 'statusIndex', level: 'levelIndex', profession: 'professionIndex',
      participationFormat: 'participationFormat', teamSizeCategory: 'teamSizeCategory',
      feeType: 'feeType', registrationOrganization: 'registrationOrganization',
      registrationWithin: 'registrationWithin',
    };
    if (!(kind in field)) return;
    this.setData({ [field[kind]]: kind === 'status' || kind === 'level' || kind === 'profession' ? 0 : '' }, () => {
      this.updateSelectedConditions();
      this.load(true);
    });
  },
  clearFilters() {
    this.setData({
      keyword: '', statusIndex: 0, levelIndex: 0, professionIndex: 0,
      participationFormat: '', teamSizeCategory: '', feeType: '', registrationOrganization: '',
      registrationWithin: '', sortBy: '', sortOrder: '',
      draftParticipationFormat: '', draftTeamSizeCategory: '', draftFeeType: '', draftRegistrationOrganization: '',
      draftRegistrationWithin: '', draftSortBy: '', draftSortOrder: '',
      morePanelVisible: false, selectedConditions: [], moreFilterCount: 0, moreFilterLabel: '更多筛选',
    });
    this.load(true);
  },
  openMoreFilters() {
    this.setData({
      draftParticipationFormat: this.data.participationFormat,
      draftTeamSizeCategory: this.data.teamSizeCategory,
      draftFeeType: this.data.feeType,
      draftRegistrationOrganization: this.data.registrationOrganization,
      draftRegistrationWithin: this.data.registrationWithin,
      draftSortBy: this.data.sortBy,
      draftSortOrder: this.data.sortOrder,
      morePanelVisible: true,
    }, () => this.refreshMorePreview());
  },
  closeMoreFilters() { this.setData({ morePanelVisible: false }); },
  blockPanelTap() {},
  selectMoreOption(event: WechatMiniprogram.TouchEvent) {
    const kind = String(event.currentTarget.dataset.kind || '');
    const value = String(event.currentTarget.dataset.value || '');
    const field = moreFieldMap[kind];
    if (!field) return;
    const current = String((this.data as any)[field] || '');
    this.setData({ [field]: current === value ? '' : value }, () => this.refreshMorePreview());
  },
  resetMoreFilters() {
    this.setData({
      draftParticipationFormat: '', draftTeamSizeCategory: '', draftFeeType: '', draftRegistrationOrganization: '',
      draftRegistrationWithin: '', draftSortBy: '', draftSortOrder: '',
    }, () => this.refreshMorePreview());
  },
  applyMoreFilters() {
    this.setData({
      participationFormat: this.data.draftParticipationFormat,
      teamSizeCategory: this.data.draftTeamSizeCategory,
      feeType: this.data.draftFeeType,
      registrationOrganization: this.data.draftRegistrationOrganization,
      registrationWithin: this.data.draftRegistrationWithin,
      sortBy: this.data.draftSortBy,
      sortOrder: this.data.draftSortOrder,
      morePanelVisible: false,
    }, () => { this.updateSelectedConditions(); this.load(true); });
  },
  async refreshMorePreview() {
    try {
      const result = await listCompetitions({
        keyword: this.data.keyword,
        registrationStatus: this.data.statusIndex ? statusOptions[this.data.statusIndex] : '',
        eventLevel: this.data.levelIndex ? levelOptions[this.data.levelIndex] : '',
        profession: this.data.professionIndex ? professionOptions[this.data.professionIndex] : '',
        participationFormat: this.data.draftParticipationFormat,
        teamSizeCategory: this.data.draftTeamSizeCategory,
        feeType: this.data.draftFeeType,
        registrationOrganization: this.data.draftRegistrationOrganization,
        registrationWithin: this.data.draftRegistrationWithin as any,
        sortBy: this.data.draftSortBy as any,
        sortOrder: this.data.draftSortOrder as any,
        page: 1,
        pageSize: 1000,
      });
      if (this.data.morePanelVisible) this.setData({ morePreviewCount: result.total });
    } catch (_error) {
      if (this.data.morePanelVisible) this.setData({ morePreviewCount: 0 });
    }
  },
  retry() { this.load(true); },
  openDetail(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` }); },
  toggleFavorite(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '');
    if (!id) return;
    const favorited = toggleFavorite(id);
    this.refreshFavoriteState();
    wx.showToast({ title: favorited ? '已收藏' : '已取消收藏', icon: favorited ? 'success' : 'none' });
  },
  refreshFavoriteState() {
    const favoriteIds = new Set(getFavoriteIds());
    this.setData({ items: this.data.items.map((item: any) => ({ ...item, isFavorite: favoriteIds.has(item.id) })) });
  },
  async load(reset: boolean) {
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: '' });
    try {
      const result = await listCompetitions({
        keyword: this.data.keyword,
        registrationStatus: this.data.statusIndex ? statusOptions[this.data.statusIndex] : '',
        eventLevel: this.data.levelIndex ? levelOptions[this.data.levelIndex] : '',
        profession: this.data.professionIndex ? professionOptions[this.data.professionIndex] : '',
        participationFormat: this.data.participationFormat,
        teamSizeCategory: this.data.teamSizeCategory,
        feeType: this.data.feeType,
        registrationOrganization: this.data.registrationOrganization,
        registrationWithin: this.data.registrationWithin as any,
        sortBy: this.data.sortBy as any,
        sortOrder: this.data.sortOrder as any,
        page,
        pageSize: 8,
      });
      const favoriteIds = new Set(getFavoriteIds());
      const resultItems = result.items.map((item: any) => ({ ...item, isFavorite: favoriteIds.has(item.id) }));
      this.setData({
        items: resultItems,
        total: result.total,
        hasMore: result.hasMore,
        page,
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false, error: error instanceof Error ? error.message : '加载失败，请重试' });
    }
  },
});
