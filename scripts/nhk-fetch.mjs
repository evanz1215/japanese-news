// NHK 抓取工具（雲端排程用）。用法：
//   node scripts/nhk-fetch.mjs list <NHK 分類頁網址>    → 印出分類頁文字（新聞列表）
//   node scripts/nhk-fetch.mjs article <NHK 新聞網址>   → 印出新聞全文
// 只會按「海外からのアクセスについて」的「確認して進む」（使用者已授權）。
// 若出現受信契約申報（用途／地域）等其他視窗，印出內容並以 exit 3 結束，不代為申報。
// shortcut: やさしいことばニュース的 news-list.json 需要登入 token，沒做；例句改用 WebSearch + curl 單篇文章。
import { chromium } from 'playwright';

const [mode, url] = process.argv.slice(2);
if (!['list', 'article'].includes(mode) || !url) { console.error('usage: nhk-fetch.mjs list|article <url>'); process.exit(2); }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const browser = await chromium.launch(process.env.NHK_CHANNEL ? { channel: process.env.NHK_CHANNEL } : {});
const page = await browser.newPage({ userAgent: UA, locale: 'ja-JP', viewport: { width: 1280, height: 1000 } });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
const modal = page.locator('#erpc-half-modal');
if (await modal.waitFor({ timeout: 15000 }).then(() => true, () => false)) {
  // 視窗先畫國內版，GeoIP 回來後才換成海外版，所以等它換掉
  const overseas = await modal.getByText('海外からのアクセス').waitFor({ timeout: 20000 }).then(() => true, () => false);
  if (!overseas) {
    console.error('UNEXPECTED_CONSENT_DIALOG\n' + await modal.innerText());
    await browser.close();
    process.exit(3);
  }
  await modal.getByRole('button', { name: /確認して進む/ }).click();
  await modal.waitFor({ state: 'hidden', timeout: 15000 });
}
await page.waitForTimeout(2000);
console.log(await page.locator('main').innerText());
await browser.close();
