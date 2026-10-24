// 海报链接（2026-10-24 用户定：云开发环境不升级套餐）：
// 免费体验期不能把云存储改成“所有人可读”，海报文件是私有的，云函数换出来的 https 链接只有 10 分钟有效（官方 getTempFileURL 文档）。
// 所以公开数据里只存云存储文件 ID（poster_file_id，同步时写入），返回列表时把这一页用到的文件 ID 一次性换成链接，填进 poster_url。
// 换好的链接按文件 ID 缓存 8 分钟（比 10 分钟早一点换新），同一实例里后来的请求直接用，不再调接口。
const LINK_TTL_MS = 8 * 60 * 1000;
const BATCH = 50; // getTempFileURL 一次最多 50 个
const FILE_ID = /^cloud:\/\/[^/]+\/posters\/[0-9a-f]{64}\.jpg$/;
const cache = new Map();

async function fillPosterLinks(items, cloud, now = Date.now()) {
  if (!cloud || typeof cloud.getTempFileURL !== 'function' || !Array.isArray(items)) return items;
  const ids = [...new Set(items.map(item => item?.poster_file_id).filter(id => typeof id === 'string' && FILE_ID.test(id)))];
  const missing = ids.filter(id => !(cache.get(id)?.expiresAt > now));
  for (let index = 0; index < missing.length; index += BATCH) {
    try {
      const { fileList } = await cloud.getTempFileURL({ fileList:missing.slice(index, index + BATCH) });
      for (const file of fileList || []) {
        if (file?.fileID && file.tempFileURL && (file.status === 0 || file.status === undefined)) cache.set(file.fileID, { url:file.tempFileURL, expiresAt:now + LINK_TTL_MS });
      }
    } catch (_error) {
      // 换链接失败不影响列表：这几张没有海报，小程序显示文字封面
    }
  }
  // 返回副本：列表条目来自缓存的公共列表，不能把链接写回缓存本身
  return items.map(item => {
    const hit = item && cache.get(item.poster_file_id);
    return item ? { ...item, poster_url:hit && hit.expiresAt > now ? hit.url : '' } : item;
  });
}

function clearPosterLinkCache() { cache.clear(); }

module.exports = { fillPosterLinks, clearPosterLinkCache, LINK_TTL_MS };
