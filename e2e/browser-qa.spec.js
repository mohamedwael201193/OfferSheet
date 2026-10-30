import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const pages = [
  { path: '/index.html', name: 'index' },
  { path: '/app.html', name: 'app' },
];

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function isExpectedBackendFailure(text, url) {
  const hay = `${text || ''} ${url || ''}`;
  return /\/api\//.test(hay);
}

for (const entry of pages) {
  test(`${entry.name} loads clean, does not overflow, and has no serious or critical WCAG 2.1 AA violations`, async ({ page }, testInfo) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      const url = msg.location()?.url || '';
      if (isExpectedBackendFailure(text, url)) return;
      consoleErrors.push(url ? `${text} (${url})` : text);
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });

    await page.goto(entry.path, { waitUntil: 'load' });
    // Landing preloader is removed shortly after load. App has no preloader.
    await page.locator('.preloader').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    if (entry.name === 'app') {
      await expect(page.locator('#qlooBadge')).toHaveText(/Backend unreachable|Qloo not configured/);
      await expect(page.locator('#benchBlock')).toContainText(/unavailable|No benchmark runs recorded yet|not configured|empty/i);
    } else {
      await expect(page.locator('main')).toBeVisible();
    }

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    testInfo.attach('overflow', {
      body: JSON.stringify({ page: entry.path, viewport: testInfo.project.name, ...overflow }, null, 2),
      contentType: 'application/json',
    });
    // Printed so local runs record the measured numbers in the log.
    console.log(`OVERFLOW ${entry.name} ${testInfo.project.name} scrollWidth=${overflow.scrollWidth} innerWidth=${overflow.innerWidth}`);
    expect(overflow.scrollWidth, `${entry.name} ${testInfo.project.name} horizontal overflow`).toBeLessThanOrEqual(overflow.innerWidth);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    const violations = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const summary = violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 8).map((n) => ({
        target: n.target,
        html: n.html,
        failureSummary: n.failureSummary,
      })),
    }));
    testInfo.attach('axe-serious-critical', {
      body: JSON.stringify({ page: entry.path, viewport: testInfo.project.name, violations: summary }, null, 2),
      contentType: 'application/json',
    });
    console.log(`AXE ${entry.name} ${testInfo.project.name} serious/critical=${violations.length}`);
    if (summary.length) console.log(JSON.stringify(summary, null, 2));
    expect(violations, `${entry.name} ${testInfo.project.name} serious/critical axe violations`).toEqual([]);
    expect(consoleErrors, `${entry.name} ${testInfo.project.name} console errors`).toEqual([]);
  });
}
