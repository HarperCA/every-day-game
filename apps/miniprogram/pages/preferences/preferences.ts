import { getProfessionOptions } from '../../services/repository';
import { loadCompetitionPreferences, saveCompetitionPreferences, saveSurveyStatus, surveyProvinceOptions, uploadCompetitionPreferences } from '../../services/competitionPreferences';

const professions = getProfessionOptions();
Page({
  data: {
    step:0,
    categories:[] as string[],
    categoryIndex:[0],
    categoryWheelChanged:false,
    categoryOptions:[{label:'不限', value:'', selected:true}, ...professions.map(label => ({label,value:label,selected:false}))],
    provinceOptions:surveyProvinceOptions,
    provinceIndex:[0],
    dontShowAgain:false,
    saving:false,
  },
  onLoad() {
    const saved = loadCompetitionPreferences();
    this.setData({
      categories:saved.categories, categoryIndex:[saved.categories.length ? Math.max(0, professions.indexOf(saved.categories[0]) + 1) : 0], categoryWheelChanged:false, categoryOptions:[{label:'不限',value:'',selected:!saved.categories.length}, ...professions.map(label => ({label,value:label,selected:saved.categories.includes(label)}))],
      provinceIndex:[Math.max(0, surveyProvinceOptions.indexOf(saved.province))], dontShowAgain:saved.dontShowAgain});
  },
  onCategoryChange(event:any) { this.setData({categoryIndex:[Number(event.detail.value[0])], categoryWheelChanged:true}); },
  selectCategory(event:WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '');
    const current = this.data.categories;
    const categories = !value ? [] : current.includes(value) ? current.filter(item => item !== value) : [...current,value];
    this.setData({categories, categoryWheelChanged:false, categoryOptions:[{label:'不限',value:'',selected:!categories.length}, ...professions.map(label => ({label,value:label,selected:categories.includes(label)}))]});
  },
  onProvinceChange(event:any) { this.setData({provinceIndex:[Number(event.detail.value[0])]}); },
  onDontShowAgainChange(event:any) { this.setData({dontShowAgain:event.detail.value.includes('hide')}); },
  previousStep() { this.setData({step:Math.max(0,this.data.step - 1)}); },
  confirmStep() {
    if (this.data.saving) return;
    if (this.data.step < 1) { this.setData({step:this.data.step + 1}); return; }
    this.save();
  },
  cancel() { wx.navigateBack(); },
  save() {
    if (this.data.categoryWheelChanged) {
      const value = this.data.categoryOptions[this.data.categoryIndex[0]]?.value || '';
      this.setData({categories:value ? [...new Set([...this.data.categories, value])] : [], categoryWheelChanged:false});
    }
    this.setData({saving:true});
    try {
      saveCompetitionPreferences({profession:'', categories:this.data.categories,
        province:this.data.provinceIndex[0] ? surveyProvinceOptions[this.data.provinceIndex[0]] : '', dontShowAgain:this.data.dontShowAgain});
      saveSurveyStatus('completed');
      uploadCompetitionPreferences('completed').catch(()=>{});
      wx.showToast({title:'偏好已保存',icon:'success'});
      wx.navigateBack();
    } catch (_error) {
      this.setData({saving:false});
      wx.showToast({title:'保存失败，请重试',icon:'none'});
    }
  },
});
