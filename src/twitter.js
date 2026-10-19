(() => {
  "use strict";
  if (globalThis.P2SiteSession && !globalThis.P2SiteSession.claim("twitter.js")) return;

  const tweetSelector = 'article[data-testid="tweet"]';

  function tweetUrlFromLink(link) {
    try {
      const url = new URL(link.href, location.href);
      if (url.protocol !== "https:" ||
          !["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.x.com", "mobile.twitter.com"].includes(url.hostname)) return null;
      return globalThis.P2NazurinSites.targetUrl(url.href);
    } catch {
      return null;
    }
  }

  function hoveredTweetUrl(pointer) {
    if (!pointer) return null;
    // Resolve at keypress time: X can recycle timeline nodes or scroll under the pointer.
    const target = document.elementFromPoint(pointer.x, pointer.y);
    const article = target?.closest(tweetSelector);
    if (!article) return null;
    const links = [...article.querySelectorAll('a[href*="/status/"]')].filter((link) =>
      link.closest(tweetSelector) === article &&
      !link.closest('[data-testid="tweetText"], [data-testid="quoteTweet"]') &&
      !link.parentElement?.closest('[role="link"]'));
    // The timestamp belongs to the outer tweet, even when hovering a quote or retweet.
    const permalink = links.find((link) => link.querySelector("time") && tweetUrlFromLink(link));
    return permalink ? tweetUrlFromLink(permalink) :
      links.map(tweetUrlFromLink).find(Boolean) || null;
  }

  function currentTweetUrl() {
    // Read on every keypress: navigating tweet details or X's photo viewer
    // changes the URL without reloading this content script.
    const url = new URL(location.href);
    if (!/^\/(?:[a-z0-9_]{1,15}|i\/web)\/status\/\d+(?:\/(?:photo|video)\/\d+)?\/?$/i.test(url.pathname)) return null;
    return tweetUrlFromLink({ href: url.href });
  }

  globalThis.P2LinkSubmit({
    resolveTarget: (pointer) => currentTweetUrl() || hoveredTweetUrl(pointer),
    createMessage: (tweetUrl) => ({ type: "pfp-nazurin-twitter-submit", tweetUrl }),
    duplicateKey: "tweetAlreadyQueued"
  });
})();
