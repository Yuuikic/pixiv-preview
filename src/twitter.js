(() => {
  "use strict";

  const tweetSelector = 'article[data-testid="tweet"]';

  function tweetUrlFromLink(link) {
    try {
      const url = new URL(link.href, location.href);
      if (url.protocol !== "https:" ||
          !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname)) return null;
      const match = url.pathname.match(/^\/([a-z0-9_]{1,15})\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/i);
      return match ? `https://twitter.com/${match[1]}/status/${match[2]}` : null;
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

  function currentPhotoTweetUrl() {
    // Read on every keypress: opening, switching, and closing X's photo viewer
    // changes the URL without reloading this content script.
    const url = new URL(location.href);
    if (!/^\/[a-z0-9_]{1,15}\/status\/\d+\/photo\/\d+\/?$/i.test(url.pathname)) return null;
    return tweetUrlFromLink({ href: url.href });
  }

  globalThis.P2LinkSubmit({
    resolveTarget: (pointer) => currentPhotoTweetUrl() || hoveredTweetUrl(pointer),
    createMessage: (tweetUrl) => ({ type: "pfp-nazurin-twitter-submit", tweetUrl }),
    duplicateKey: "tweetAlreadyQueued"
  });
})();
