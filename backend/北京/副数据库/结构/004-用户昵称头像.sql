-- 由 结构/生成.mjs 按 描述/ 生成，不要手改。上线后改表一律新增编号文件。

-- 小程序账号：加 nickname、avatar_url
ALTER TABLE user_account ADD COLUMN nickname TEXT;
ALTER TABLE user_account ADD COLUMN avatar_url TEXT;
