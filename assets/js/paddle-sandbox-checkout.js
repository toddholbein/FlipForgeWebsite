(() => {
  "use strict";

  const CLIENT_SIDE_TOKEN = "test_2cea4fb2a903dc6616c35a9858c";
  const TRANSACTION_PATTERN = /^txn_[a-z0-9]{26}$/;
  const status = document.querySelector("[data-paddle-sandbox-status]");
  const detail = document.querySelector("[data-paddle-sandbox-detail]");

  function setState(label, message, tone = "neutral") {
    if (status) {
      status.textContent = label;
      status.dataset.tone = tone;
    }
    if (detail) detail.textContent = message;
  }

  function transactionFromUrl() {
    const value = new URL(window.location.href).searchParams.get("_ptxn") || "";
    return TRANSACTION_PATTERN.test(value) ? value : null;
  }

  function onPaddleEvent(event) {
    const name = String(event?.name || "");
    if (name === "checkout.loaded") {
      setState("Sandbox checkout loaded", "Paddle is handling the payment form. FlipForge does not receive card or bank details.", "ok");
      return;
    }
    if (name === "checkout.completed") {
      setState("Sandbox payment completed", "Payment completed in Paddle sandbox. FlipForge paid access still changes only after the verified subscription webhook is received.", "ok");
      return;
    }
    if (name === "checkout.closed") {
      setState("Sandbox checkout closed", "No FlipForge access change is made from closing the checkout. Verified Paddle subscription events remain the entitlement authority.", "neutral");
      return;
    }
    if (name === "checkout.error" || name === "checkout.payment.failed" || name === "checkout.payment.error") {
      setState("Sandbox checkout needs attention", "Paddle reported a sandbox checkout error. No FlipForge entitlement is granted by this page.", "warn");
    }
  }

  function initialize() {
    const transactionId = transactionFromUrl();
    if (!transactionId) {
      setState("Waiting for a sandbox transaction", "This page opens only from a FlipForge-generated Paddle sandbox transaction link.", "neutral");
    } else {
      setState("Opening Paddle sandbox", "Transaction handoff received. Paddle will open the sandbox checkout securely.", "neutral");
    }

    if (!window.Paddle) {
      setState("Paddle unavailable", "Paddle.js did not load. No payment or access change occurred.", "warn");
      return;
    }

    try {
      window.Paddle.Environment.set("sandbox");
      window.Paddle.Initialize({
        token: CLIENT_SIDE_TOKEN,
        eventCallback: onPaddleEvent,
        checkout: {
          settings: {
            displayMode: "overlay",
            theme: "light",
            locale: "en"
          }
        }
      });
    } catch (_) {
      setState("Sandbox initialization failed", "Paddle sandbox could not initialize. No payment or FlipForge access change occurred.", "warn");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
