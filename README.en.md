# P2: Pixiv Preview

<p align="center">
  <img src="assets/icon.png" width="128" alt="P2 logo">
</p>

<p align="center">A hover preview extension for Pixiv.</p>

<p align="center"><a href="README.md">简体中文</a> · English · <a href="README.ja.md">日本語</a></p>

**P2** is a Chrome extension for quickly previewing illustrations, with dedicated support for collecting images through [Nazurin](https://github.com/y-young/nazurin).

When browsing your Pixiv following feed, search results, rankings, bookmarks, and artist profiles, simply hover over any thumbnail to inspect the artwork without repeatedly opening new tabs.

- **See the full artwork:** Landscape, portrait, and long illustrations are displayed in their original aspect ratio without cropping.
- **Flip through multi-page works:** Browse every page of a multi-image artwork right inside the floating preview.
- **Pin and compare multiple works:** Pin any preview to keep it on screen while you continue hovering and opening other artworks.
- **Move and resize freely:** Drag windows anywhere, resize proportionally with the scroll wheel or window edges, or auto-arrange pinned windows beside the page content.
- **Optional Nazurin integration:** Connect your self-hosted Nazurin service to submit individual artworks or batch-submit all pinned previews at once.

## Install and update

### Install from the Chrome Web Store (recommended)

1. Open the [P2: Pixiv Preview listing on the Chrome Web Store](https://chromewebstore.google.com/detail/p2-pixiv-preview/mpdecaobbbnbfdbhnjnipbbepnokepbd).
2. Click **Add to Chrome** and follow the browser prompts.
3. After installation, a settings tab opens with a brief setup guide. Complete or skip the guide, then open or refresh any Pixiv page to start using P2.

When installed from the Chrome Web Store, Chrome updates the extension automatically once new releases are published.

The first update from `1.1.1` or earlier to `1.2.0` or later automatically opens the new setup guide while preserving preferences, shortcuts, and Nazurin settings. P2 records that the guide was opened, so closing or skipping it will not cause later updates to open it again. Pixiv stays enabled by default; Twitter/X and pixivision, previously enabled automatically, now need to be enabled under **Website access**, followed by a page refresh.

> [!NOTE]
> Every Chrome Web Store update goes through store review, so the store version may occasionally lag slightly behind the latest GitHub Release.

### Install locally (Developer mode)

Useful if you want to try the latest GitHub Release right away or cannot access the Chrome Web Store.

1. Download the latest `P2-vX.Y.Z.zip` from the [Releases](https://github.com/Yuuikic/pixiv-preview/releases) page and extract it to a permanent folder.
2. Open `chrome://extensions/` in Chrome.
3. Turn on **Developer mode** in the upper-right corner, then click **Load unpacked**.
4. Select the extracted folder that contains `manifest.json`.
5. Open or refresh your Pixiv tabs to start previewing.

**To update a local installation:** Download and extract the new release over your existing folder, click **Reload** on the P2 card at `chrome://extensions/`, and refresh your open tabs. Avoid enabling both the Chrome Web Store version and the local version at the same time to prevent duplicate previews.

## Get started

### Basic workflow

When first installed, the settings page offers a three-step **Setup guide** with an interactive preview area where you can try hovering and pinning right away. You can reopen it anytime via the **Setup guide** button at the bottom of the settings page.

1. **Hover to preview:** Rest your pointer on an artwork thumbnail (for 0.5 seconds by default) to open a floating preview.
2. **Pin a preview:** Press `S` or click the preview window to keep it open on screen, then hover over other thumbnails to view multiple artworks side by side.
3. **Move, resize, and flip pages:** Drag the image or an empty area of the bottom bar to move the window. Scroll inside a pinned window or drag its edges to resize proportionally. Use the bottom-bar arrows or `←` / `→` keys to flip through multi-page works.
4. **Hide or close:** Click `×` in the bottom bar (or double-click a pinned window) to close it, or press `Esc` to hide all previews on the current page.

Once pinned, the bottom bar also provides buttons to **Bookmark artwork** (on Pixiv) and **Open artwork in a new tab**.

### Controls and shortcuts at a glance

All letter/number shortcuts below can be customized in settings (and are automatically ignored while typing in text fields):

| Action | Result |
| --- | --- |
| Hover over a thumbnail | Open the preview; when your pointer leaves, the window lingers for 0.5 seconds by default so you can easily move into it |
| `S` | Pin the active hover preview; if there is no hover preview, unpin the topmost pinned window |
| `C` | Copy the topmost preview's artwork detail URL to the clipboard (no need to pin first) |
| Click preview / bottom-bar **Pin** button | Clicking the preview pins it and brings it to the front; the **Pin** button toggles its pinned state |
| Drag image or bottom bar | Move the preview window (dragging an unpinned preview automatically pins it) |
| Scroll wheel / drag window edges | Scroll inside a pinned window or drag its edges to resize proportionally |
| `←` / `→` or bottom-bar page buttons | Flip to the previous or next image in a multi-page artwork |
| Double-click pinned window / click `×` | Close that preview window |
| `Esc` | Hide all preview windows in the current tab; press `Esc` again within 10 seconds to restore them (as long as no new preview was opened) |
| `D` / `Shift+D` | Submit the current artwork / batch-submit all pinned artworks to Nazurin (requires Nazurin configuration) |

### Customize settings

Click the P2 icon in the Chrome toolbar to open the settings popup, or click the button in the upper-right corner of the popup to open the full settings page in a new tab. Changes to general settings are saved and applied immediately:

| Setting | Purpose and default |
| --- | --- |
| **Hover delay** | How long to hover over a thumbnail before opening the preview (`500 ms` by default). Increase it to reduce accidental triggers |
| **Preview linger time** | How long an unpinned preview stays open after your pointer leaves the thumbnail (`500 ms` by default). Increase it to make moving into the preview easier |
| **Detect artwork under preview** | On by default. Lets you switch previews to other thumbnails covered by an unpinned preview; turn it off if you prefer moving into an unpinned preview without switching artworks |
| **Load original image** | Off by default. When enabled, upgrades the preview to the full-resolution original image after the standard preview loads (uses more time and bandwidth) |
| **Auto-arrange pinned previews** | Off by default. When enabled, pinning a preview with the keyboard shortcut automatically resizes and docks it into the open space beside the page's thumbnails |
| **Keyboard shortcuts** | Customize the keys for **Pin / unpin** (`S`), **Copy artwork link** (`C`), and **Submit to Nazurin** (`D`) using any distinct letter or number |
| **Close preview after Nazurin submission** | Off by default. Automatically closes the corresponding preview window once Nazurin accepts the artwork link |

## Multi-site support and website access

Beyond Pixiv, P2 supports hover previews on major illustration boards as well as Nazurin link submission on Twitter/X and pixivision.

### Site feature support

| Site | Supported domains | Hover previews / pinned windows | Submit to Nazurin |
| --- | --- | --- | --- |
| **Pixiv** | [pixiv.net](https://www.pixiv.net/) | Yes | Yes |
| **Danbooru** | [danbooru.donmai.us](https://danbooru.donmai.us/) | Yes | Yes |
| **yande.re** | [yande.re](https://yande.re/) | Yes | Yes |
| **Konachan** | [konachan.com](https://konachan.com/), [konachan.net](https://konachan.net/) | Yes | Yes |
| **Zerochan** | [zerochan.net](https://www.zerochan.net/) | Yes | Yes |
| **Twitter/X** | [x.com](https://x.com/), [twitter.com](https://twitter.com/) | No | Yes |
| **pixivision** | [pixivision.net](https://www.pixivision.net/) | No | Yes (Pixiv artwork links in articles) |

### Enabling additional websites

Pixiv is enabled at installation. Other supported sites use optional permissions—**you can enable hover previews on Danbooru, yande.re, Konachan, and Zerochan even without connecting Nazurin**:

- **Authorize from Settings:** Open the **Website access** section in P2 settings, click the sites you want to use (or click **Authorize all**), approve the browser prompt, and refresh your open tabs for those sites.
- **Enable on the current tab:** While visiting a supported website, click the P2 toolbar icon, open the Nazurin / Website access section, and click **Enable on this website**, then refresh the tab.
- **Disable anytime:** Click **Disable** next to any site under **Enabled websites** to turn off P2 on that site and release its optional browser permission. Pixiv's installation permission remains; a permission shared with your Nazurin server also remains until neither feature needs it.

Once enabled, listing and search pages on supported image boards use the same hover preview, pinning, moving, resizing, and keyboard shortcuts as Pixiv.

## Optional: connect Nazurin

If you run your own **[Nazurin](https://github.com/y-young/nazurin) service**, you can send artworks and tweets straight to your collection while browsing.

### Connection settings

1. Open P2 settings and locate **Nazurin → Connection settings**.
2. Enter your service's **API Host** and **Bot Token** (Telegram Bot Token). Remote servers must use `https://`; local servers for testing may use `http://localhost` or `http://127.0.0.1`.
3. Click **Save** and approve the browser permission prompt for your server address.
4. Click **Test connection**. Once the test succeeds, the Nazurin button and submission shortcuts are enabled (if you change the host or token later, save and test again).

### Submitting artworks

Once connected, you can submit works to Nazurin in several ways:

| Action | Where and how it works |
| --- | --- |
| **Press `D`** (or your custom key) | **On listing pages:** Submit the hovered thumbnail, active preview window, or hovered tweet (works even before the delayed hover preview opens)<br>**On detail pages:** Press anywhere on an artwork or tweet detail page to submit the currently viewed work |
| **Press `Shift+D`** | **Batch submission:** On preview-enabled sites, sequentially submit all currently pinned preview windows in the tab |
| **Click the Nazurin icon** | Inside any pinned preview window, click the Nazurin icon in the bottom bar to submit that artwork |

**Tips for specific sites and workflows:**
- **Multi-page artworks:** Submitting a multi-image work always submits the entire artwork, regardless of which page you are viewing in the preview.
- **Twitter/X tweets:** Hover over a tweet card (text, media, or timestamp) and press `D` to submit its link. Retweets submit the original tweet, and quote tweets submit the outer tweet. On tweet detail pages or the photo viewer, pressing `D` submits the tweet shown in the address bar.
- **pixivision articles:** On a pixivision feature article, hover over a featured illustration, its title, or its credit block and press `D` to submit the underlying Pixiv artwork link directly.
- **Queueing and retries:** Rapid submissions are automatically queued in order, with status notifications shown in the preview bar or the bottom-right corner of the page. If a request fails due to a network issue, simply press the key or click the icon again to retry.

> [!IMPORTANT]
> **“Submitted to Nazurin” means your server has accepted the link, not that the download has finished.** Actual downloading and storage are handled by your Nazurin server—check your Telegram messages for the final result.

## Frequently asked questions

1. **Why don't Pixiv animations (Ugoira) play?**
   Animated works currently display their static cover image in the preview window.

2. **Why can't I preview certain artworks?**
   Make sure your currently signed-in account has permission to view the work on the site (e.g., age-restricted, MyPixiv-only, deleted, or region-restricted works). P2 respects the site's access rules and does not bypass restrictions.

3. **Why is the bookmark button in the preview bar disabled?**
   Pin the preview window first (`S` or click the window). In addition, native bookmarking is currently supported only on Pixiv and requires a matching bookmark button on the underlying page; if unavailable, you can open the artwork in a new tab to bookmark it.

4. **Why didn't updating the extension or authorizing a site take effect?**
   Refresh any open tabs for that website after authorizing or updating. For local Developer mode installations, click **Reload** at `chrome://extensions/` first, then refresh your tabs.

5. **Why is the Nazurin button missing or pressing `D` doing nothing?**
   Verify that you have clicked **Save** and passed **Test connection** in Nazurin settings. On sites other than Pixiv, also make sure the site is enabled under **Website access** and that you have refreshed the page.

## Privacy and license

P2 is designed with strict privacy boundaries:
- **Zero telemetry:** P2 includes no analytics or tracking and never sends your browsing data to the developer.
- **Least-privilege access:** Only Pixiv access is requested at installation. All other supported websites and your Nazurin server address use optional permissions granted only when you enable them, and released once neither website features nor the server needs them.
- **Local credential storage:** While general display preferences may sync via Chrome, your Nazurin API Host and Bot Token are stored strictly in local storage on your device. When submitting to Nazurin, P2 sends only the canonical artwork URL—never your site cookies, login credentials, or image data.

See also: [Privacy policy](PRIVACY.md) · [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

For development setup, testing, and release packaging instructions, see [DEVELOPMENT.md](DEVELOPMENT.md#english).

## Acknowledgements

- [Nazurin](https://github.com/y-young/nazurin): The open-source artwork collection service integrated with this project
- [Nazurin Extension](https://github.com/y-young/nazurin-extension): Provided the icon assets and interaction reference for the Nazurin integration
