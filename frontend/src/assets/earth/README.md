# 地球贴图来源与许可

本目录的地球素材来自 **Solar System Scope / INOVE**：

- 来源页：https://www.solarsystemscope.com/textures/
- 许可：[Creative Commons Attribution 4.0 International（CC BY 4.0）](https://creativecommons.org/licenses/by/4.0/)
- 许可全文：https://creativecommons.org/licenses/by/4.0/legalcode
- 原作者说明：素材基于 NASA 的高程和影像资料（含 Blue Marble）合成、调整颜色；并非实时天气或当前灯光数据。
- 下载与处理日期：2026-11-10。

| 本地文件 | 原始文件 | 本地处理 | SHA-256 |
|---|---|---|---|
| day.jpg | https://www.solarsystemscope.com/textures/download/8k_earth_daymap.jpg | 8192×4096 缩为 4096×2048，JPEG 质量 90 | dff46fefe6152bd906b75d124876492f4b0f4885687734babfd719b2f2fcd28f |
| night.jpg | https://www.solarsystemscope.com/textures/download/8k_earth_nightmap.jpg | 8192×4096 缩为 4096×2048，JPEG 质量 90 | 616ea4c7b1f9668b842cb84d4cc00011f9add407965bbbcbfc9624e03d571604 |
| clouds.jpg | https://www.solarsystemscope.com/textures/download/8k_earth_clouds.jpg | 缩为 2048×1024 的灰度 JPEG，质量 85 | af1e6842798ebb3a7d36ff081b403968e41b76de238d29b187968fdec69a3eca |

缩放使用 Pillow 的 Lanczos 采样；图片未保留下载文件的元数据。实际构建通过 Vite 引入本地文件，不使用 CDN 或运行时下载。分发或复用素材时请保留本文件及页面上的作者、来源和许可署名，不暗示作者为本项目背书。

三维组件使用 **Globe.gl 2.46.2（Vasco Asturiano，MIT）** 和 **Three.js 0.183.2（Three.js authors，MIT）**；原始依赖许可保存在各 npm 包的 LICENSE 中，具体版本由 frontend/package-lock.json 锁定。素材署名及三维组件依赖的许可原文同时汇集至 [发布包许可](../../../public/earth-notices.txt)，Vite 会将它复制为 `/earth-notices.txt` 随页面分发。昼夜及云层着色器由本项目实现，太阳计算复用本项目的 NOAA 近似算法。
