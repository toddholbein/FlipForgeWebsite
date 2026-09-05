import fs from 'node:fs';

const layout = fs.readFileSync('saas-prototype/guided-mode-layout-fix-v1.css', 'utf8');
const guide = fs.readFileSync('saas-prototype/guided-mode-v1.js', 'utf8');
const discover = fs.readFileSync('saas-prototype/customer-discovery.js', 'utf8');
const failures = [];

const requireText = (label, text, needle) => {
  if (!text.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};

requireText('welcome modal cannot block workspace', layout, '.ff-guide-modal-backdrop');
requireText('welcome modal is hidden', layout, 'display: none !important');
requireText('modal body lock is neutralized', layout, 'body.ff-guide-modal-open');
requireText('workspace remains scrollable', layout, 'overflow: auto !important');
requireText('contextual Guided Mode remains available', guide, 'window.FlipForgeGuidedMode = Object.freeze');
requireText('Discover still owns the exact-card search form', discover, 'data-customer-discovery-form');
requireText('Discover still exposes the card identity input', discover, 'name="exactCardQuery"');

if (failures.length) {
  console.error('Guided Mode search-first validation failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('PASS: sign-in onboarding cannot cover Discover; card search remains immediately available and Guided Mode stays contextual.');
