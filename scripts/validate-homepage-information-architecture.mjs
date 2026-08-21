import fs from 'node:fs';

const homepage = fs.readFileSync('index.html', 'utf8');
const marketing = fs.readFileSync('assets/js/marketing-v3.js', 'utf8');
const failures = [];

function check(label, condition) {
  if (!condition) failures.push(label);
}

const mainMatch = homepage.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
const main = mainMatch ? mainMatch[1] : '';
const sectionCount = (main.match(/<section\b/gi) || []).length;

check('homepage main exists', Boolean(mainMatch));
check(`homepage has exactly 5 top-level story sections (found ${sectionCount})`, sectionCount === 5);

for (const id of ['overview', 'why-flipforge', 'try-flipforge', 'how-it-works', 'next-step']) {
  check(`required homepage section #${id}`, homepage.includes(`id="${id}"`));
}

for (const id of ['before-after', 'product-screens', 'identity-checker', 'case-study', 'decision-tools', 'comparison', 'pricing', 'market-problem', 'what-flipforge-sees', 'proof-loop', 'vision']) {
  check(`legacy long-form homepage section #${id} remains removed`, !homepage.includes(`id="${id}"`));
}

check('homepage routes deep product detail to Product', homepage.includes('href="product.html"'));
check('homepage routes pricing detail to Pricing', homepage.includes('href="pricing.html"'));
check('homepage routes proof detail to Evidence Lab', homepage.includes('href="learn.html"'));
check('homepage keeps one guided demo', homepage.includes('data-demo-step="0"') && homepage.includes('data-demo-step="3"'));
check('homepage keeps CARD INTELLIGENCE source branding', homepage.includes('CARD INTELLIGENCE'));

check('marketing layer does not inject full sections', !/createElement\(['"]section['"]\)/.test(marketing));
check('marketing layer does not insert runtime sections', !marketing.includes('insertAdjacentElement'));
for (const id of ['market-problem', 'what-flipforge-sees', 'proof-loop', 'vision']) {
  check(`marketing layer no longer injects #${id}`, !marketing.includes(id));
}

if (failures.length) {
  console.error('Homepage information architecture validation failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`PASS: homepage remains concise at ${sectionCount} story sections with deep detail routed to dedicated pages.`);
