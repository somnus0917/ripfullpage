// Shared storage keys used across extension execution contexts.
(() => {
  globalThis.ripfullpageConstants = Object.freeze({
    EDITOR_IMAGE_KEY: "ripfullpage:lastImage",
    HISTORY_KEY: "ripfullpage:history",
    LANGUAGE_KEY: "ripfullpage:language",
    LAST_SOURCE_URL_KEY: "ripfullpage:lastSourceURL",
  });
})();
