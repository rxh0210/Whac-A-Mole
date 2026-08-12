# Whac-A-Mole (静态演示)

这是一个纯静态的打地鼠示例，已集成以下功能：

- 桌面鼠标 + 移动触控支持（click + touch）
- 定时模式（Timed，默认 30s）与无尽模式（Endless，带生命机制）
- 难度随时间提升（出现频率与持续时间变化），并会在生成时包含特殊地鼠
- 连击（combo）与倍数（每 10 连击增加倍率）
- 特殊地鼠：金色（高分）、冻结（命中后短暂减速）、炸弹（命中扣分/失去生命）
- 声音（WebAudio 合成）与振动支持（可开关）
- 粒子击中特效与平滑动画（Canvas + requestAnimationFrame）
- 本地记录最高分、排行榜、游戏次数、最长连击（localStorage）
- 可重玩、暂停/继续、切换模式与重置统计

部署
1. 将本目录推到一个 GitHub 仓库（例如本仓库）。
2. 在仓库 Settings -> Pages 中启用 GitHub Pages（选择 main 分支的根目录）。
3. 访问生成的 Pages URL 即可玩。

开发与定制
- 可调整游戏时长、格子大小、特殊地鼠概率等（见 main.js 中的配置）。
- 若需要服务器排行榜或防作弊验证，可以接入 serverless API（Cloudflare Workers / Netlify Functions / Firebase Functions）。

如果你希望我把这些文件直接推到仓库的不同分支或调整内容（例如改默认时长、改主题颜色或加入每日挑战种子），告诉我具体要求我可以继续修改。