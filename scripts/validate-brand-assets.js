const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function requireFile(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required brand file is missing: ${relativePath}`);
  }
  return absolutePath;
}

const requiredFiles = [
  'assets/brand/flipforge-mark.svg',
  'assets/brand/flipforge-app-icon-dark.svg',
  'assets/brand/flipforge-before-after-overlay.svg',
  'assets/css/brand-v2.css',
  'assets/images/flipforge-grading-scenario.svg',
  'assets/images/flipforge-traceback-guidance.svg',
  'site.webmanifest',
  'index.html',
  'product.html',
];

for (const file of requiredFiles) requireFile(file);

const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const homepageFailures = [];

if (!index.includes('assets/images/flipforge-homepage-dashboard.svg')) {
  homepageFailures.push('primary homepage product visual');
}
if (!index.includes('id="try-flipforge"')) {
  homepageFailures.push('guided FlipForge demo');
}
if (!index.includes('href="product.html"')) {
  homepageFailures.push('deep Product route');
}
if (index.includes('assets/images/grading-scenario-analysis.webp')) {
  homepageFailures.push('legacy grading WebP reference removed');
}
if (index.includes('assets/images/recommendation-explorer.webp')) {
  homepageFailures.push('legacy recommendation WebP reference removed');
}

if (homepageFailures.length) {
  throw new Error(`Homepage brand asset validation failed: ${homepageFailures.join(', ')}`);
}

const product = fs.readFileSync(path.join(root, 'product.html'), 'utf8');
const productFailures = [];
if (!product.includes('id="grading"') || !product.includes('id="grade-form"')) {
  productFailures.push('native grading scenario experience');
}
if (!product.includes('assets/images/flipforge-traceback-guidance.svg')) {
  productFailures.push('native traceback SVG');
}
if (productFailures.length) {
  throw new Error(`Product brand asset validation failed: ${productFailures.join(', ')}`);
}

const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith('.html'));
for (const filename of htmlFiles) {
  const html = fs.readFileSync(path.join(root, filename), 'utf8');
  if (!html.includes('class="site-header"')) continue;

  const failures = [];
  if (!html.includes('assets/brand/flipforge-mark.svg')) failures.push('approved header mark');
  if (!html.includes('Card Intelligence') && !html.includes('CARD INTELLIGENCE')) failures.push('Card Intelligence identity line');
  if (html.includes('Card Value Intelligence') || html.includes('CARD VALUE INTELLIGENCE')) failures.push('retired Card Value Intelligence descriptor removed');
  if (!html.includes('assets/css/brand-v2.css')) failures.push('brand-v2 stylesheet');
  if (!html.includes('assets/brand/flipforge-app-icon-dark.svg')) failures.push('approved favicon');
  if (html.includes('Signal. Confidence. Advantage.')) failures.push('legacy identity line removed');
  if (html.includes('SIGNAL. CONFIDENCE. ADVANTAGE.')) failures.push('legacy uppercase identity line removed');

  if (failures.length) {
    throw new Error(`${filename} failed brand integrity validation: ${failures.join(', ')}`);
  }
}

const manifest = fs.readFileSync(path.join(root, 'site.webmanifest'), 'utf8');
if (!manifest.includes('/assets/brand/flipforge-app-icon-dark.svg')) {
  throw new Error('site.webmanifest does not use the approved FlipForge app icon');
}

const brandCss = fs.readFileSync(path.join(root, 'assets/css/brand-v2.css'), 'utf8');
if (!brandCss.includes('flipforge-before-after-overlay.svg')) {
  throw new Error('brand-v2.css is not wired to the Before/After correction overlay');
}

console.log(`Brand integrity validation passed across ${htmlFiles.length} website pages.`);
