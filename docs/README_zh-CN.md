<p align="center">
  <img src="../public/og.png" alt="BitScope 多编码码流分析工具" width="900">
</p>

<h1 align="center">BitScope</h1>

<p align="center">
  <strong>让压缩视频码流清晰可见。</strong><br>
  在浏览器中查看 AVC、HEVC、VVC 和 AV1 的结构与解码画面。
</p>

<p align="center">
  <a href="../README.md">English</a> · 简体中文
</p>

<p align="center">
  <img alt="支持的编码格式" src="https://img.shields.io/badge/编码-AVC%20%7C%20HEVC%20%7C%20VVC%20%7C%20AV1-1f6feb?style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white">
  <img alt="本地处理" src="https://img.shields.io/badge/处理方式-100%25%20本地-2ea44f?style=flat-square">
</p>

## BitScope 是什么？

BitScope 是一款可视化 H.264/AVC、H.265/HEVC、H.266/VVC 和 AV1 裸码流分析工具，适合视频开发者、编解码工程师、学生，以及所有希望了解压缩视频内部结构的人。

导入 Annex-B NAL 码流或低开销格式 AV1 OBU 后，BitScope 会完全在本地解析码流，展示媒体信息和编码单元布局；浏览器通过 WebCodecs 支持相应编码时，还可同步显示解码画面，并让当前帧与语法信息保持联动。文件不会上传，也不依赖服务端分析。

## 功能亮点

| | 功能 | 可查看的信息 |
|---|---|---|
| **01** | 码流概览 | Profile、Level、编码/显示尺寸、帧率、色度格式和位深 |
| **02** | NAL / OBU 时间线 | 编码相关类型、层级、Temporal ID、字节偏移、负载和头部大小 |
| **03** | 解码画面 | 逐帧显示，并与当前访问单元保持同步 |
| **04** | 编码块视图 | 随编码格式切换宏块、CTU 或 Superblock 网格，支持点击选择和坐标查看 |
| **05** | 熵解码块 | 显示 H.264 CAVLC 宏块真实分区/帧内方向，以及 AV1 IVF 叶子块、帧内模式标称方向、变换尺寸和 Skip 状态 |
| **06** | 语法详情 | 序列参数和单元头字段，以及大小受控的十六进制数据视图 |
| **07** | 本地隐私 | 所有分析均在浏览器内完成，原始码流不会上传 |
| **08** | 原生解码适配器 | 提供版本化 H.264/AV1 C ABI，可读取真实解码平面与解码器元数据 |

## 输入格式

| 格式 | 状态 | 说明 |
|---|:---:|---|
| H.264 Annex-B 裸码流（`.h264`、`.264`、`.avc`） | ✅ | 支持 3 字节和 4 字节起始码 |
| H.265 Annex-B 裸码流（`.h265`、`.265`、`.hevc`） | ✅ | VPS/SPS/PPS、VCL 单元、层级和 CTU 大小 |
| H.266 Annex-B 裸码流（`.h266`、`.266`、`.vvc`） | ✅ | 支持结构分析；浏览器暂不能解码 |
| 低开销 AV1 OBU（`.av1`、`.obu`） | ✅ | 带长度 OBU、Sequence Header、帧、Tile 和元数据 |
| AV1 IVF（`.ivf`） | ✅ | DKIF 文件头、尺寸、时间基、帧记录及内部 OBU |
| MP4 / MOV | — | 需要先提取对应的裸码流 |
| MKV / WebM | — | 暂未实现容器解复用 |
| MPEG-TS | — | 暂未实现容器解复用 |
| 长度前缀 AVC/HEVC/VVC | — | 当前要求 Annex-B 输入 |

当前单个文件上限为 **200 MB**。NAL/OBU 单元解析数量最多为 **100,000 个**，以避免异常或超大码流导致页面失去响应。

## 分析范围

| 编码格式 | 当前支持内容 |
|---|---|
| H.264 / AVC | SPS Profile、Level、尺寸、帧率、色度/位深；NAL 和 Slice 摘要；CAVLC I/P 宏块类型、CBP、ΔQP、真实分区及已解码的 Intra 4×4/8×8/16×16 预测模式 |
| H.265 / HEVC | VPS/SPS/PPS、Profile、Level、尺寸、色度/位深、层级/Temporal ID、IRAP 帧，以及 SPS 声明的 CTU 大小 |
| H.266 / VVC | NAL 类型、VPS/SPS/PPS/APS/PH/SEI、层级/Temporal ID、随机访问单元和声明的 CTU 大小 |
| AV1 | OBU 分帧、Sequence Header、帧类型、Tile/元数据、64/128 Superblock，以及 IVF 熵解码叶子块的尺寸、帧内模式名称/标称方向、变换尺寸和 Skip 状态 |
| 画面 | 浏览器具备对应能力时通过 WebCodecs 解码 AVC、HEVC 或 AV1；VVC 仅进行结构分析 |

> [!NOTE]
> H.264 CAVLC I/P 分区来自真实语法解析；不支持的 H.264 模式及其他编码仍仅显示结构网格。当 VVC 码流缺少 Picture Header/AUD 时，帧数可能是近似值。

## 快速开始

### 从源码运行

环境要求：**Node.js 22.13 或更高版本**、npm。

```bash
git clone git@github.com:konnerzhu/bitstream_analyzer.git
cd bitstream_analyzer
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，将受支持的裸码流拖入页面，或从磁盘选择文件。

### 安装桌面 GUI

macOS Apple Silicon 版本为完整的 `.dmg` 安装包：打开后将 **BitScope** 拖到“应用程序”即可。Windows x64 版本为 NSIS `.exe` 安装程序：运行后可选择安装目录并完成安装向导。两个安装包均包含 H.264 与 AV1 原生解码器，终端用户无需安装 Node.js、npm、FFmpeg 或 dav1d。

当前本地构建尚未签名。macOS 可能需要在 Finder 中右键选择“打开”，Windows Defender SmartScreen 可能提示发布者未知。公开发布时应使用相应平台的开发者证书签名，macOS 版本还应完成公证。

### 原生桌面开发模式

安装 FFmpeg 与 dav1d 开发库后，启动 Electron 宿主：

```bash
npm run desktop:dev
```

该命令会构建两个原生适配器、启动或复用本地 UI 服务，并通过受限的原生解码桥打开同一套界面。H.264 画面由 FFmpeg 解码，AV1 画面由 dav1d 解码；原生桥或解码器不可用时自动回退到 WebCodecs。

维护者可使用以下命令生成独立的 macOS arm64 DMG/ZIP 或 Windows x64 NSIS 安装程序：

```bash
npm run desktop:dist:mac
npm run desktop:dist:win
```

打包流程使用固定 SHA-256 校验的 FFmpeg 7.1.5 与 dav1d 1.5.4 源码，为目标平台构建原生解码程序，并把产物写入 `.artifacts/release/`。Windows 交叉构建需要 MinGW-w64、Meson、Ninja、NASM、CMake 与 pkg-config。

## 使用方法

1. 导入 AVC/HEVC/VVC Annex-B 码流、AV1 OBU 码流或 AV1 IVF 文件。
2. 在时间线中选择帧、NAL 或 OBU 单元。
3. 查看同步的解码画面与语法面板。
4. 开启编码块覆盖层，点击块即可查看地址、坐标、边界及可用的 Slice 归属。分析受支持的 H.264 CAVLC 码流或 AV1 IVF 时，可通过 **帧内模式** 按钮单独显示或隐藏标称方向箭头。
5. 在画面上滚动鼠标滚轮，可在 **50%～800%** 范围内缩放；点击 **Fit** 可恢复为适应窗口大小。

如果浏览器不支持 WebCodecs 或没有对应的解码器，码流解析功能仍然可用，但无法显示解码画面。H.266/VVC 目前没有 WebCodecs 解码路径。

## 项目结构

| 路径 | 用途 |
|---|---|
| `app/Analyzer.tsx` | 分析器 UI、帧解码、导航、缩放和编码块交互 |
| `app/codecs.ts` | 编码格式检测及 HEVC、VVC、AV1 结构解析 |
| `app/h264.ts` | Annex-B 扫描、位读取、防竞争字节移除和 H.264 语法解析 |
| `app/h264-subblocks.ts` | 带边界保护的 H.264 SPS/PPS/Slice 与 CAVLC 宏块/子分区解析 |
| `native/h264-inspector/` | 基于 FFmpeg 的 H.264 原生解码适配器、检查 ABI 与 JSONL 诊断 CLI |
| `native/av1-decoder/` | 基于 dav1d 的 AV1 IVF/OBU 解码适配器、检查 ABI 与 JSONL 诊断 CLI |
| `desktop/` | 沙箱化 Electron 宿主、受限 IPC preload 与有资源上限的原生解码执行器 |
| `config/` | 桌面端 Vite 与 Drizzle 工具配置 |
| `docs/` | 本地化及辅助文档 |
| `.artifacts/` | 已忽略的网页、原生程序、桌面应用、安装包与打包产物 |
| `app/analyzer.css` | 响应式分析界面与视觉样式 |
| `public/` | 项目与应用图片资源 |

## 开发命令

```bash
npm run dev      # 启动本地开发服务器
npm run build    # 生成生产构建
npm run lint     # 执行静态检查
npm run native:h264:build  # 构建可选的原生 H.264 适配器
npm run native:av1:build   # 构建可选的原生 AV1/dav1d 适配器
npm run desktop:dev        # 构建原生适配器并打开桌面 GUI
npm run desktop:dist:mac   # 生成独立的 macOS arm64 DMG 与 ZIP
npm run desktop:dist:win   # 生成独立的 Windows x64 NSIS 安装程序
```

项目使用 TypeScript、React 19 和 vinext 开发。解析和解码逻辑有意保留在客户端，以便未来复用到桌面应用中。

### 原生 H.264 检查后端

第一阶段原生解码后端位于 `native/h264-inspector`。它通过带资源上限、版本化的 C ABI 包装 libavcodec，并对每个解码帧调用观察者回调。当前回调可提供真实的最终 YUV 平面与 FFmpeg 导出的运动矢量。ABI 已为预测像素、有符号残差、变换系数和去块滤波前像素预留槽位及能力位；在固定版本的 FFmpeg 分支加入对应重建路径钩子以前，这些能力位保持关闭。

Electron 桌面宿主现已通过受限 IPC 桥把该 ABI 接入解码画布。普通浏览器路由仍使用 WebCodecs。依赖、直接 CMake 命令及发行许可证要求见 `native/h264-inspector/README.md`。

### 原生 AV1 解码后端

`native/av1-decoder` 通过另一层带资源上限、版本化的 C ABI 包装 dav1d 1.5.1 或更高版本。它支持 IVF 与裸 low-overhead OBU 输入，可提供真实解码 YUV 平面、8/10/12-bit 布局、帧类型、显示尺寸、时间戳、空间/时间层、色彩元数据及显式 Film Grain 控制。为便于检查重建结果，默认关闭 Film Grain。

该解码器是对 libaom inspection Worker 的补充，而不是替代：dav1d 为桌面 GUI 提供真实解码画面，libaom 继续提供逐块划分、模式、变换及运动矢量矩阵。

## 已知限制

- 当前支持 Annex-B NAL 裸码流、低开销 AV1 OBU 和 AV1 IVF；尚不包含通用容器解复用。
- 浏览器画面依赖 WebCodecs 与操作系统可用的编解码实现。桌面宿主的 H.264 使用 FFmpeg、AV1 使用 dav1d；HEVC 仍使用 WebCodecs，VVC 仅支持分析。
- 浏览器端 H.264 子块解析当前支持逐行 8-bit 4:2:0 CAVLC I/P Slice，包括亮度帧内预测模式和 List-0 运动矢量；DC 与 Plane 会标记为非方向模式。CABAC、B Slice、FMO、隔行/MBAFF 和残差系数数值会明确显示为不支持，不会通过推测填充。
- 原生 H.264 适配器当前导出最终解码像素和运动矢量。真实预测、残差、系数和去块滤波前画面需要后续补丁解码器钩子，不会从最终画面反推生成。
- 原生 AV1/dav1d 适配器当前导出最终像素与帧元数据。dav1d 公共 API 不提供逐块残差、系数、预测或运动矢量矩阵，因此这些覆盖层仍由 libaom inspection 提供。
- AV1 子块 inspection 当前要求 IVF 容器；裸 OBU 仍显示顶层 Superblock 网格。
- AV1 方向箭头表示模式的标称角度；当前随包提供的 inspection 数据尚未输出每个块可选的 angle delta。
- AV1 inspection 在独立 Worker 中运行，并限制为最大 64 MB 输入、单帧 20 秒、32 MB JSON 结果和受控的矩阵/块数量。
- HEVC 和 VVC 目前仍只显示顶层编码单元网格，尚未熵解码子分区。
- 隔行码流和部分少见的参数集组合，可能包含已解析但尚未可视化的字段。

## 路线图

- [x] 发布独立的 macOS Apple Silicon 桌面 GUI 安装包
- [x] 发布独立的 Windows x64 NSIS 桌面安装程序
- [ ] 为桌面发行包签名/公证，并增加 macOS Intel 与 Linux 安装包
- [x] 解析 H.264 CAVLC I/P 宏块类型和真实分区
- [x] 使用稳定的帧/运动矢量检查 ABI 包装原生 FFmpeg H.264 解码器
- [x] 使用稳定的 IVF/OBU 帧检查 ABI 包装原生 dav1d AV1 解码器
- [x] 将原生 H.264/dav1d 适配器接入桌面 GUI，并保留 WebCodecs 回退
- [ ] 在固定版本 FFmpeg 中加入 H.264 预测、残差、系数和去块滤波前像素钩子
- [ ] 支持 H.264 CABAC/B Slice 浏览器语法解析和参考帧详情
- [ ] 支持 MP4/MKV/MPEG-TS 解复用和 AVCC 转换
- [ ] 导出码流分析报告及帧/宏块数据
- [ ] 深入解析 HEVC、VVC 和 AV1 的 Picture/Slice 语法

## 参与贡献

欢迎提交问题、测试码流、解析修正和 UI 改进。请勿提交受版权保护或包含敏感信息的视频样本；仅分享你有权提供、且足以复现问题的最小码流。

提交 Pull Request 前请运行：

```bash
npm run lint
npm run build
```


---

<p align="center">
  为每一个想知道“这些字节究竟在做什么”的人而构建。
</p>
