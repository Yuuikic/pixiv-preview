# 开发与发布 / Development and releases

[简体中文](#简体中文) · [English](#english)

## 简体中文

用户使用说明见 [README.md](README.md)。

### 本地开发与校验

项目没有运行时依赖，无需构建。使用 Node.js 20 或更新版本；打包还需要系统提供 `zip` 命令。可在 Chrome 的 `chrome://extensions/` 中启用开发者模式，加载项目根目录进行调试。修改扩展后，重新加载扩展并刷新 Pixiv 页面。

```sh
npm test
npm run check
npm run package
```

测试验证扩展行为；发布检查验证版本元数据、必要文件、JavaScript 语法，以及站点注册表与清单权限的一致性。打包前也会执行发布检查。

`src/nazurin-sites.js` 明确定义六站范围：Pixiv、Danbooru、yande.re、Konachan、Zerochan、Twitter/X。另保留 pixivision 文章中的 Pixiv 链接提交入口。不要镜像 Nazurin 的完整站点规则。只接受这六站的 HTTPS 作品详情链接，并去除追踪参数；Konachan .net → .com 仅用于提交。六站详情页 D 优先当前作品，列表页不兜底提交当前 URL。五站预览保留 Shift+D。

`src/site-access.js` 管理本机启用的精确 origin、授权检查和动态内容脚本注册；`scriptsForUrl()` 选择一个适配器。Manifest 只保留 `https://www.pixiv.net/*` 核心固定权限，不声明静态 `content_scripts`。Pixiv 默认启用且初始化只执行一次，显式停用后不得自动恢复。仅在用户点击时请求授权：当前网站入口仅请求当前 origin，六站按钮请求对应平台的精确 origins，“全部授权”合并所有受支持 origins；不申请平台通配符；`activeTab` 只用于弹窗识别当前网站，`scripting` 用于按需注册本地脚本。启用时先向后台发送带 ID 的持久请求，同时在点击处理器内直接申请权限，不要在权限调用前 await。后台通过授权事件、准备消息及启动对账完成注册，不能依赖 popup 的授权返回回调；拒绝时取消，超时后清理。服务端授权没有对应网站启用请求时不得启用页面。`src/site-session.js` 在停用/撤权时清理已有事件和窗口；后台独立检查每次请求的页面授权。服务端与页面共用 origin 时，只在两者都不需要时释放授权。

本地验证：重新加载扩展 → 打开目标网站 → P2 弹窗启用当前网站 → 刷新页面。测试拒绝授权、启用、重启恢复、停用、Chrome 撤权、API Host 与页面同域和重新启用；保留预览、原站收藏、单项 D 和 Shift+D 回归。测试使用本地 HTTP 模拟服务，需要允许监听 127.0.0.1；不代表真实收藏或 Telegram 通知完成。

打包会重新生成 `dist/`，产物为 `dist/P2-vX.Y.Z.zip`。压缩包只包含运行文件、许可证、隐私政策和第三方声明，不包含测试与开发文件。

设置页与弹窗均按浮窗行为、快捷键、Nazurin 三类分组，网站授权放在 Nazurin 内；Pixiv 默认启用。其余六站采用 3 列 × 2 行按钮，支持“全部授权”。`options/onboarding.js` 复用同一组控件提供三步引导，进度只存本机，可跳过、恢复及重新打开；不得复制表单或把 Nazurin 变为必需项。

### 共享预览核心与站点适配器

- `src/preview-core.js`：悬停生命周期、缩略图高亮、LRU 元数据缓存、图片加载/取消、浮窗布局、留驻/拖动/缩放/排列、快捷键、Esc 历史、Nazurin 串行队列和设置同步。核心不按域名分支，也不硬编码站点 API。
- `src/content.js`：Pixiv 适配器，负责作品链接、Pixiv 元数据协议、图片域名验证、收藏按钮识别及收藏状态。文件名保留以延续现有入口。
- `src/board-preview.js`：Danbooru、yande.re、Konachan、Zerochan 适配器，共享加载超时、取消、图片域名校验及详情页目标选择。前三站读取同源 JSON；Zerochan 读取单个详情页的静态图片元素，不执行获取的 HTML。无原站收藏能力。
- `src/twitter.js`、`src/pixivision.js` / `src/link-submit.js`：Twitter/X 与 pixivision 的链接选择、提交队列及反馈浮窗，不加载图片预览。每个页面只注册一个快捷键入口。

适配器通过 `P2PreviewCore.start(adapter)` 注册。必需项为 `id`、`anchorSelector`、`workFromAnchor`、`safeImageUrl`、`load` 和 `submissionMessage`。作品统一为 `{key, id, url}`，其中 `key` 带站点命名空间（如 `pixiv:42`、`yandere:42`），避免缓存、队列和留驻窗口串站。`load(work, signal)` 返回 `{pages: [{regular, original, width, height}], degraded}` 并响应取消；无权限/网络/格式错误不得绕过验证或永久停留在加载状态。

收藏通过可选 `bookmark` 能力提供；即时高亮、最小缩略图尺寸和详情页提交策略也由适配器声明。新增图站优先添加适配器与对应测试，不复制共享窗口/队列实现。API/图片只允许已审查的 HTTPS 来源，新增请求行为同时更新隐私说明。保留 Pixiv 的多页、原站收藏及 `Shift+D` 批量提交流程。

### 发布版本

1. 同步更新 `manifest.json` 与 `package.json` 的版本号。README 不维护固定版本号；用户行为变化时同步更新中英文说明。
2. 运行上述测试、检查和打包命令，检查生成的压缩包。
3. 提交发布内容，然后创建与清单版本一致的 `vX.Y.Z` 标签并推送到 GitHub。以下命令从清单读取版本；执行前确认 `origin` 指向发布仓库。

```sh
release_version=$(node -p "require('./manifest.json').version")
npm run check -- --tag "v${release_version}"
git tag -a "v${release_version}" -m "P2 v${release_version}"
git push origin HEAD
git push origin "v${release_version}"
```

GitHub Actions 会在分支推送和拉取请求时运行测试、检查并打包。推送版本标签后，还会校验标签与清单版本一致，并在验证成功后创建 GitHub Release、附上扩展 ZIP。

## English

For user instructions, see [README.en.md](README.en.md).

### Local development and validation

The project has no runtime dependencies and needs no build. Use Node.js 20 or newer; packaging also requires the system `zip` command. To develop locally, enable Developer mode at Chrome’s `chrome://extensions/` and load the project root. After editing the extension, reload it and refresh your Pixiv pages.

```sh
npm test
npm run check
npm run package
```

Tests verify extension behavior. The release check validates version metadata, required files, JavaScript syntax, and consistency between the site registry and manifest permissions. Packaging also runs the release check first.

`src/nazurin-sites.js` defines P2's six-site scope: Pixiv, Danbooru, yande.re, Konachan, Zerochan, and Twitter/X. Retain pixivision as a supplementary Pixiv link-submission entry. Do not mirror Nazurin's entire parser catalogue. Accept canonical HTTPS work-detail links only; strip tracking and normalize Konachan .net to .com only for submission. Detail-page D selects the current work on all six sites; list pages never submit their own URL. Preserve Shift+D on all five preview sites.

`src/site-access.js` owns local enabled origins, grant checks, and dynamic registrations. `scriptsForUrl()` selects one adapter. Keep only `https://www.pixiv.net/*` as a required core origin, with no static `content_scripts`. Initialize Pixiv once and preserve an explicit disable. From a user gesture, the current-site control requests one exact origin, a site button requests that platform’s exact origins, and Authorize all combines all supported origins; never request wildcard hosts. `activeTab` identifies the current website; `scripting` registers packaged files. Dispatch a durable request with an ID to the background before opening the native prompt, without awaiting before `permissions.request` and losing user activation. Both preparation and grant events reconcile persisted requests, independently of the popup surviving. Cancel denied requests and expire abandoned ones. Reconcile on startup and updates without enabling optional websites from unrelated server grants. `src/site-session.js` disposes existing page listeners/windows after disable or revocation; the background rechecks authorization per request. Preserve a shared website/server grant until neither feature needs it.

Local validation: reload the extension, open a website, enable it from the P2 popup, then refresh. Cover denied grants, activation, restart, disable, Chrome revocation, shared server origins and reactivation, alongside preview/bookmark/D/Shift+D regressions. Local mock HTTP tests require loopback listening and do not prove collection or Telegram delivery.

Packaging recreates `dist/` and produces `dist/P2-vX.Y.Z.zip`. The archive contains only runtime files, the license, privacy policy, and third-party notices. Tests and development files are excluded.

Both settings surfaces group preview behavior, shortcuts and Nazurin, with website access inside Nazurin. The three-step guide starts with preview behavior; Pixiv is enabled by default. Six optional site buttons form a 3 × 2 grid, with an Authorize all action. `options/onboarding.js` reuses those forms for resumable, skippable first-use setup. Progress is local; never duplicate controls or require Nazurin.

### Shared preview core and site adapters

`src/preview-core.js` owns hover/highlight lifetime, metadata caching, image loading/cancellation, window layout/pinning/dragging/resizing/arrangement, keyboard and Escape handling, the Nazurin queue, and settings synchronization. It contains no site hostname/API branches. `src/content.js` is the Pixiv adapter, including native bookmark discovery/state; `src/board-preview.js` handles Danbooru, yande.re, Konachan, and Zerochan without native bookmarks. It fetches same-origin JSON for the first three and parses inert detail-page HTML for Zerochan. `src/twitter.js` and `src/pixivision.js` share `src/link-submit.js` for submission and feedback without preview code. Each page has one shortcut owner.

Register adapters with `P2PreviewCore.start(adapter)`. Required members are `id`, `anchorSelector`, `workFromAnchor`, `safeImageUrl`, `load`, and `submissionMessage`. A work is `{key, id, url}` with a site-namespaced key; `load(work, signal)` returns `{pages: [{regular, original, width, height}], degraded}` and honors cancellation. Distinguish user cancellation from timeouts so loading always terminates. Optional `bookmark`, thumbnail highlighting, size limits, and shortcut policies extend capabilities without copying core logic. New sites need adapter tests, reviewed HTTPS API/image origins, matching privacy disclosures, and regression coverage for Pixiv multipage/native bookmarks/Shift+D.

### Publish a version

1. Update the version in both `manifest.json` and `package.json`. The READMEs do not track a fixed version; update both languages when user-facing behavior changes.
2. Run the test, check, and package commands above, then inspect the archive.
3. Commit the release changes, create a `vX.Y.Z` tag matching the manifest version, and push to GitHub. The commands below read the version from the manifest. Confirm that `origin` points to the release repository before running them.

```sh
release_version=$(node -p "require('./manifest.json').version")
npm run check -- --tag "v${release_version}"
git tag -a "v${release_version}" -m "P2 v${release_version}"
git push origin HEAD
git push origin "v${release_version}"
```

GitHub Actions runs tests, validation, and packaging on branch pushes and pull requests. A version tag push also checks that the tag matches the manifest version. Once validation passes, it creates a GitHub Release with the extension ZIP attached.


### Settings preview demo

`options/timing-demo.js` provides a local-logo adapter to `P2PreviewCore`; use the actual core and `src/preview.css` for demo timing, pinning, and animation. Adapter capabilities hide the toolbar and disable link copying/Nazurin, including status queries. The demo reads current form values before interactions and permits pinning in the shortcut step and normal settings. Keep it fixed outside setup sections so it survives the first two steps; close windows when entering Nazurin or losing the wide layout. `options/settings-motion.js` shares cancellable fade transitions for categories and hints and honors reduced motion.
