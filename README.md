# Codex Live Wallpaper

动态壁纸 · Live Canvas，为 Codex 桌面应用添加视频背景、在线图库和本地壁纸。

**这是 Codex++ 拓展，不是原版 Codex 的独立安装包，也不是浏览器拓展或 Windows 桌面壁纸程序。** 请先安装 Codex++，并通过它启动或挂载 Codex。

- 当前版本：`1.2.0`
- [完整中文部署与使用文档](docs/使用指南.md)
- [下载拓展安装包](https://github.com/luojinghao/codex-live-wallpaper/releases/latest)
- [反馈问题](https://github.com/luojinghao/codex-live-wallpaper/issues)

## 安装到 Codex

1. 安装 [Codex 桌面版](https://developers.openai.com/codex/app/) 和 [Codex++](https://github.com/BigPizzaV3/CodexPlusPlus/releases)，从 Codex++ 启动或挂载 Codex。
2. 在 Codex++ 管理器的「拓展 → 社区拓展」中刷新，搜索 `codex-live-wallpaper` 或 `动态壁纸`，核对作者为 `luojinghao` 后安装。
3. 安装后在「本地拓展」启用「动态壁纸 · Live Canvas」，必要时点击「热重载拓展」。社区安装默认不会自动启用。
4. 在 Codex 左侧图标栏点击「动态壁纸」，或输入 `/wallpaper` 打开图库。

社区索引可能延迟约 10 分钟。搜索不到时，可从 Releases 下载 `live-wallpaper-studio-v1.2.0.zip`，按[手动安装步骤](docs/使用指南.md#手动安装)部署。无需 `npm install`、构建或启动 Web 服务。

## 功能

- 五个视频源：Mixkit、MoeWalls、MotionBgs、WallpaperWaifu、LiveWallpapers4Free。
- 聚合浏览、分类筛选、英文关键词搜索、分页和收藏。
- 自然风景、人文生活、城市建筑、抽象几何、动漫、游戏等分类，具体分类取决于数据源。
- 导入本地 MP4、WebM、GIF 和图片，或应用媒体直链；本地导入上限为 256 MB。
- 视频画质选择、完整显示或裁切填充、背景遮罩、画面模糊和玻璃效果调节。
- 暂停、播放速度、定时随机轮换、窗口不可见时暂停，并尊重系统减少动态效果设置。
- 三个离线内置场景：雨幕、星空、代码之雨。

高清选项只有原站提供且可访问时才有效，失败时会回退并提示。Mixkit 是实拍或素材来源，其他壁纸站的风景分类可能包含插画。部分视频不是无缝循环。

## 环境与边界

当前已有 Windows 上的运行记录；macOS 的目录安装方式按 Codex++ 官方规范说明，尚未在本项目实机验证。不承诺所有 Codex / Codex++ 版本兼容，原生界面改版可能影响背景透明效果。

拓展使用 Codex++ 的页面脚本和 Node 常驻后台；正常安装优先使用 Codex 随附的 Node，通常不需要单独安装 Node.js。仅开发与测试需要 Node.js 22 或更新版本。

它不需要额外 API Key、不调用模型、不修改模型供应商或对话请求。后台会访问图库和媒体地址，并将选中的媒体缓存到本机；本地导入会复制一份媒体文件。拓展后台以当前用户权限运行，请在安装前审阅源码，只启用信任的版本。

## 项目结构

```text
codexpp.json          拓展清单与默认配置
renderer.js           Codex 页面、背景与播放控制
backend/main.mjs      图库解析、媒体下载缓存与本地导入
docs/使用指南.md      部署、使用、故障排查与卸载
tests/backend.test.mjs  无网络后端回归测试
scripts/             检查与打包工具
```

仓库不包含下载的视频、第三方网页快照、私人配置或本机测试缓存。

## 开发与打包

```powershell
npm run check
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package.ps1
```

没有 npm 依赖，不需要先运行 `npm install`。ZIP 位于 `dist/`，压缩包根目录直接包含 `codexpp.json`。`package.ps1` 只打包仓库中的发布文件，不会安装、启用或修改本机已装拓展。

测试使用合成网页和模拟网络，不代表第三方网站始终可用。真实在线图库、解码与 Codex 界面效果需要在 Codex++ 中验证。

## 版权与许可

本仓库未指定开源许可证，公开可见不代表获得任意再分发或商用授权；需要再使用代码时请先联系作者确认。

第三方网站的视频、图片、标题与商标属于各自权利人，本仓库不分发这些媒体，也不授予其使用许可。请遵守原站条款和每个素材的许可；不要绕过登录、付费、验证码或访问限制。详见[素材与隐私说明](docs/使用指南.md#素材与隐私)。

Codex / Codex++ 名称用于说明兼容平台；本项目不是 OpenAI 或 Codex++ 官方出品。
