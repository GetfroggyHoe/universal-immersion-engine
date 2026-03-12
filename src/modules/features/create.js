export function init() {
  // Ensure create pane can host fullscreen overlays
  const $root = $("#uie-view-create");
  if ($root.length) {
    $root.css({ position: "relative", height: "100%" });
  }

  let closingOverlay = false;

  const resetOverlayState = () => {
    const $overlay = $("#uie-create-overlay");
    const $body = $("#uie-create-overlay-body");
    if ($overlay.length) {
      const ov = $overlay.get(0);
      try { ov?.style?.setProperty("display", "none", "important"); } catch (_) { if (ov) ov.style.display = "none"; }
      $overlay.css({ pointerEvents: "auto", zIndex: 2147483647 });
    }
    if ($body.length) {
      $body.css({ background: "transparent", overflow: "hidden", height: "100%", minHeight: 0 }).empty();
    }
  };

  const ensureOverlay = () => {
    // Overlay is now part of create.html
    return;
  };

  const closeOverlay = () => {
    if (closingOverlay) return;
    closingOverlay = true;
    try {
      const kitchenOverlay = document.getElementById("uie-kitchen-overlay");
      if (kitchenOverlay && kitchenOverlay.style.display !== "none") {
        let handled = false;
        try {
          if (typeof window.UIE_closeKitchen === "function") {
            window.UIE_closeKitchen({ skipOnExit: true });
            handled = true;
          }
        } catch (_) {}
        try {
          if (!handled) {
            import("./kitchen.js").then((mod) => {
              try { mod?.close?.({ skipOnExit: true }); } catch (_) {}
            });
          }
        } catch (_) {}
      }
      resetOverlayState();
    } finally {
      closingOverlay = false;
    }
  };

  const closeOverlayFromEvent = (e) => {
    if (e?.type === "pointerup") {
      const pt = String(e?.pointerType || "").toLowerCase();
      if (pt && pt !== "touch" && pt !== "pen") return;
    }
    e?.preventDefault?.();
    e?.stopPropagation?.();
    try { e?.stopImmediatePropagation?.(); } catch (_) {}
    closeOverlay();
  };

  try { window.UIE_closeCreateOverlay = closeOverlay; } catch (_) {}

  $(document)
    .off("click.uieCreateOverlayExit pointerup.uieCreateOverlayExit", "#uie-create-overlay-exit")
    .on("click.uieCreateOverlayExit pointerup.uieCreateOverlayExit", "#uie-create-overlay-exit", closeOverlayFromEvent);

  const loadStation = async (target) => {
    const { loadFeatureTemplate } = await import("../featureLoader.js");
    let onExit = null;

    ensureOverlay();
    $("#uie-create-overlay-title").text(String(target || "CREATE").toUpperCase());
    {
      const ov = document.getElementById("uie-create-overlay");
      try { ov?.style?.setProperty("display", "flex", "important"); } catch (_) { if (ov) ov.style.display = "flex"; }
      $("#uie-create-overlay").css({ pointerEvents: "auto", zIndex: 2147483647 });
    }
    const $host = $("#uie-create-overlay-body");
    $host.css({ overflow: "hidden", background: "#000", height: "100%", minHeight: 0 }).html(`<div style="padding:16px;color:rgba(255,255,255,.7);font-weight:800;">Loading...</div>`);
    onExit = closeOverlay;

    try {
      if (target === "forge") {
        const html = await loadFeatureTemplate("forge");
        $host.css({ overflow: "hidden", height: "100%", minHeight: 0 }).html(html);
        const mod = await import("./forge.js");
        if (mod?.init) mod.init();
        return;
      }
      if (target === "alchemy") {
        const html = await loadFeatureTemplate("alchemy");
        $host.css({ overflow: "hidden", height: "100%", minHeight: 0 }).html(html);
        const mod = await import("./alchemy.js");
        if (mod?.init) mod.init();
        return;
      }
      if (target === "enchant") {
        const html = await loadFeatureTemplate("enchant");
        $host.css({ overflow: "hidden", height: "100%", minHeight: 0 }).html(html);
        const mod = await import("./enchant.js");
        if (mod?.init) mod.init();
        return;
      }
      if (target === "cook") {
        const html = await loadFeatureTemplate("kitchen");
        $host.css({ overflow: "hidden", background: "transparent", height: "100%", minHeight: 0 }).html(html);
        const mod = await import("./kitchen.js");
        if (mod?.init) mod.init();
        if (mod?.open) mod.open({ mode: "inline", hostEl: $host.get(0), zIndex: 2147483647, onExit });
        return;
      }
      } catch (err) {
      console.error("[UIE] Station load failed:", err);
      $host.html(`<div style="padding:16px;color:#f38ba8;font-weight:900;">Error loading station.</div>`);
    }
  };

  // Bind craft buttons
  $(document)
    .off("click.uieCreate pointerup.uieCreate", "#uie-view-create .uie-craft-block, #uie-view-create .uie-craft-card, #uie-view-create .uie-craft-btn")
    .on("click.uieCreate pointerup.uieCreate", "#uie-view-create .uie-craft-block, #uie-view-create .uie-craft-card, #uie-view-create .uie-craft-btn", async function (e) {
      if (e.type === "pointerup" && e.pointerType !== "touch") return;
      e.preventDefault();
      e.stopPropagation();

      if (e.type === "pointerup") {
        try { window.UIE_lastCreateTouchAt = Date.now(); } catch (_) {}
      } else {
        try {
          const t = Number(window.UIE_lastCreateTouchAt || 0);
          if (t && Date.now() - t < 650) return;
        } catch (_) {}
      }

      const target = String($(this).data("target") || "");
      if (!target) return;
      await loadStation(target);
    });

  // If your create HTML includes a back button, wire it:
  $(document)
    .off("click.uieCreateBack pointerup.uieCreateBack", "#uie-create-overlay [data-action='back-create']")
    .on("click.uieCreateBack pointerup.uieCreateBack", "#uie-create-overlay [data-action='back-create']", closeOverlayFromEvent);

  $(document).off("click.uieStationAct");

  // In case a previous mobile session left a fullscreen overlay mounted, always start clean.
  resetOverlayState();
}
