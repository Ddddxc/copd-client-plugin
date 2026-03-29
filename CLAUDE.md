# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供此代码库的工作指导。

## 项目概述

医疗质控桌面客户端，基于 Electron + Vue 3 + Vite 构建。应用截取医疗监护数据的屏幕截图，使用 OCR 和计算机视觉提取患者信息和肺功能曲线，然后对提取的曲线运行 YOLO 目标检测。

## 架构说明

### 多进程结构

**主进程** (`src/main/`)
- `index.js` - 创建两个窗口：主历史记录窗口和置顶悬浮球
- `ipc.js` - IPC 处理器，负责截图、图像分析和数据库操作
- `python-bridge.js` - 启动 Python 子进程进行图像分析，通过 stdin/stdout 传输 JSON 通信
- `db.js` - SQLite 数据库封装，使用 sql.js（内存数据库 + 文件持久化）
- `screenshot.js` - 原生截图功能

**渲染进程** (`src/renderer/`)
- `App.vue` - 根据 `?view=` 查询参数路由到历史记录或悬浮球组件
- `pages/History.vue` - 主窗口，显示分析记录列表
- `pages/RecordDetail.vue` - 单条分析记录的详情视图
- `components/FloatingWidget.vue` - 可拖拽的悬浮球 UI

**预加载脚本** (`src/preload/index.js`)
- 通过 `window.api` 向渲染进程暴露 IPC 桥接

### Python 分析流程

`resources/python/analyze_new.py` 执行以下步骤：
1. 使用 EasyOCR 提取患者 ID 和姓名
2. 模板匹配定位肺功能曲线区域
3. 基于 HSV 颜色空间提取曲线并进行坐标变换
4. 对提取的曲线图像运行 YOLO 目标检测
5. 返回包含患者信息、曲线图像和 YOLO 预测结果的 JSON

Python 进程持久运行，通过 stdin 接收 JSON 请求，通过 stdout 返回结果。

### 数据库结构

SQLite 表（使用 sql.js）：
- `patients` - 患者 ID 和姓名注册表
- `analyses` - 分析记录，外键关联到 patients
- `images` - 提取的产物（曲线、ROI）关联到 analyses
- `predictions` - 每个患者的 YOLO 预测结果

### 自定义协议

注册了 `app-resource://` 协议用于从绝对路径加载本地图像（处理 Windows 盘符，如 `app-resource://d/path/to/file.png`）。

## 开发命令

```bash
# 开发模式（热重载）
npm run dev

# 构建渲染进程并启动 Electron
npm start

# 打包应用（生成可分发文件）
npm run make
```

## Python 环境

Python 依赖预期位于 `resources/python/venv/`（打包后）或通过 `PYTHON_EXE` 环境变量指定。YOLO 权重文件位于 `resources/python/models/best.pt` 或通过 `YOLO_WEIGHTS_PATH` 指定。

## 关键模式

- Python 桥接使用 30 秒超时，如果持久进程挂起则回退到一次性子进程
- 数据库每次修改后将完整 SQLite 文件导出到磁盘
- 截图路径和分析输出存储在 userData 目录
- 悬浮球响应 `Alt+S` 全局快捷键
- 通过 `webRequest.onBeforeRequest` 阻止所有网络请求以确保安全