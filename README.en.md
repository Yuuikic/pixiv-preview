# P² — PixivPreview

[简体中文](README.md) · English

<img src="assets/icon.png" width="128" alt="P² logo">

<p align="center">A lightweight hover preview extension for Pixiv.</p>

P² (P squared) is a Chrome extension for previewing Pixiv artworks, with dedicated support for collecting images through [Nazurin](https://github.com/y-young/nazurin). 

Browse artwork in your following feed, search results, rankings, bookmarks, and artist profiles without opening each artwork page. Previews work out of the box and can be used independently, with no Nazurin setup required.

- **See the whole image:** Landscape, portrait, and tall images keep their proportions without cropping.
- **Browse multi-image works:** View the other images in an artwork directly in the preview.
- **Keep several artworks open:** Pin a window to keep it open while previewing other works.
- **Arrange your windows:** Drag to move, and use the scroll wheel or window edges to resize proportionally.
- **Optional Nazurin integration:** Connect your own service to submit artworks to Nazurin for collection.

## Install and update

1. Download `P2-vX.Y.Z.zip` from this repository’s Releases page and extract it into a folder.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode** in the upper-right corner and click **Load unpacked**.
4. Select the extracted folder containing `manifest.json`, not the ZIP file.
5. Open or refresh a Pixiv page to start using P².

**To update**, extract the new version and replace the files in your installation folder, click P²’s reload button at `chrome://extensions/`, then refresh every open Pixiv tab. The top of the settings page shows the loaded version.

## Get started

1. **Preview:** Hover over an artwork thumbnail. A preview appears after 0.5 seconds by default.
2. **Pin:** Press `S` or click the preview to keep it open. You can then hover over other artworks to open more windows.
3. **Arrange and browse:** Drag the image or an empty area of the bottom bar to move the window. Scroll or drag an edge to resize it. Use the left and right buttons to browse multi-image works.
4. **Close:** Click `×` in the bottom bar to close one window, or press `Esc` to temporarily hide them all.

Once pinned, a window also offers tools to bookmark the artwork or open its page in a new tab. In an unpinned preview, the first click in the tool area only pins the window; it does not activate a tool.

### Controls at a glance

These are the default shortcuts. They do not activate while you are typing in an input field.

| Action | Result |
| --- | --- |
| Hover over a thumbnail | Show a preview; after leaving, it lingers for 0.5 seconds by default so you can move into it |
| `S` | Pin the current hover preview; if there is none, unpin the topmost window |
| Click a window / its Pin control | Clicking the window pins it and brings it to the front; the Pin control toggles that window’s pinned state |
| Drag the image or an empty area of the bottom bar | Move the window, automatically pinning it if needed |
| Scroll inside a pinned window / drag its edges | Resize the window proportionally |
| `←` / `→` or the page buttons | Browse images in the multi-image artwork in the active window |
| Double-click the image or an empty area of a pinned window / click `×` | Close that window |
| `Esc` | Hide all windows in the current tab; press again within 10 seconds to restore them, provided no new preview has appeared |

After unpinning, the window closes according to the preview linger behavior. Each artwork can have only one window per tab. Navigating, going back, or going forward in the current tab closes previews; opening an artwork in a new tab leaves the current tab’s windows in place.

### Settings

Click P² in the Chrome toolbar to open settings. The button in the upper-right corner of settings opens them in a separate tab.

| Setting | Purpose and default |
| --- | --- |
| Hover delay | How long to hover before opening a preview; defaults to 500 ms. Increase it to reduce accidental previews |
| Preview linger time | How long a preview stays after leaving its thumbnail; defaults to 500 ms. Increase it to make entering the window easier |
| Detect artwork under preview | On by default, allowing switches to thumbnails covered by an unpinned preview. Turn it off to keep viewing the current artwork when entering its window |
| Load original image | Off by default. When enabled, loads the original after the preview image, potentially using more time and data |
| Auto-arrange pinned windows | Off by default. When enabled, automatically resizes and places windows in the empty space on either side of artwork thumbnails when pinned |
| Keyboard shortcuts | Change the pin and Nazurin submission keys; defaults are `S` and `D` |

General settings save automatically and take effect immediately. The settings interface uses Chinese or English based on your browser language.

## Optional: connect Nazurin

If you have your own **[Nazurin](https://github.com/y-young/nazurin) service**, P² can submit entire Pixiv artworks to it. Nazurin is not required for previews, page navigation, or pinned windows.

1. Open P² settings and expand **Nazurin**.
2. Enter your service’s **API Host** and **Bot Token** (Telegram Bot Token). Use HTTPS for remote services to avoid sending credentials in plain text.
3. Click **Save** and grant access to that service address.
4. Click **Test connection**. The Nazurin button and shortcuts become available only after a successful test. Test again after changing the configuration.

| Action | Result |
| --- | --- |
| Click the Nazurin icon in a pinned window | Submit that artwork |
| `D` | Submit the artwork in the topmost visible window, without needing to pin it first |
| `Shift+D` | Submit artworks from all pinned windows in the current tab, one after another |

If you change the submission shortcut, use `Shift` with the new key for batch submission. Multi-image works are submitted as a whole, not just the displayed image. Artworks already queued or being submitted are not added again. You can retry failures manually; navigating in the current tab cancels submissions that have not started.

**“Submitted to Nazurin” means the service accepted the request, not that the download is complete.** Nazurin handles downloading and saving. Check Telegram messages for the final result.

## Frequently asked questions

1. **Why aren’t animations playing?**

   Pixiv animations currently display only a static cover image.

2. **Why can’t I preview some artworks?**

   Check that your current Pixiv account can view the artwork. P² does not bypass private, deleted, regional, or account access restrictions. Changes to Pixiv pages or interfaces may also require an extension update.

3. **Why is the bookmark button unavailable?**

   Pin the window first. If P² cannot find the artwork’s corresponding bookmark button on the current page, the preview’s bookmark tool stays disabled. You can open the artwork page and bookmark it there.

4. **Why do I still see the old behavior after updating?**

   Reloading the extension also requires refreshing your open Pixiv pages. Check the version at the top of settings.

5. **Why is the Nazurin button missing?**

   Save the configuration, grant access, and pass the connection test. Test again after changing the configuration.

## Privacy and license

P² runs only on Pixiv pages and does not collect analytics or browsing history. General preview settings may sync through Chrome; the Nazurin address and Token stay in local storage. Access to a Nazurin service is requested only when you configure it, and clearing the configuration removes that permission.

[Privacy policy](PRIVACY.md) · [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

For development and release instructions, see [DEVELOPMENT.md](DEVELOPMENT.md#english).
