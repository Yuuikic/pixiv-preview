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

新增 Nazurin 站点时，先确认上游服务端支持，更新 `src/nazurin-sites.js` 中的固定规则，再同步更新清单的页面匹配和权限、中英文说明及测试。通用适配器不注入现有 Pixiv/X/pixivision 专用范围，也不在图片/CDN 页面注入。测试包括临时本地 HTTP 模拟服务，需要允许监听 127.0.0.1；它只验证提交协议，不代表真实收藏或 Telegram 通知完成。

打包会重新生成 `dist/`，产物为 `dist/P2-vX.Y.Z.zip`。压缩包只包含运行文件、许可证、隐私政策和第三方声明，不包含测试与开发文件。

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

Before adding a Nazurin site, confirm upstream server support, update the fixed rules in `src/nazurin-sites.js`, and synchronize manifest matches/permissions, both READMEs, and tests. Generic scripts must not overlap specialized Pixiv/X/pixivision matches or run on image/CDN pages. Tests include a temporary HTTP mock server that requires listening on 127.0.0.1; it verifies submission transport, not actual collection or Telegram delivery.

Packaging recreates `dist/` and produces `dist/P2-vX.Y.Z.zip`. The archive contains only runtime files, the license, privacy policy, and third-party notices. Tests and development files are excluded.

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
