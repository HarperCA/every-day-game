// 首页筛选项。

export const statusOptions = ['全部报名状态', '报名中', '即将报名', '时间待公布', '已截止'];
export const levelOptions = ['全部赛事级别', '国际级', '国家级', '省级/区域级', '其他/未明确'];
export const participationFormatOptions = ['个人赛', '团队赛', '个人或团队均可', '暂未明确'];
export const teamSizeOptions = ['1人', '2～3人', '4～5人', '6人及以上', '人数范围不固定', '暂未明确'];
export const feeTypeOptions = ['免费', '收费', '不同赛项费用不同', '暂未公布'];
export const registrationOrganizationOptions = ['自行报名', '学校统一报名', '两种方式均可', '需先校内选拔', '以赛区或学校通知为准', '暂未明确'];
export const regionAllOption = '不限';
// 显示文案 → 传给接口的值。"不限"/"推荐排序" 对应空字符串，即不传这个筛选项。
export const registrationWithinOptions = ['不限', '半年以内', '3个月以内', '1个月以内'];
export const registrationWithinValues = ['', '6m', '3m', '1m'];
export const sortByOptions = ['推荐排序', '按报名时间'];
export const sortByValues = ['', 'time'];
export const sortOrderOptions = ['升序', '降序'];
export const sortOrderValues = ['asc', 'desc'];

// 专业大类。tests/miniprogram-shared.test.mjs 保证它和后端 AI 审核用的十三类一致。
export const PROFESSION_CATEGORIES = ['人文与法学', '外语与教育', '建筑与土木', '数学与统计', '机械与自动化', '材料与化工', '生物与医药', '电子信息', '经管与商科', '综合/不限专业', '能源与环境', '计算机与AI', '设计与艺术'].sort();
