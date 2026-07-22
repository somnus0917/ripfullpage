// Reports editor startup failures instead of leaving the loading state forever.
(() => {
  if (window.ripfullpageEditorBootstrap) {
    return;
  }

  let finished = false;
  const timeoutId = window.setTimeout(() => {
    fail(new Error("Editor startup timed out."));
  }, 20000);

  function markReady() {
    if (finished) {
      return;
    }

    finished = true;
    window.clearTimeout(timeoutId);
  }

  function fail(error, message = "") {
    if (finished) {
      return;
    }

    finished = true;
    window.clearTimeout(timeoutId);

    const detail =
      error && error.message ? error.message : String(error || "Unknown error");
    const isChinese = (navigator.language || "").toLowerCase().startsWith("zh");
    const fallback = isChinese
      ? `载入截图失败：${detail}`
      : `Could not load screenshot: ${detail}`;
    const imageMeta = document.getElementById("imageMeta");
    const dimensionBadge = document.getElementById("dimensionBadge");

    console.error("[ripfullpage] Editor startup failed:", error);

    if (imageMeta) {
      imageMeta.textContent = message || fallback;
    }

    if (dimensionBadge) {
      dimensionBadge.textContent = "";
    }
  }

  window.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLScriptElement) {
        const source = event.target.getAttribute("src") || "unknown script";

        fail(new Error(`Could not load ${source}.`));
        return;
      }

      if (event.error) {
        fail(event.error);
      }
    },
    true,
  );

  window.addEventListener("unhandledrejection", (event) => {
    fail(event.reason);
  });

  window.ripfullpageEditorBootstrap = Object.freeze({
    fail,
    markReady,
  });
})();
