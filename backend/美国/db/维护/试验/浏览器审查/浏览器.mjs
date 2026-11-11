// 无头浏览器读网页（试验）：只读，不点击、不填表。交回和 web/读网页 一样的形状；打不开、PDF、下载类的交回 null，由调用方换回现有的读网页程序。
//   建浏览器({ chromium, 安全检查, 查robots, 超时毫秒 }) → { 读(网址) → 结果或 null, 关() }
// 安全：页面发出的每个请求都查内网地址；robots.txt 不让抓的不读；图片、字体、音视频不加载；遇到验证码不处理，读到什么算什么。
const 不加载 = new Set(['image', 'media', 'font']);
const 正文最少字 = 200;
const 全文上限 = 200000;

export async function 建浏览器({ chromium, 安全检查, 查robots, 超时毫秒 = 20000 }) {
  const browser = await chromium.launch({ headless: true });
  return {
    async 读(网址) {
      const 不安全 = await 安全检查(网址);
      if (不安全) return { url: 网址, finalUrl: 网址, status: '网址不安全', httpStatus: null, title: '', text: '', links: [], error: 不安全, 线路: '浏览器' };
      if (!(await 查robots(网址))) return { url: 网址, finalUrl: 网址, status: 'robots不允许', httpStatus: null, title: '', text: '', links: [], error: '网站的 robots.txt 不允许抓取', 线路: '浏览器' };
      const 环境 = await browser.newContext({ locale: 'zh-CN', acceptDownloads: false, serviceWorkers: 'block' });
      try {
        const page = await 环境.newPage();
        await page.route('**/*', async route => {
          const req = route.request();
          if (不加载.has(req.resourceType())) return route.abort();
          if (await 安全检查(req.url())) return route.abort();
          return route.continue();
        });
        const 回应 = await page.goto(网址, { waitUntil: 'domcontentloaded', timeout: 超时毫秒 });
        if (!回应 || 回应.status() >= 400) return null;
        if (!/html|xml|text\/plain/i.test(回应.headers()['content-type'] || '')) return null;
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        const 块们 = [];
        for (const frame of page.frames()) {
          const 文字 = await frame.evaluate(() => document.body?.innerText || '').catch(() => '');
          if (文字.trim()) 块们.push(文字.trim());
        }
        const text = 块们.join('\n').slice(0, 全文上限);
        const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => ({ url: a.href, text: (a.innerText || a.title || '').trim().slice(0, 80) })).filter(l => /^https?:/i.test(l.url)).slice(0, 500)).catch(() => []);
        return { url: 网址, finalUrl: page.url(), status: text.length >= 正文最少字 ? '成功' : '正文太短', httpStatus: 回应.status(), title: await page.title().catch(() => ''), text, links, error: '', 线路: '浏览器' };
      } catch {
        return null;
      } finally {
        await 环境.close().catch(() => {});
      }
    },
    关: () => browser.close(),
  };
}

// 先用浏览器；浏览器读不到或正文太短，换现有的读网页（PDF、Word、北京线路都在里面）。两边都短的取长的。
export function 合起来读(浏览器读, 直读) {
  return async 网址 => {
    const 甲 = await 浏览器读(网址);
    if (甲?.status === '成功' || ['网址不安全', 'robots不允许'].includes(甲?.status)) return 甲;
    const 乙 = await 直读(网址);
    const 乙带线路 = { ...乙, 线路: 乙.线路 || '直读' };
    if (乙.status === '成功' || !甲) return 乙带线路;
    return String(乙.text || '').length > String(甲.text || '').length ? 乙带线路 : 甲;
  };
}
