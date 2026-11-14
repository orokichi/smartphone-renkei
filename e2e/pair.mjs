// End-to-end: PC tab + phone tab pair over PeerJS, then file + clipboard + RPC.
import { chromium } from 'playwright';
const URL = process.env.URL || 'https://smartphone-renkei.vercel.app';
const b = await chromium.launch();
const pcCtx = await b.newContext({ permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
const pc = await pcCtx.newPage();
pc.on('console', (m) => console.log('PC:', m.text()));
pc.on('pageerror', (e) => console.log('PC ERR:', e.message));
await pc.goto(URL);
await pc.waitForFunction(() => /^[A-Z0-9]{6}-\d{4}$/.test(document.querySelector('.code')?.textContent || ''), null, { timeout: 30000 });
const code = await pc.textContent('.code');
console.log('code', code);
const ph = await (await b.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36', viewport: { width: 412, height: 900 }, isMobile: true })).newPage();
ph.on('console', (m) => console.log('PH:', m.text()));
ph.on('pageerror', (e) => console.log('PH ERR:', e.message));
const [id, pin] = code.split('-');
await ph.goto(`${URL}/?pair=${id.toLowerCase()}.${pin}`);
await pc.waitForSelector('text=と接続中', { timeout: 45000 });
console.log('OK paired');
await ph.waitForSelector('text=と接続中', { timeout: 15000 });
console.log('OK phone shows connected');
await pc.screenshot({ path: 'e2e/pc-home.png' });
await ph.screenshot({ path: 'e2e/ph-home.png' });

// file PC -> phone (phone browser = download)
await pc.click('.rail-item:has-text("ファイル")');
const [fc] = await Promise.all([pc.waitForEvent('filechooser'), pc.click('.drop')]);
const dl = ph.waitForEvent('download', { timeout: 30000 });
await fc.setFiles({ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('あいうえお'.repeat(60000)) });
const d = await dl;
console.log('OK phone received file', d.suggestedFilename());

// clipboard PC -> phone via clipboard page
await pc.click('.rail-item:has-text("クリップ")');
await pc.fill('textarea', 'テスト クリップ 123');
await pc.click('button:has-text("送信")');
await ph.waitForSelector('text=テスト クリップ 123', { timeout: 10000 });
console.log('OK clip delivered');

// reload phone -> auto reconnect with token
await ph.reload();
try {
  await ph.waitForSelector('text=と接続中', { timeout: 30000 });
} catch (e) {
  console.log('PH BODY:', (await ph.textContent('body')).slice(0, 400));
  console.log('PC BODY:', (await pc.textContent('body')).slice(0, 400));
  throw e;
}
console.log('OK reconnect with saved token');
await pc.screenshot({ path: 'e2e/pc-clip.png' });
await b.close();
console.log('ALL PASSED');
