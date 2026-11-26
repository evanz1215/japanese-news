// NHK 抓取工具（雲端排程用）。用法：
//   node scripts/nhk-fetch.mjs list <NHK 分類頁網址>    → 印出分類頁文字（新聞列表）
//   node scripts/nhk-fetch.mjs article <NHK 新聞網址>   → 印出新聞全文
// 只會按「海外からのアクセスについて」的「確認して進む」（使用者已授權）。
// 若出現受信契約申報（用途／地域）等其他視窗，印出內容並以 exit 3 結束，不代為申報。
// shortcut: やさしいことばニュース的 news-list.json 需要登入 token，沒做；例句改用 WebSearch + curl 單篇文章。
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';

const [mode, url] = process.argv.slice(2);
if (!['list', 'article'].includes(mode) || !url) { console.error('usage: nhk-fetch.mjs list|article <url>'); process.exit(2); }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// 雲端：Chromium 不會自己讀 HTTPS_PROXY，要明確給；雲端 proxy 會重簽 TLS，所以忽略憑證錯誤。
// shortcut: 只在有 HTTPS_PROXY（雲端沙箱）時才忽略憑證，本機不受影響。
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const launchOpts = {};
if (process.env.NHK_CHANNEL) launchOpts.channel = process.env.NHK_CHANNEL;
if (proxy) launchOpts.proxy = { server: proxy };
// 雲端預裝的瀏覽器版本可能和套件要的不同：用 CHROMIUM_PATH 指定，或自動找 /opt/pw-browsers 裡的
launchOpts.executablePath = process.env.CHROMIUM_PATH || findPreinstalled();
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ userAgent: UA, locale: 'ja-JP', viewport: { width: 1280, height: 1000 }, ignoreHTTPSErrors: !!proxy });
// 不載入圖片、影片、字型、CSS：讀文字用不到；雲端 proxy 下 CSS 會卡住，讓頁面永遠載不完
await page.route('**/*', r => ['image', 'media', 'font', 'stylesheet'].includes(r.request().resourceType()) ? r.abort() : r.continue());

function findPreinstalled() {
  try {
    if (existsSync(chromium.executablePath())) return undefined; // 套件自己的瀏覽器在就用它
  } catch {}
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter(d => d.startsWith('chromium-')).sort().reverse()) {
    for (const sub of ['chrome-linux64', 'chrome-linux']) {
      const p = `${root}/${d}/${sub}/chrome`;
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
await page.locator('main').first().waitFor({ state: 'attached', timeout: 60000 });
// 同意視窗的 id 因頁面而異（新聞頁／やさしいことば頁），所以用按鈕文字找。
// 視窗先畫國內版，GeoIP 回來後才換成海外版，所以最多等 20 秒看海外版按鈕出現。
const overseasBtn = page.getByRole('button', { name: /確認して進む/ });
const domestic = page.getByText('内容について確認しました');
let sawDomestic = false;
for (let i = 0; i < 20; i++) {
  if (await overseasBtn.count()) break;
  if (await domestic.count()) sawDomestic = true;
  await page.waitForTimeout(1000);
}
if (await overseasBtn.count()) {
  await overseasBtn.first().click();
  await overseasBtn.first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
} else if (sawDomestic) {
  console.error('UNEXPECTED_CONSENT_DIALOG\n' + await page.locator('dialog[open]').allInnerTexts().then(t => t.join('\n')));
  await browser.close();
  process.exit(3);
}
await page.waitForTimeout(2000);
if (mode === 'list') {
  // 列表模式同時印出標題與網址，方便挑新聞
  const links = await page.locator('main a[href*="/newsweb/na/"]').evaluateAll(as =>
    // 影片新聞第一行是「1分24秒」這類長度，取最長的一行當標題
    [...new Map(as.map(a => [a.href, a.innerText.split('\n').map(s => s.trim()).sort((x, y) => y.length - x.length)[0]])).entries()]);
  console.log(links.map(([href, title]) => `${title}\t${href}`).join('\n'));
} else {
  // やさしいことば頁的漢字帶 <rt> 讀音，拿掉才能逐字比對原句
  await page.evaluate(() => document.querySelectorAll('main rt').forEach(e => e.remove()));
  console.log(await page.locator('main').innerText());
}
await browser.close();
