<p align="center">
  <img src="public/og.png" alt="BitScope H.264 码流分析工具" width="900">
</p>

<h1 align="center">BitScope</h1>

<p align="center">
  <strong>让 H.264 码流清晰可见。</strong><br>
  在浏览器中查看码流结构、解码画面、NAL 单元和宏块信息。
</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文
</p>

<p align="center">
  <img alt="H.264 Annex-B" src="https://img.shields.io/badge/输入-H.264%20Annex--B-1f6feb?style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white">
  <img alt="本地处理" src="https://img.shields.io/badge/处理方式-100%25%20本地-2ea44f?style=flat-square">
</p>

## BitScope 是什么？

BitScope 是一款可视化 H.264 裸码流分析工具，适合视频开发者、编解码工程师、学生，以及所有希望了解压缩视频内部结构的人。

导入 Annex-B 码流后，BitScope 会完全在本地解析码流，展示媒体信息和 NAL 布局；浏览器支持 WebCodecs 时，还可同步显示解码画面，并让当前帧与语法信息保持联动。文件不会上传，也不依赖服务端分析。

## 功能亮点

| | 功能 | 可查看的信息 |
|---|---|---|
| **01** | 码流概览 | Profile、Level、编码/显示尺寸、帧率、色度格式和位深 |
| **02** | NAL 时间线 | 类型、参考优先级、字节偏移、负载大小和起始码长度 |
| **03** | 解码画面 | 逐帧显示，并与当前访问单元保持同步 |
| **04** | 宏块视图 | 可缩放的 16×16 网格、点击选择、位置、地址及推断的 Slice 归属 |
| **05** | 语法详情 | SPS、Slice Header 字段及大小受控的十六进制数据视图 |
| **06** | 本地隐私 | 所有分析均在浏览器内完成，原始码流不会上传 |

## 输入格式

| 格式 | 状态 | 说明 |
|---|:---:|---|
| H.264 Annex-B 裸码流（`.h264`、`.264`、`.avc`） | ✅ | 支持 3 字节和 4 字节起始码 |
| MP4 / MOV | — | 需要先提取 H.264 裸码流 |
| MKV / WebM | — | 暂未实现容器解复用 |
| MPEG-TS | — | 暂未实现容器解复用 |
| AVCC 长度前缀格式 | — | 当前要求 Annex-B 输入 |

当前单个文件上限为 **200 MB**。NAL 单元解析数量最多为 **100,000 个**，以避免异常或超大码流导致页面失去响应。

## 分析范围

| 层级 | 当前支持内容 |
|---|---|
| SPS | Profile、约束标志、Level、编码/显示尺寸、裁剪、帧率、色度格式、位深、帧编号和 POC 配置 |
| NAL 单元 | 类型、`nal_ref_idc`、字节范围、大小、起始码和面向 RBSP 的详情视图 |
| Slice Header | 首宏块、Slice 类型、PPS ID、帧编号、场标志、IDR Picture ID 和部分 POC 字段 |
| 画面 | 浏览器提供 H.264 解码器时，通过 WebCodecs 完成解码 |
| 宏块 | 16×16 空间网格、地址/坐标、边界尺寸和推断的 Slice 范围 |

> [!NOTE]
> 宏块覆盖层当前用于结构导航。BitScope 尚未熵解码 `mb_type`、子块划分、运动矢量、预测模式或残差系数。

## 快速开始

### 从源码运行

环境要求：**Node.js 22.13 或更高版本**、npm。

```bash
git clone git@github.com:konnerzhu/bitstream_analyzer.git
cd bitstream_analyzer
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，将 H.264 裸码流拖入页面，或从磁盘选择文件。

> [!IMPORTANT]
> 以上是开发环境命令。无需安装 Node.js 的独立桌面 GUI 安装包已经列入计划，但目前尚未发布。

## 使用方法

1. 导入 Annex-B 格式的 H.264 裸码流。
2. 在时间线或列表中选择帧/NAL 单元。
3. 查看同步的解码画面与语法面板。
4. 开启宏块覆盖层，点击宏块即可查看地址、坐标、边界及 Slice 归属。
5. 在画面上滚动鼠标滚轮，可在 **50%～800%** 范围内缩放；点击 **Fit** 可恢复为适应窗口大小。

如果浏览器不支持 WebCodecs 或没有可用的 H.264 解码器，码流解析功能仍然可用，但无法显示解码画面。

## 项目结构

| 路径 | 用途 |
|---|---|
| `app/Analyzer.tsx` | 分析器 UI、帧解码、导航、缩放和宏块交互 |
| `app/h264.ts` | Annex-B 扫描、位读取、防竞争字节移除和 H.264 语法解析 |
| `app/analyzer.css` | 响应式分析界面与视觉样式 |
| `public/` | 项目与应用图片资源 |

## 开发命令

```bash
npm run dev      # 启动本地开发服务器
npm run build    # 生成生产构建
npm run lint     # 执行静态检查
```

项目使用 TypeScript、React 19 和 vinext 开发。解析和解码逻辑有意保留在客户端，以便未来复用到桌面应用中。

## 已知限制

- 当前仅支持 Annex-B 裸码流，不包含容器解复用。
- 解码结果取决于浏览器、操作系统以及可用的 H.264 编解码实现。
- 尚未完整熵解码宏块语法，因此暂不显示块类型、运动矢量、参考帧和残差数据。
- 隔行码流和部分少见的参数集组合，可能包含已解析但尚未可视化的字段。

## 路线图

- [ ] 发布适用于 macOS、Windows 和 Linux 的桌面 GUI 安装包
- [ ] 解析宏块类型、块划分、预测模式、运动矢量和残差信息
- [ ] 支持 MP4/MKV/MPEG-TS 解复用和 AVCC 转换
- [ ] 导出码流分析报告及帧/宏块数据
- [ ] 将分析器架构扩展到 HEVC 和 AV1

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
