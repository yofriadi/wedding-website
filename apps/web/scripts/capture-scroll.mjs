import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const OUT_DIR = path.join(process.cwd(), ".opencode", "screenshots");

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

async function snap(page, name) {
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function wheelAndSnap({ page, prefix, steps, deltaY }) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(350);
    out.push(await snap(page, `${prefix}-${String(i + 1).padStart(2, "0")}.png`));
  }
  return out;
}

async function captureLinearity(page) {
  await page.goto("https://www.linearity.io/about-us/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // Anchor: scroll to the section that contains the heading.
  const heading = page.getByRole("heading", { name: /It all started in 2017/i });
  await heading.waitFor({ timeout: 30_000 });
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  const files = [];
  files.push(await snap(page, "linearity-00-heading.png"));
  files.push(...(await wheelAndSnap({ page, prefix: "linearity", steps: 6, deltaY: 700 })));
  return files;
}

async function captureLocal(page) {
  await page.goto("http://localhost:4321/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // Anchor: our new section has id=timeline-section.
  await page.locator("#timeline-section").waitFor({ timeout: 30_000 });
  await page.locator("#timeline-section").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  const files = [];
  files.push(await snap(page, "local-00-section.png"));
  files.push(...(await wheelAndSnap({ page, prefix: "local", steps: 6, deltaY: 700 })));
  return files;
}

async function main() {
  await ensureDir(OUT_DIR);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const linearity = await captureLinearity(page);
  const local = await captureLocal(page);

  await browser.close();

  const manifest = {
    outDir: OUT_DIR,
    linearity,
    local,
  };
  await writeFile(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
