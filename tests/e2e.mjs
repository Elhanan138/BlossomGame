// End-to-end: real server + Chromium. Host (desktop), projector, 3 phones play a full game through the UI.
// Usage: npm run build && npm run e2e   (screenshots → test-results/)
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright'); // pre-installed globally or: npm i -D playwright
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 3999, BASE = `http://localhost:${PORT}`, OUT = 'test-results';
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
const errors = [];
const fail = (m) => { throw new Error(m); };
const check = async (page, label) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (o > 0) fail(`${label}: horizontal overflow ${o}px`);
};
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });

try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  const browser = await chromium.launch();
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${who}: ${m.text()}`));
    return page;
  };
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const host = watch(await desk.newPage(), 'host');
  await host.goto(BASE);
  await check(host, 'landing desktop');
  await shot(host, '01-landing-desktop');
  await host.getByRole('button', { name: 'פתיחת משחק חדש' }).click();
  await host.waitForURL(/\/host\/[A-Z0-9]{6}$/);
  const code = host.url().split('/').pop();
  const screen = watch(await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(), 'screen');
  await screen.goto(`${BASE}/screen/${code}`);

  const names = ['נועה', 'Dan Levi', 'אבי 🎨'];
  const widths = [320, 375, 430];
  const phones = [];
  for (let i = 0; i < names.length; i++) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: widths[i], height: 700 }, deviceScaleFactor: 1 });
    const p = watch(await ctx.newPage(), names[i]);
    await p.goto(`${BASE}/j/${code}`);
    await check(p, `join ${widths[i]}`);
    await p.getByLabel('איך לקרוא לך?').fill(names[i]);
    await p.getByRole('button', { name: 'יאללה, מצטרפים!' }).click();
    await p.getByText('מעולה, נכנסת!').waitFor();
    phones.push(p);
  }
  await shot(phones[0], '02-phone-lobby-320');
  await host.getByRole('button', { name: /מתחילים!/ }).waitFor();
  await shot(host, '03-host-lobby');
  await shot(screen, '04-screen-lobby');
  await host.getByRole('button', { name: /מתחילים!/ }).click();

  // Draw: brush stroke, fill, circle, then submit.
  for (const [i, p] of phones.entries()) {
    const c = p.locator('canvas');
    await c.waitFor();
    const b = await c.boundingBox();
    await p.mouse.move(b.x + 20, b.y + 20); await p.mouse.down();
    for (let k = 1; k <= 10; k++) await p.mouse.move(b.x + 20 + k * 15, b.y + 20 + k * 12);
    await p.mouse.up();
    await p.getByRole('button', { name: 'עיגול' }).click();
    await p.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5); await p.mouse.down(); await p.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.8, { steps: 5 }); await p.mouse.up();
    await p.getByRole('button', { name: 'דלי מילוי' }).click();
    await p.getByRole('button', { name: 'כתום' }).click();
    await c.click({ position: { x: b.width * 0.65, y: b.height * 0.65 } });
    await p.getByRole('button', { name: 'ביטול פעולה' }).click();
    await p.getByRole('button', { name: 'ביצוע מחדש' }).click();
    await check(p, `drawing ${widths[i]}`);
    if (i === 0) { await shot(p, '05-phone-drawing-320'); await p.reload(); await p.locator('canvas').waitFor(); }
  }
  await shot(screen, '06-screen-drawing');
  for (const p of phones) await p.getByRole('button', { name: 'סיימתי לצייר' }).click();

  for (let d = 0; d < 3; d++) {
    await screen.getByText('מה לעזאזל ניסו לצייר כאן?').waitFor();
    for (const [i, p] of phones.entries()) {
      const input = p.getByPlaceholder('למשל: חתול בראיון עבודה');
      if (await input.isVisible().catch(() => false) || await input.waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) {
        await input.fill(`תשובה מצחיקה ${i} ${d} 🙂`);
        if (d === 0 && i === phones.length - 1) await shot(p, '07-phone-answer-430');
        await p.getByRole('button', { name: 'שליחה' }).click();
      }
    }
    if (d === 0) await shot(screen, '08-screen-answering');
    await screen.getByText('אחת נכונה. השאר מנסות לעבוד עליכם.').waitFor();
    if (d === 0) await shot(screen, '09-screen-voting');
    for (const [i, p] of phones.entries()) {
      const opts = p.locator('.option:not([disabled])');
      if (await opts.first().waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) {
        await opts.first().click();
        if (d === 0 && i === 1) await shot(p, '10-phone-vote-375');
        await p.getByRole('button', { name: 'נעילת הצבעה' }).click();
      }
    }
    await screen.getByText('והתשובה האמיתית היא…').waitFor();
    if (d === 0) { await shot(screen, '11-screen-reveal'); await shot(phones[0], '12-phone-reveal'); await shot(host, '13-host-ingame'); }
    await host.getByRole('button', { name: '⏭ לשלב הבא' }).click();
  }
  await screen.getByText(/טבלת המובילים/).waitFor();
  await shot(screen, '14-screen-results');
  await host.getByRole('button', { name: '⏭ לשלב הבא' }).click();
  await screen.getByText('והמנצחים הם… 🎉').waitFor();
  await new Promise((r) => setTimeout(r, 1200));
  await shot(screen, '15-screen-final');
  await shot(phones[1], '16-phone-final');
  await host.getByRole('button', { name: 'משחק חדש עם אותה חבורה' }).click();
  await screen.getByText('סורקים ומצטרפים!').waitFor();
  for (const w of [1024, 1280]) { await host.setViewportSize({ width: w, height: 800 }); await check(host, `host ${w}`); }
  await browser.close();
  if (errors.length) fail('Console errors:\n' + errors.join('\n'));
  console.log('E2E PASSED');
} catch (e) {
  console.error('E2E FAILED:', e.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  server.kill();
}
