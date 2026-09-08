# P² Privacy Policy

Last updated: 2026-09-09

P² does not operate a developer-controlled server, and the developer does not
receive or retain data from the extension. To provide its user-facing features,
the extension processes a limited amount of data on the user's device and
communicates with Pixiv and, when configured by the user, a self-hosted Nazurin
service as described below. P² does not collect analytics or telemetry.

## Data processed by the extension

- Preview preferences and keyboard shortcuts are stored with
  `chrome.storage.sync`, so Chrome may synchronize them through the user's
  signed-in browser profile.
- An optional Nazurin API host and Telegram Bot Token are stored only with
  `chrome.storage.local`. They are not placed in Chrome Sync or sent to the
  developer.
- On Pixiv pages, P² processes the current artwork identifier and requests
  artwork metadata and image resources only after the user hovers an artwork
  long enough to open a preview. These requests go to Pixiv. The browser may
  include the user's existing Pixiv session, but P² does not read or store the
  user's Pixiv cookies or login credentials.
- When the user explicitly submits one artwork, or explicitly starts a batch
  submission with `Shift` plus the configured Nazurin shortcut, P² sends the
  canonical Pixiv artwork URL for each selected artwork to the user-configured
  Nazurin service. P² does not send Pixiv cookies, Pixiv login credentials, or
  image data to Nazurin. The Bot Token is used only to construct the endpoint
  required by the user's Nazurin service.

P² does not inspect, retain, or transmit the user's general browsing history.
It processes only Pixiv artwork information needed for the preview and
user-initiated Nazurin features.

## Permissions

P² runs only on `https://www.pixiv.net/*`. It uses the `storage` permission for
the settings described above. A Nazurin server origin is requested as an
optional host permission only when the user saves that host. Remote Nazurin
services must use HTTPS; HTTP is accepted only for a service on `localhost` or
`127.0.0.1`. Clearing the Nazurin configuration also removes the corresponding
optional host permission.

P² does not request access to browser tabs, cookies, downloads, notifications,
or browsing history, and it does not download or execute remotely hosted code.

## Sharing and retention

- Pixiv receives the metadata and image requests needed to display previews.
- Chrome may synchronize general preview preferences through the user's signed-in
  browser profile.
- A user-configured Nazurin service receives an artwork URL only after an
  explicit submission action. Nazurin may then download or retain the artwork
  according to the user's own service configuration. Its processing and
  retention are controlled by the user and governed by that service.
- The developer of P² does not receive this data and does not sell, license, or
  use it for advertising, credit decisions, or any unrelated purpose.

Locally stored extension data is removed when the extension is uninstalled.
The Nazurin settings also provide a clear action that removes the saved host,
Bot Token, verification state, and corresponding optional host permission.
Data already received by Pixiv, Chrome Sync, Telegram, or a user-configured
Nazurin service is governed by those services and the user's configuration.

## Limited Use

P² uses and transfers information obtained through Chrome APIs only to provide
or improve its disclosed, user-facing features. Its use of this information
complies with the Chrome Web Store User Data Policy, including the Limited Use
requirements. P² does not transfer user data for advertising, sell it to data
brokers, or permit the developer or other humans to read it, except where the
user independently chooses to share information when requesting support.

## Security reports

Do not include Bot Tokens or other credentials in public issues. Please use the
repository's private security advisory feature for security-sensitive reports.
