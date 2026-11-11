-- 2026-11-03：每日归档（维护/归档/）归档时算出“下一届大概什么时候报名”存进届次，同步到北京给小程序显示。
-- 原来只有旧记录带过来的放在 legacy.nextEditionEstimate，新归档的没地方放。
ALTER TABLE edition ADD COLUMN next_edition_estimate TEXT;
