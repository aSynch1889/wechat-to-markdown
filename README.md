# 微信公众号转Markdown工具

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue.svg)](https://www.google.com/chrome/)
[![Python 3.7+](https://img.shields.io/badge/python-3.7+-blue.svg)](https://www.python.org/downloads/)

一键将微信公众号文章转换为Markdown格式的工具集，支持浏览器扩展、Python脚本和网页版三种使用方式。

## ✨ 功能特点

- 🚀 **一键转换** - 快速将公众号文章转为Markdown
- 📝 **格式保留** - 保留标题、粗体、斜体、链接、图片、代码块等格式
- 👤 **自动提取** - 自动提取文章标题、作者、发布时间
- 📦 **批量处理** - Python版支持批量转换多篇文章
- 🖼️ **图片下载** - 可选下载图片到本地（Python版）
- 🌐 **多平台** - 浏览器扩展、Python脚本、在线网页三种方式

## 📦 安装使用

### 方式一：Chrome浏览器扩展（推荐）

**优点：** 最方便，直接在文章页面使用，无需配置

#### 安装步骤

1. 下载本项目到本地
```bash
git clone https://github.com/aSynch1889/wechat-to-markdown.git
cd wechat-to-markdown/chrome-extension
```

2. 打开Chrome浏览器，访问 `chrome://extensions/`

3. 开启右上角的"开发者模式"

4. 点击"加载已解压的扩展程序"

5. 选择 `chrome-extension` 文件夹

6. 完成！扩展图标会出现在浏览器工具栏

#### 使用方法

1. 打开任意微信公众号文章
2. 点击浏览器工具栏的扩展图标
3. 点击"转换当前页面"
4. 自动下载为 `.md` 文件

### 方式二：Python脚本

**优点：** 功能最强大，支持批量处理和图片下载

#### 安装依赖

```bash
pip install requests beautifulsoup4 html2text
```

#### 使用方法

**单个链接转换：**
```bash
python wechat2md.py https://mp.weixin.qq.com/s/xxxxx
```

**批量处理：**
创建 `urls.txt` 文件，每行一个链接：
```
https://mp.weixin.qq.com/s/xxxxx
https://mp.weixin.qq.com/s/yyyyy
https://mp.weixin.qq.com/s/zzzzz
```

运行批量转换：
```bash
python wechat2md.py urls.txt
```

**下载图片到本地：**
```bash
python wechat2md.py <URL> --download-images
```

#### 输出结构

```
output/
├── 文章标题1.md
├── 文章标题2.md
└── 文章标题3/
    ├── 文章标题3.md
    └── images/
        ├── image_1.jpg
        └── image_2.jpg
```

### 方式三：在线网页版

**优点：** 无需安装，打开即用

访问：[在线演示地址]

支持单个和批量转换，使用CORS代理访问文章。

## 📁 项目结构

```
wechat-to-markdown/
├── chrome-extension/          # Chrome浏览器扩展
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── python/                    # Python脚本
│   └── wechat2md.py
├── web/                       # 网页版（React组件）
│   └── WechatToMarkdown.jsx
├── README.md
├── LICENSE
└── .gitignore
```

## 🛠️ 技术栈

- **浏览器扩展**: Chrome Extension API, Vanilla JavaScript
- **Python脚本**: requests, BeautifulSoup4, html2text
- **网页版**: React, Tailwind CSS, Lucide Icons

## ⚠️ 注意事项

- 网页版受浏览器CORS限制，可能无法访问某些链接
- Python脚本需要稳定的网络连接
- 图片链接可能会失效，建议使用 `--download-images` 下载到本地
- 仅供个人学习使用，请勿用于商业目的

## 🤝 贡献指南

欢迎提交Issue和Pull Request！

1. Fork本项目
2. 创建新分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源协议。

## 🙏 致谢

- 感谢所有贡献者
- 图标来自 [Lucide Icons](https://lucide.dev/)

## 📮 联系方式

- 提交Issue: [GitHub Issues](https://github.com/aSynch1889/wechat-to-markdown/issues)
- 邮箱: 6664540@gmail.com

## ⭐ Star History

如果这个项目对你有帮助，请给一个Star⭐支持一下！

---

**最后更新时间**: 2025-12-08