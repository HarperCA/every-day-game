const PROMPT_VERSION = 'competition-review-kimi-v1';

const resultSchema = {
  type:'object', additionalProperties:false,
  required:['decision','risk_level','summary','issues','evidence_refs'],
  properties:{
    decision:{ enum:['recommend_approve','needs_changes','insufficient_evidence'] },
    risk_level:{ enum:['low','medium','high'] },
    summary:{ type:'string', minLength:5, maxLength:2000 },
    issues:{ type:'array', maxItems:20, items:{
      type:'object', additionalProperties:false,
      required:['field','finding','recommendation','evidence_ref'],
      properties:{
        field:{ type:'string', minLength:1, maxLength:100 },
        finding:{ type:'string', minLength:2, maxLength:1000 },
        recommendation:{ type:'string', minLength:2, maxLength:1000 },
        evidence_ref:{ type:'string', maxLength:2048 },
      },
    } },
    evidence_refs:{ type:'array', maxItems:20, items:{ type:'string', maxLength:2048 } },
  },
};

function compactRecord(record) {
  return {
    id:record.id, name:record.name, edition_name:record.editionName,
    organizer:record.organizer, participants:record.participants, eligibility:record.eligibility,
    format_and_rules:record.formatAndRules, team_size:record.teamSize,
    participation_format:record.participationFormat, registration_method:record.registrationMethod,
    registration_organization:record.registrationOrganization, registration_url:record.registrationUrl,
    fees:record.fees, fee_type:record.feeType, schedule:record.schedule,
    quality_issues:record.qualityIssues || [],
    sources:(record.sources || []).map(source => ({ url:source.url, source_type:source.source_type, claimed_official:Boolean(source.is_official), current_validity:source.validity_status })),
  };
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/g, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ').trim().slice(0, 18000);
}

async function collectEvidence(record, request = fetch) {
  const uniqueUrls = [...new Set((record.sources || []).map(source => source.url).filter(url => /^https?:\/\//i.test(url)))].slice(0, 3);
  return Promise.all(uniqueUrls.map(async url => {
    try {
      const response = await request(url, { redirect:'follow', signal:AbortSignal.timeout(12000), headers:{ 'User-Agent':'competition-review/1.0' } });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) return { url, status:`http_${response.status}`, text:'' };
      if (/^image\/(jpeg|png|gif|webp)/i.test(contentType)) return { url, status:'image', imageUrl:url };
      return { url, status:'reachable', text:htmlToText(await response.text()) };
    } catch (error) {
      return { url, status:'unreachable', text:'', error:String(error?.message || error).slice(0,300) };
    }
  }));
}

function validateResult(value) {
  if (!value || typeof value !== 'object') throw new Error('ai_review_invalid_result');
  if (!['recommend_approve','needs_changes','insufficient_evidence'].includes(value.decision)) throw new Error('ai_review_invalid_decision');
  if (!['low','medium','high'].includes(value.risk_level)) throw new Error('ai_review_invalid_risk');
  if (typeof value.summary !== 'string' || value.summary.trim().length < 5) throw new Error('ai_review_invalid_summary');
  if (!Array.isArray(value.issues) || !Array.isArray(value.evidence_refs)) throw new Error('ai_review_invalid_evidence');
  return value;
}

async function runCompetitionAiReview(record, request = fetch) {
  const apiKey = String(process.env.AI_API_KEY || '').trim();
  if (!apiKey) throw new Error('ai_api_key_not_configured');
  const model = String(process.env.AI_MODEL || 'kimi-for-coding').trim();
  const baseUrl = String(process.env.AI_BASE_URL || 'https://api.kimi.com/coding/v1').replace(/\/$/, '');
  const evidence = await collectEvidence(record, request);
  const content = [{ type:'text', text:`审核以下赛事记录。只能依据提供的来源正文或图片作判断；证据不足必须选择 insufficient_evidence。核对届次、主办方、报名时间、资格、费用、赛制和报名入口。结果仅供人工复核。\n赛事记录：${JSON.stringify(compactRecord(record))}\n来源读取结果：${JSON.stringify(evidence.map(item => ({ ...item, imageUrl:undefined })))}` }];
  for (const item of evidence.filter(item => item.imageUrl)) content.push({ type:'image_url', image_url:{ url:item.imageUrl } });
  const response = await request(`${baseUrl}/chat/completions`, {
    method:'POST', headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      model, messages:[
        { role:'system', content:'你是严谨的大学生竞赛数据审核助手。不得将推测写成事实，不得代替管理员批准或发布。' },
        { role:'user', content },
      ],
      response_format:{ type:'json_schema', json_schema:{ name:'competition_ai_review', strict:true, schema:resultSchema } },
      temperature:0.1,
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`ai_provider_error:${response.status}:${payload?.error?.message || 'unknown'}`);
  const text = payload?.choices?.[0]?.message?.content;
  const result = validateResult(JSON.parse(text));
  return { ...result, provider:'kimi-code', model, prompt_version:PROMPT_VERSION, reviewed_at:new Date().toISOString(), response_id:payload.id || null };
}

module.exports = { collectEvidence, compactRecord, htmlToText, runCompetitionAiReview, validateResult };
