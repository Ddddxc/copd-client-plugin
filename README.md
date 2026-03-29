# COPD 医疗质控桌面客户端

## 项目简介

医疗质控桌面应用，用于自动化分析肺功能监护数据。通过截图捕获医疗监护设备屏幕，自动提取患者信息和肺功能曲线，并使用深度学习模型进行智能分析和异常检测。

## 主要功能

- **智能截图**：全屏或区域截图，支持 Alt+S 快捷键
- **患者信息提取**：OCR 自动识别患者 ID 和姓名
- **曲线提取**：基于 HSV 颜色空间和模板匹配提取肺功能曲线
- **AI 分析**：YOLO 目标检测识别曲线异常
- **历史记录**：SQLite 数据库存储分析记录，支持搜索和查看
- **悬浮球界面**：始终置顶的快捷操作入口

## 技术架构

### 前端技术栈

- **Electron 22** - 跨平台桌面应用框架
- **Vue 3** - 渐进式前端框架
- **Vite 5** - 快速构建工具
- **Element Plus** - UI 组件库

### 后端技术栈

- **Node.js** - Electron 主进程运行环境
- **Python 3** - 图像处理和 AI 分析
- **sql.js** - 浏览器端 SQLite 数据库

### AI 和图像处理

- **EasyOCR** - 中英文 OCR 识别
- **OpenCV (cv2)** - 图像处理和计算机视觉
- **Ultralytics YOLO** - 目标检测模型
- **NumPy** - 数值计算

## 项目结构

```
client-plugin/
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── index.js       # 应用入口，窗口管理
│   │   ├── ipc.js         # IPC 通信处理
│   │   ├── python-bridge.js  # Python 子进程桥接
│   │   ├── db.js          # SQLite 数据库封装
│   │   └── screenshot.js  # 截图功能
│   ├── renderer/          # 渲染进程
│   │   ├── App.vue        # 根组件
│   │   ├── pages/         # 页面组件
│   │   └── components/    # UI 组件
│   └── preload/           # 预加载脚本
├── resources/
│   └── python/
│       ├── analyze_new.py # 图像分析主脚本
│       ├── models/        # YOLO 模型权重
│       └── app/data/input/  # 模板图片
├── package.json
├── vite.config.ts
└── forge.config.cjs
```

## 开发指南

### 环境要求

- Node.js 16+
- Python 3.8+
- Git

### 安装依赖

```bash
# 安装 Node.js 依赖
npm install

# 安装 Python 依赖
cd resources/python
pip install -r requirements.txt
```

### 开发模式

```bash
# 启动开发服务器（热重载）
npm run dev
```

### 构建和打包

```bash
# 构建并启动应用
npm start

# 打包为可分发文件
npm run make
```

## Python 环境配置

应用会按以下顺序查找 Python 解释器：
1. 环境变量 `PYTHON_EXE`
2. `resources/python/venv/Scripts/python.exe`（打包后）
3. 系统 `python` 命令

YOLO 模型权重文件位置：
- 默认：`resources/python/models/best.pt`
- 可通过环境变量 `YOLO_WEIGHTS_PATH` 自定义

## 许可证

MIT License
