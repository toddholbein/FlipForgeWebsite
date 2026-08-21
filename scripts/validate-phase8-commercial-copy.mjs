import fs from 'node:fs';

const homepage = fs.readFileSync('index.html', 'utf8');
const pricing = fs.readFileSync('pricing.html', 'utf8');
const betaTerms = fs.readFileSync('beta-terms.html', 'utf8');
const terms = fs.readFileSync('terms.html', 'utf8');
const refund = fs.readFileSync('refund.html', 'utf8');
const failures = [];

function requireText(label, text, needle) {
  if (!text.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
}

function forbidText(label, text, needle) {
  if (text.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
}

// Homepage stays concise and routes detailed commercial information to Pricing.
requireText('homepage', homepage, 'Before You Buy, <span>Know Why.</span>');
requireText('homepage', homepage, 'More than comps.');
requireText('homepage', homepage, 'href="pricing.html"');
requireText('homepage', homepage, 'Controlled Private Beta');
requireText('homepage', homepage, 'Request Beta Access');
requireText('homepage', homepage, 'CARD INTELLIGENCE');
forbidText('homepage', homepage, '<div class="pricing-grid">');
forbidText('homepage', homepage, '<h3>Scout</h3>');
forbidText('homepage', homepage, 'Most popular');

// Pricing owns detailed plan and billing language.
requireText('pricing', pricing, 'Planned Launch Pricing');
requireText('pricing', pricing, '10 planned evaluations per month');
requireText('pricing', pricing, '75 planned evaluations per month');
requireText('pricing', pricing, '300 planned evaluations per month');
requireText('pricing', pricing, '<tr><td>Planned monthly evaluations</td><td>10</td><td>75</td><td>300</td></tr>');
forbidText('pricing', pricing, '<li>5 evaluations each month</li>');
forbidText('pricing', pricing, '<tr><td>Monthly evaluations</td><td>5</td>');
forbidText('pricing', pricing, 'Most popular');

requireText('pricing', pricing, 'Forge Heat™ beta/roadmap access when available');
requireText('pricing', pricing, '<tr><td>Forge Heat™</td><td class="no">No</td><td class="no">No</td><td class="varies">Beta / roadmap</td></tr>');
requireText('pricing', pricing, 'Tracked cards subject to reasonable-use and technical limits');
requireText('pricing', pricing, '<td>Reasonable use*</td>');

requireText('pricing', pricing, '$14.99 <small>/ month</small>');
requireText('pricing', pricing, '$29.99 <small>/ month</small>');
requireText('pricing', pricing, 'No paid checkout is active during private beta.');
requireText('pricing', pricing, 'Beta participation does not enroll a user in Scout, Collector, Pro, or any future paid plan.');
requireText('pricing', pricing, 'Any future paid checkout must be a separate, deliberate customer action after commercial launch review.');
requireText('pricing', pricing, 'Private Beta does not automatically convert to Scout, Collector, Pro, or any paid subscription.');
requireText('pricing', pricing, 'If Paddle is used at commercial launch, it will act as Merchant of Record for transactions it processes.');

requireText('beta terms', betaTerms, '<h2>Beta and paid plans</h2>');
requireText('beta terms', betaTerms, 'Private Beta participation does not automatically convert to Scout, Collector, Pro, Founding Pro, or any paid subscription');
requireText('beta terms', betaTerms, 'Any future paid enrollment requires a separate explicit checkout or other clear acceptance step');
requireText('beta terms', betaTerms, 'Beta participation does not guarantee a permanent entitlement, permanent discount, or future price');
requireText('beta terms', betaTerms, 'accepting Private Beta access alone does not enroll you in that offer');

requireText('terms', terms, 'Paddle acts as the Merchant of Record and seller for transactions it processes and is responsible for collecting payment');
requireText('terms', terms, 'Subscription prices, billing intervals, taxes, and renewal terms are presented at or before checkout');
requireText('terms', terms, 'You may cancel a recurring subscription to stop future renewal');
requireText('terms', terms, 'Unless a refund, withdrawal right, or other mandatory legal remedy applies');
requireText('terms', terms, 'are processed through Paddle for Paddle transactions');
requireText('terms', terms, 'Nothing in these terms excludes or limits liability where doing so would be prohibited by applicable law');

requireText('refund', refund, 'Paddle, which acts as the Merchant of Record and seller for transactions completed through Paddle');
requireText('refund', refund, 'Paddle is responsible for charging the payment method used at checkout and for issuing approved refunds through its payment system');
requireText('refund', refund, 'Except where required by applicable law or where Paddle approves a refund under its refund policy');
requireText('refund', refund, 'use Paddle Buyer Support at <a href="https://paddle.net/"');
requireText('refund', refund, 'Canceling a subscription stops future renewal');
requireText('refund', refund, 'Nothing in this policy limits rights you may have under applicable consumer-protection law');
requireText('refund', refund, 'https://www.paddle.com/legal/refund-policy');
requireText('refund', refund, 'those rights control');

forbidText('terms', terms, 'FlipForge directly processes payments');
forbidText('refund', refund, 'FlipForge directly issues refunds');
forbidText('refund', refund, 'no refunds under any circumstances');
forbidText('refund', refund, 'all sales are final');

for (const [label, text] of [['homepage', homepage], ['pricing', pricing], ['beta terms', betaTerms], ['terms', terms], ['refund', refund]]) {
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'transactionAuthority=true', 'recommendation=', 'supportedValue=']) {
    forbidText(label, text, forbidden);
  }
}

if (failures.length) {
  console.error('Phase 8 commercial copy validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PASS: concise homepage routing, planned pricing, Private Beta, subscription terms, and refund copy remain commercially consistent.');
