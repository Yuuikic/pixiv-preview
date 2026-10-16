(() => {
  "use strict";

  function artworkIdFromLink(link) {
    try {
      const url = new URL(link.href, location.href);
      if (url.protocol !== "https:" || url.hostname !== "www.pixiv.net" ||
          url.username || url.password || url.port) return null;
      return url.pathname.match(/^\/artworks\/(\d+)\/?$/)?.[1] || null;
    } catch {
      return null;
    }
  }

  function hoveredArtworkId(pointer) {
    if (!pointer) return null;
    // Resolve again on keypress, including after scrolling under a still pointer.
    const target = document.elementFromPoint(pointer.x, pointer.y);
    const link = target?.closest("a[href]");
    const directId = link && artworkIdFromLink(link);
    if (directId) return directId;
    const work = target?.closest(".am__work");
    if (!work) return null;
    return [...work.querySelectorAll('a[href*="/artworks/"]')]
      .map(artworkIdFromLink).find(Boolean) || null;
  }

  globalThis.P2LinkSubmit({
    resolveTarget: hoveredArtworkId,
    createMessage: (illustId) => ({ type: "pfp-nazurin-submit", illustId }),
    duplicateKey: "alreadyQueued"
  });
})();
