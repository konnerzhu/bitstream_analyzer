<p align="center">
  <img src="../public/og.png" alt="BitScope 多编码码流分析工具" width="900">
</p>

<h1 align="center">BitScope</h1>

<p align="center">
  一款本地运行的 H.264/AVC、H.265/HEVC、H.266/VVC 和 AV1 可视化码流分析工具。
</p>

<p align="center">
  <a href="https://github.com/konnerzhu/bitstream_analyzer/releases"><strong>下载桌面 GUI</strong></a>
  · <a href="../README.md">English</a>
  · 简体中文
</p>

<p align="center">
  <img alt="支持的编码格式" src="https://img.shields.io/badge/编码-AVC%20%7C%20HEVC%20%7C%20VVC%20%7C%20AV1-1f6feb?style=flat-square">
  <img alt="本地处理" src="https://img.shields.io/badge/处理方式-100%25%20本地-2ea44f?style=flat-square">
</p>

BitScope 在本地解析视频裸码流，并将码流结构与同步解码画面一起展示。文件不会离开你的设备。

## 下载

**[从 GitHub Releases 下载 Windows 或 macOS 版 BitScope](https://github.com/konnerzhu/bitstream_analyzer/releases)**

| 平台 | 安装包 | 原生解码 |
|---|---|---|
| Windows x64 | NSIS `.exe` 安装程序 | FFmpeg 解码 H.264，dav1d 解码 AV1 |
| macOS Apple Silicon | `.dmg` 和 `.zip` | FFmpeg 解码 H.264，dav1d 解码 AV1 |

桌面安装包可独立运行，用户无需安装 Node.js、npm、FFmpeg 或 dav1d。未签名构建可能触发 macOS Gatekeeper 或 Windows SmartScreen 提示。

## 功能

- 码流元数据及可导航的 NAL/OBU 时间线
- 同步显示解码画面与残差画面
- 宏块、CTU 和 Superblock 网格及点击选择
- 鼠标滚轮缩放、拖动画面、适应窗口和精确块选择
- H.264 与 AV1 帧内模式名称和方向路径
- 帧间预测模式及运动矢量覆盖层
- 桌面应用内的 H.264/AV1 原生解码
- 英文和简体中文界面

## 支持的输入

| 格式 | 分析范围 |
|---|---|
| H.264 Annex-B（`.h264`、`.264`、`.avc`） | NAL/SPS/Slice、CAVLC I/P 宏块、帧内模式、分区和运动矢量 |
| H.265 Annex-B（`.h265`、`.265`、`.hevc`） | VPS/SPS/PPS、码流信息、层级、Temporal ID 和 CTU 网格 |
| H.266 Annex-B（`.h266`、`.266`、`.vvc`） | NAL 结构分析和 CTU 网格 |
| AV1 低开销 OBU（`.av1`、`.obu`） | Sequence/Frame/Tile 元数据和 Superblock 网格 |
| AV1 IVF（`.ivf`） | 帧记录、叶子块、模式、变换、Skip 状态和运动矢量 |

目前尚未提供 MP4、MOV、MKV、WebM 和 MPEG-TS 解复用，请先提取视频裸码流。单个输入限制为 200 MB，最多解析 100,000 个 NAL/OBU 单元。

## 使用方法

1. 打开 BitScope，或将支持的码流拖入页面。
2. 从时间线选择帧、NAL 或 OBU 单元。
3. 选择解码画面或残差画面。
4. 开启块、帧内模式或帧间运动矢量覆盖层，并选择块查看详情。
5. 滚动鼠标缩放、拖动画面，或使用 **Fit** 重置视图。

浏览器画面取决于 WebCodecs 支持。桌面应用为 H.264 和 AV1 提供随包原生解码器；VVC 目前仅支持分析。

## 从源码运行

需要 Node.js 22.13 或更高版本及 npm。

```bash
git clone https://github.com/konnerzhu/bitstream_analyzer.git
cd bitstream_analyzer
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，中文界面位于 [`/zh-CN`](http://localhost:3000/zh-CN)。

常用命令：

```bash
npm test                 # 生产构建和测试套件
npm run lint             # 静态检查
npm run desktop:dev      # 原生解码器及 Electron GUI
npm run desktop:dist:mac # macOS arm64 DMG 和 ZIP
npm run desktop:dist:win # Windows x64 安装程序
```

生成文件和安装包位于 `.artifacts/`。发行构建使用带固定校验值的 FFmpeg 7.1.5 与 dav1d 1.5.4 源码。

## 项目结构

| 路径 | 用途 |
|---|---|
| `app/` | 分析器 UI、解析器、覆盖层、本地化和残差渲染 |
| `desktop/` | 沙箱化 Electron 宿主及受限原生解码桥 |
| `native/` | FFmpeg H.264 与 dav1d AV1 适配器 |
| `public/` | 图片资源及带资源限制的 AV1 inspection Worker |
| `tests/` | 解析器、解码器、导航、渲染和集成测试 |
| `config/` | 桌面 Vite 与 Drizzle 配置 |
| `.artifacts/` | 已忽略的构建、原生工作文件、应用和安装包 |

## 当前限制

- H.264 浏览器端子块解析目前面向逐行 8-bit 4:2:0 CAVLC I/P Slice；CABAC、B Slice、FMO 和隔行/MBAFF 仍需深入解析。
- AV1 详细块检查目前要求 IVF；裸 OBU 仍保留结构化 Superblock 网格。
- HEVC 和 VVC 当前提供结构网格，尚未熵解码子分区。
- 真实预测、系数、去块前像素和解码器原生残差平面仍需增加解码器检查钩子。

## 参与贡献

欢迎提交问题、解析修正、界面改进和可复现的最小测试码流。请勿提交受版权保护或包含敏感信息的媒体。提交 Pull Request 前请运行 `npm run lint` 和 `npm test`。
