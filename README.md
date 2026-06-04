# ripfullpage

一个基于 Manifest V3 的原生 Chrome 截图扩展，支持全页截图、自定义区域截图、截图编辑和 PNG 下载。

不使用任何框架或构建工具，直接加载项目根目录即可运行。兼容 Chrome、Edge、Brave 等 Chromium 内核浏览器。

## 预览

![ripfullpage preview 1](https://somnusblog.oss-cn-shanghai.aliyuncs.com/images/%E6%88%AA%E5%B1%8F2026-06-04%2013.24.48.png)

![ripfullpage preview 2](https://somnusblog.oss-cn-shanghai.aliyuncs.com/images/%E6%88%AA%E5%B1%8F2026-06-04%2013.24.32.png)

![ripfullpage preview 3](https://somnusblog.oss-cn-shanghai.aliyuncs.com/images/%E6%88%AA%E5%B1%8F2026-06-04%2013.24.03.png)

## 功能

- 全页截图：自动滚动页面并拼接完整截图。
- 自定义截图：拖拽选择当前可见区域进行截图。
- 截图编辑：支持裁剪、画笔、高亮、矩形、箭头、文字、马赛克。
- 历史操作：支持撤销、重做、重置。
- PNG 下载：导出文件名格式为 `ripfullpage-{timestamp}.png`。
- 超长页面保护：对无限滚动或超长页面提供截图上限提示，避免浏览器卡死。
- 浮动元素处理：减少固定导航、悬浮按钮、广告、翻译浮球在全页截图中重复出现。

## 安装

1. 下载或克隆本项目。
2. 打开 Chromium 浏览器扩展管理页：
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本项目根目录。

## 使用

点击浏览器工具栏中的 ripfullpage 图标：

- `全页截图`：自动滚动并拼接页面截图，完成后进入编辑器。
- `自定义截图`：在页面上拖拽选择区域，松开后进入编辑器。

在编辑器中可以进行裁剪、标注、打码、撤销/重做，最后点击 `下载 PNG` 保存图片。

## 项目结构

```text
.
├── manifest.json
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── background/
│   └── service_worker.js
├── content/
│   ├── content_script.js
│   └── content_style.css
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── editor/
    ├── editor.html
    ├── editor.js
    └── editor.css
```

## 技术说明

- Manifest V3
- 原生 JavaScript / HTML / CSS
- 无第三方依赖
- 按需注入 content script
- 使用 `chrome.tabs.captureVisibleTab` 截图
- 使用 `chrome.storage.session` 在截图流程和编辑器之间传递图片数据

## 注意事项

- 浏览器内置页面无法截图，例如 `chrome://extensions`、Chrome Web Store、扩展页面等。
- 无限滚动页面没有稳定的“完整页面”终点，建议使用默认的限制截图模式。
- 超长页面截图会消耗较多内存和时间，完整截图前请确认页面规模。

## License

MIT
