# P2 Privacy Policy

Last updated: 2026-10-20

P2 does not operate a developer-controlled server, and the developer does not
receive or retain data from the extension. To provide its user-facing features,
the extension processes a limited amount of data on the user's device and
communicates with preview sites and, when configured by the user, a self-hosted Nazurin
service as described below. P2 does not collect analytics or telemetry.

## Data processed by the extension

- Preview preferences and keyboard shortcuts are stored with
  `chrome.storage.sync`, so Chrome may synchronize them through the user's
  signed-in browser profile.
- Enabled website origins, temporary website opt-in requests, first-use guide
  progress, and the one-time upgrade-guide display record are stored only in
  `chrome.storage.local`, not Chrome Sync.
- An optional Nazurin API host and Telegram Bot Token are stored only with
  `chrome.storage.local`. They are not placed in Chrome Sync or sent to the
  developer.
- On enabled `www.pixiv.net` pages, P2 processes the current artwork identifier and requests
  artwork metadata and image resources only after the user hovers an artwork
  long enough to open a preview. These requests go to Pixiv. The browser may
  include the user's existing Pixiv session, but P2 does not read or store the
  user's Pixiv cookies or login credentials.
- On enabled yande.re and Konachan .com/.net listing pages, P2 highlights the hovered
  thumbnail and, after the configured hover delay, requests that artwork's
  metadata from the current site's `/post.json` endpoint and loads its sample
  image from the site or an allowlisted image host (such as files.yande.re).
  Original images are requested only when the user enables original upgrading.
  Normal same-origin requests may include the site's existing browser session;
  P2 does not read or store site cookies or login credentials. Metadata is
  cached only in tab memory. Previews do not require a Nazurin configuration.
- When the user explicitly submits one artwork, or explicitly starts a batch
  submission with `Shift` plus the configured Nazurin shortcut, P2 sends the
  canonical artwork URL for each selected artwork to the user-configured
  Nazurin service. P2 does not send Pixiv cookies, Pixiv login credentials, or
  image data to Nazurin. The Bot Token is used only to construct the endpoint
  required by the user's Nazurin service.
- On Twitter/X main-site pages, P2 reads the hovered tweet's permalink from the page,
  or the current tweet detail or photo viewer URL from the address bar, only when
  the user presses the submission shortcut, and sends its canonical
  Twitter URL to the configured Nazurin service. It does not request tweet
  metadata or image resources, or send Twitter/X cookies, credentials, tweet
  text, or image data. Pending links are held only in memory for the queue.
- On enabled Danbooru listing pages, hovering a thumbnail requests the selected
  work's same-origin `/posts/<id>.json` metadata and loads a preview from
  Danbooru or `cdn.donmai.us`. On Zerochan, P2 requests the selected work's
  same-origin detail page, parses its canonical link and main image elements
  without executing its scripts, and loads images from validated Zerochan hosts.
  Original upgrading, in-tab caching, and session handling follow the same
  rules as the other image-board previews.
- On enabled pixivision articles (`pixivision.net` and `www.pixivision.net`),
  the submission shortcut reads the hovered artwork's Pixiv link and sends only
  its canonical artwork URL to the configured Nazurin service. P2 does not
  fetch artwork metadata or preview images, or send cookies or image data.
  Pending links remain only in the in-memory submission queue.
- On all six core sites, the submission shortcut on a recognized detail
  page selects the current work. Submitted URLs are canonical HTTPS work links
  with tracking removed. Konachan .net links normalize to .com only for
  submission. P2 does not support direct image/CDN page submissions.

P2 does not inspect, retain, or transmit the user's general browsing history.
It processes only the artwork information and selected or currently viewed
artwork links needed for the preview and user-initiated Nazurin features.

## Permissions

P2 requests `https://www.pixiv.net/*` at installation for its core Pixiv preview
feature and enables it initially. No other website is requested by default.
The extension declares no static content scripts.
When a user opens the toolbar popup, `activeTab` allows P2 to identify the current
website. The current-site control requests only that supported HTTPS origin.
Under Nazurin settings, each of the six optional site buttons requests that
platform’s supported exact origins, including listed aliases. Authorize all
requests the finite set of supported website origins in one prompt. None of
these controls requests platform subdomain wildcards. The `scripting`
permission registers packaged scripts only for enabled, granted origins.
Website access permits reading and modifying page content for the disclosed
preview and submission features; it is not technically restricted to artwork links.

Supported websites are limited to Pixiv, Danbooru, yande.re, Konachan,
Zerochan, and Twitter/X, plus pixivision as a supplementary Pixiv submission
entry. Image/CDN pages cannot be enabled. Websites other than
www.pixiv.net require explicit opt-in. On upgrade, obsolete site registrations,
saved selections, and optional grants are removed, preserving any grant shared
with the configured Nazurin server. A temporary opt-in request lets the background complete
registration when Chrome grants access even if the toolbar popup has closed.
Denied or expired requests do not grant access. Failed registration can be retried
without automatically revoking a grant the user already accepted.

P2 uses `storage` for preferences, enabled website choices, and service settings.
A Nazurin server origin is requested as an optional host permission only when
the user saves that host. Remote services must use HTTPS; HTTP is accepted only
for a service on `localhost` or `127.0.0.1`. The manifest's broad optional HTTPS
pattern makes user-chosen service origins eligible for a request; it is never
requested as an all-website grant.

Disabling a website unregisters future injections, closes existing P2 windows,
removes page event listeners and stops pending work. Revoking permission in Chrome
also disables that website. Requests already accepted by Nazurin cannot be undone.
Pixiv page features can be disabled without removing the installation permission;
users can manage its site access through Chrome. Clearing a server configuration
removes its optional grant unless the origin is Pixiv or still enabled as a
website; disabling an optional website likewise preserves a configured
server's grant when both features share the same origin. Removing a shared grant
in Chrome affects both features.

P2 does not request the broad `tabs`, cookies, downloads, notifications, or
browsing-history permissions. It does not download or execute remote code.

## Sharing and retention

- Pixiv, Danbooru, yande.re, Konachan, and Zerochan (including validated image hosts) receive
  the metadata and image requests needed to display their previews.
- Chrome may synchronize general preferences through the user's signed-in
  browser profile.
- A user-configured Nazurin service receives the selected artwork link only
  after an explicit submission action. Nazurin may then download or retain the artwork
  according to the user's own service configuration. Its processing and
  retention are controlled by the user and governed by that service.
- The developer of P2 does not receive this data and does not sell, license, or
  use it for advertising, credit decisions, or any unrelated purpose.

Locally stored extension data is removed when the extension is uninstalled.
The Nazurin settings also provide a clear action that removes the saved host,
Bot Token and verification state. The corresponding grant is released unless
that origin is Pixiv or remains enabled as a website.
Data already received by preview sites, Chrome Sync, Telegram, or a user-configured
Nazurin service is governed by those services and the user's configuration.

## Limited Use

P2 uses and transfers information obtained through Chrome APIs only to provide
or improve its disclosed, user-facing features. Its use of this information
complies with the Chrome Web Store User Data Policy, including the Limited Use
requirements. P2 does not transfer user data for advertising, sell it to data
brokers, or permit the developer or other humans to read it, except where the
user independently chooses to share information when requesting support.

## Security reports

Do not include Bot Tokens or other credentials in public issues. Please use the
repository's private security advisory feature for security-sensitive reports.
