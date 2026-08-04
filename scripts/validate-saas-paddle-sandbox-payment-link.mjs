import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const html = read("paddle-sandbox-checkout.html");
const js = read("assets/js/paddle-sandbox-checkout.js");
const css = read("assets/css/paddle-sandbox-checkout.css");

const results = [];
const check = (name, condition) => results.push({ name, passed: Boolean(condition) });

[
  ["001 page is explicitly non-production", html.includes("Paddle Sandbox · No real charges") && html.includes("Non-production sandbox validation only")],
  ["002 page is excluded from search indexing", html.includes('name="robots" content="noindex,nofollow,noarchive"')],
  ["003 Paddle.js is loaded only from Paddle CDN", html.includes('src="https://cdn.paddle.com/paddle/v2/paddle.js"')],
  ["004 sandbox client script is loaded", html.includes('src="assets/js/paddle-sandbox-checkout.js"')],
  ["005 checkout client forces Paddle sandbox before initialization", js.indexOf('Paddle.Environment.set("sandbox")') < js.indexOf("Paddle.Initialize({")],
  ["006 checkout client uses a test client-side token", /CLIENT_SIDE_TOKEN\s*=\s*"test_[^"]+"/.test(js)],
  ["007 checkout client contains no Paddle server API key", !/pdl_(?:live|sdbx)_apikey_|FLIPFORGE_PADDLE_API_KEY/.test(js)],
  ["008 checkout client contains no webhook secret", !/FLIPFORGE_PADDLE_WEBHOOK_SECRET|webhookSecret/i.test(js)],
  ["009 checkout client contains no live client token", !/CLIENT_SIDE_TOKEN\s*=\s*"live_/.test(js)],
  ["010 page relies on backend transaction handoff", js.includes('searchParams.get("_ptxn")') && js.includes("TRANSACTION_PATTERN")],
  ["011 page does not construct checkout from browser price ids", !/priceId|price_id|items\s*:/.test(js)],
  ["012 page does not directly grant paid access", js.includes("paid access still changes only after the verified subscription webhook") && html.includes("does not directly grant paid FlipForge access")],
  ["013 page preserves no sports-card transaction authority", html.includes("No sports-card transaction authority")],
  ["014 page has dedicated responsive styling", css.includes(".sandbox-card") && css.includes("@media(max-width:640px)")]
].forEach(([name, condition]) => check(name, condition));

const statuses = [];
let environment = null;
let initialized = null;
const fakeDocument = {
  readyState: "complete",
  querySelector(selector) {
    if (selector === "[data-paddle-sandbox-status]") return { textContent: "", dataset: {} };
    if (selector === "[data-paddle-sandbox-detail]") return { textContent: "" };
    return null;
  },
  addEventListener() {}
};
const fakeWindow = {
  location: { href: "https://deploy-preview-46--goflipforge.netlify.app/paddle-sandbox-checkout.html?_ptxn=txn_01h0j589qt1nee24210teqtz57" },
  Paddle: {
    Environment: { set(value) { environment = value; } },
    Initialize(config) { initialized = config; }
  }
};
const context = vm.createContext({
  window: fakeWindow,
  document: fakeDocument,
  URL,
  console,
  Object,
  String,
  Error,
  RegExp,
  Array,
  Boolean
});
vm.runInContext(js, context, { filename: "paddle-sandbox-checkout.js" });
statuses.push(environment, initialized?.checkout?.settings?.displayMode, initialized?.checkout?.settings?.theme);
check("015 runtime sets sandbox environment", statuses[0] === "sandbox");
check("016 runtime initializes overlay checkout", statuses[1] === "overlay");
check("017 runtime uses light Paddle checkout", statuses[2] === "light");
check("018 runtime passes only a client-side test token", typeof initialized?.token === "string" && initialized.token.startsWith("test_") && !initialized.token.includes("pdl_"));
check("019 runtime registers event callback", typeof initialized?.eventCallback === "function");

const failures = results.filter(result => !result.passed);
console.log("SaaSPaddleSandboxPaymentLinkValidation");
console.log(`PASSED: ${results.length - failures.length}`);
console.log(`FAILED: ${failures.length}`);
for (const failure of failures) console.error(`FAIL | ${failure.name}`);
if (failures.length) process.exitCode = 1;
