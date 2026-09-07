# P² Privacy Policy

Last updated: 2026-09-06

P² does not collect analytics, telemetry, browsing history, or personal data,
and it does not operate a developer-controlled server.

## Data used by the extension

- Preview preferences and keyboard shortcuts are stored with
  `chrome.storage.sync`, so Chrome may synchronize them through the user's
  signed-in browser profile.
- An optional Nazurin API host and Telegram Bot Token are stored only with
  `chrome.storage.local`. They are not placed in Chrome Sync.
- On Pixiv pages, P² requests artwork metadata and images only when the user
  hovers an artwork long enough to open a preview.
- When the user explicitly submits an artwork to Nazurin, P² sends the
  canonical Pixiv artwork URL to the user-configured Nazurin server. The Bot
  Token is used only to construct that server's API endpoint.

## Permissions

P² runs only on `https://www.pixiv.net/*`. A Nazurin server origin is requested
as an optional host permission only after the user saves that host. P² does not
request access to browser tabs, cookies, downloads, notifications, or browsing
history.

## Data sharing and retention

P² does not sell or share user data. Pixiv receives the normal metadata and
image requests needed for previews. A user-configured Nazurin server receives
an artwork URL only after an explicit button or keyboard action. Retention and
processing by Pixiv, Chrome Sync, Telegram, and the selected Nazurin server are
governed by those services and the user's own configuration.

Removing the extension deletes its locally stored extension data. The Nazurin
settings page also provides a clear action that removes the saved credentials
and the corresponding optional host permission.

## Security reports

Do not include Bot Tokens or other credentials in public issues. Please use the
repository's private security advisory feature for security-sensitive reports.
