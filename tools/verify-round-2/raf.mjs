// Verifier round 2: how fast does a bare headless Chrome run requestAnimationFrame on this machine right now? (explains the 30 fps e2e failures)
import { launchChrome } from '../../test-support/e2e/chrome-launcher.js';
import { Page } from '../../test-support/e2e/cdp.js';
for (const extra of [[], ['--disable-frame-rate-limit', '--disable-gpu-vsync']]) {
  const b = await launchChrome({ extraArgs: extra });
  const page = await Page.create(b.conn);
  await page.goto('about:blank');
  const r = await page.evaluate(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res({ fps: n / ((performance.now() - t0) / 1000), vis: document.visibilityState }); }; requestAnimationFrame(f); })`);
  console.log(`bare about:blank, extra ${JSON.stringify(extra)}: ${JSON.stringify(r)}  (${b.version})`);
  await b.close();
}
