export function init() {
  // Ensure create pane can host fullscreen overlays
  const $root = $("#uie-view-create");
  if ($root.length) {
    $root.css({ position: "relative", height: "100%" });
  }

  const ensureOverlay = () => {
    if ($("#uie-create-overlay").length) return;
    $("body").append(`
      <div id="uie-create-overlay" style="display:none; position:fixed; inset:0; z-index:2147483646; background:#000; isolation:isolate;">
        <div style="height:52px; display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.65);">
          <button id="uie-create-overlay-exit" style="height:34px; padding:0 12px; border-radius:6px; border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.25); color:#fff; font-weight:900; cursor:pointer;">Exit</button>
          <div id="uie-create-overlay-title" style="font-weight:900; color:#f1c40f; letter-spacing:0.8px;">CREATE</div>
        </div>
        <div id="uie-create-overlay-body" style="height:calc(100% - 52px); overflow:hidden; position:relative;"></div>
      </div>
    `);
  };

  const closeOverlay = () => {
    $("#uie-create-overlay").hide();
    $("#uie-create-overlay-body").empty();
  };

  $(document)
    .off("click.uieCreateOverlayExit", "#uie-create-overlay-exit")
    .on("click.uieCreateOverlayExit", "#uie-create-overlay-exit", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeOverlay();
    });

  const loadStation = async (target) => {
    const { loadFeatureTemplate } = await import("../featureLoader.js");
    let onExit = null;

    ensureOverlay();
    $("#uie-create-overlay-title").text(String(target || "CREATE").toUpperCase());
    $("#uie-create-overlay").show();
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
        if (mod?.open) mod.open({ mode: "inline", hostEl: $host.get(0), zIndex: 2147483646, onExit });
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
    .off("click.uieCreateBack", "#uie-view-create [data-action='back-create']")
    .on("click.uieCreateBack", "#uie-view-create [data-action='back-create']", (e) => {
      e.preventDefault(); e.stopPropagation();
      closeOverlay();
    });

  $(document).off("click.uieStationAct");
}
