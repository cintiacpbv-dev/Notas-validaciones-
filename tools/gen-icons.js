// Genera los iconos PNG (web y Android) a partir de web/icons/schnauzer.svg.
// Uso: node tools/gen-icons.js   (requiere el paquete "playwright" y Chromium)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'web/icons/schnauzer.svg'), 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const dog = inner.replace(/<rect[^>]*\/>/, '').replace(/<circle cx="256" cy="256" r="200"[^>]*\/>/, '');
const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`;
const scaled = (s, body) => `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">${body}</g>`;

const variants = {
  full: wrap(inner),
  round: wrap(`<circle cx="256" cy="256" r="256" fill="#FFD6E4"/>` + scaled(1.05, `<circle cx="256" cy="256" r="200" fill="#FFE9F1"/>` + dog)),
  foreground: wrap(scaled(0.85, `<circle cx="256" cy="256" r="200" fill="#FFE9F1"/>` + dog)),
  maskable: wrap(`<rect width="512" height="512" fill="#FFD6E4"/>` + scaled(0.8, `<circle cx="256" cy="256" r="200" fill="#FFE9F1"/>` + dog)),
};

const res = path.join(root, 'android/app/src/main/res');
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const jobs = [
  ['full', 192, 'web/icons/icon-192.png'],
  ['full', 512, 'web/icons/icon-512.png'],
  ['maskable', 512, 'web/icons/icon-maskable-512.png'],
  ['full', 512, 'android/icon-512-playstore.png'],
];
for (const [d, f] of Object.entries(densities)) {
  jobs.push(['full', 48 * f, `${res}/mipmap-${d}/ic_launcher.png`]);
  jobs.push(['round', 48 * f, `${res}/mipmap-${d}/ic_launcher_round.png`]);
  jobs.push(['foreground', 108 * f, `${res}/mipmap-${d}/ic_launcher_foreground.png`]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const page = await browser.newPage();
  for (const [v, size, out] of jobs) {
    const file = path.isAbsolute(out) ? out : path.join(root, out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${variants[v].replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: file, omitBackground: true });
  }
  await browser.close();
  console.log('Iconos generados:', jobs.length);
})();
