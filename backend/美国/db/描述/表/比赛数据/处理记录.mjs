// 处理记录：AI 和系统对某一届做过什么。旧记录里直接挂在每届身上，约占旧总表一半，
// 新结构里单独一张表，一次处理一行，届次本身保持干净。放不放进主库文件还没定（建议单独一个库文件）。
export default {
  表名: 'process_log',
  说明: 'AI 和系统的处理记录',
  主键: 'id',
  字段: {
    id: { 说明: '记录编号', 必填: true, 类型: '编号' },
    edition_id: { 说明: '处理的是哪一届', 必填: true, 类型: '编号', 指向: 'edition' },
    kind: {
      说明: '做的是什么', 必填: true, 类型: '文字',
      // 每一种对应旧记录上的一个字段
      可选值: ['ai_review', 'ai_review_failure', 'ai_resolution', 'ai_resolution_failure', 'field_verification', 'field_verification_failure',
        'field_verification_resolution', 'ai_field_verification', 'ai_profession_classification'],
      旧: 'aiReview / aiReviewFailure / aiResolution / aiResolutionFailure / fieldVerification / fieldVerificationFailure / fieldVerificationResolution / aiFieldVerification / aiProfessionClassification',
    },
    at: { 说明: '处理时间', 必填: true, 类型: '时间' },
    run_id: { 说明: '哪一晚的流程（手动处理留空）', 必填: false, 类型: '文字', 最长: 40 },
    detail: { 说明: '处理结果原样存（模型、提示词版本、结论、证据……）', 必填: true, 类型: '对象' },
  },
  索引: [['edition_id', 'at'], ['kind']],
};
