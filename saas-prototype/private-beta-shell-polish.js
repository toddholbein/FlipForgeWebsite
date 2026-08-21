(() => {
  "use strict";

  const main = document.querySelector("#main-content");
  if (!main) return;

  function forgeHeatRouteActive() {
    return String(window.location.hash || "#/dashboard")
      .replace(/^#\/?/, "")
      .split(/[/?]/)[0] === "forge-heat";
  }

  function applyForgeHeatPreviewCopy() {
    if (!forgeHeatRouteActive()) return;

    main.querySelectorAll(".forge-heat-pro-chip").forEach(node => {
      node.textContent = "PREVIEW";
    });

    main.querySelectorAll(".forge-heat-title-row .eyebrow").forEach(node => {
      const version = String(node.textContent || "").split("·").pop()?.trim() || "FORGE_HEAT_V1";
      node.textContent = `PRIVATE BETA PREVIEW · ${version}`;
    });

    main.querySelectorAll(".forge-heat-lock-mark").forEach(node => {
      node.textContent = "PREVIEW";
    });

    const lock = main.querySelector(".forge-heat-lock");
    if (!lock) return;

    const eyebrow = lock.querySelector(".eyebrow");
    const heading = lock.querySelector("h2");
    const paragraphs = [...lock.querySelectorAll("p")];
    const action = lock.querySelector("a.button");

    if (eyebrow) eyebrow.textContent = "Private beta preview";
    if (heading) heading.textContent = "Forge Heat preview access is not enabled for this account.";
    if (paragraphs[0]) {
      paragraphs[0].textContent = "Paid Pro access is not active during private beta. Forge Heat remains a controlled preview while FlipForge validates the experience and evidence thresholds.";
    }
    if (action) action.textContent = "View Plan & Usage";
  }

  const observer = new MutationObserver(applyForgeHeatPreviewCopy);
  observer.observe(main, { childList: true, subtree: true });

  window.addEventListener("hashchange", () => queueMicrotask(applyForgeHeatPreviewCopy));
  queueMicrotask(applyForgeHeatPreviewCopy);
})();
