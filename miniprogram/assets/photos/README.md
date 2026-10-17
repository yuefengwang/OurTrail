# 封面氛围图（assets/photos）

9 张真实户外摄影，用于活动详情 hero、列表缩略与天气页氛围。
**它们是场景氛围封面，不是活动实拍**——活动模型没有图片字段，
页面以脚注明示这一点（见 `pages/activity/activity.wxml` 尾部）。

## 来源与授权

- 全部经 [Lorem Picsum](https://picsum.photos)（其图片来自 [Unsplash](https://unsplash.com)，
  Unsplash License：免费商用、无需署名、可修改）按 720×450 裁切下载。
- 下载时间：2026-10-16。下表登记 picsum 图片 ID 与场景内容，便于溯源与替换。

| 文件 | picsum ID | 场景 |
|---|---|---|
| `cover-ridge.jpg` | 1018 | 雾中绿色山脊与山路（Skye，Scotland） |
| `cover-valley.jpg` | 1043 | 森林峡谷与河 |
| `cover-falls.jpg` | 1039 | 针叶林瀑布 |
| `cover-fjord.jpg` | 1015 | 峡湾悬崖与崖顶人群 |
| `cover-snow.jpg` | 1036 | 雪山营地（黄色帐篷） |
| `cover-gorge.jpg` | 1016 | 红岩峡谷金色时刻 |
| `cover-coast.jpg` | 1057 | 海岸山脊落日 |
| `cover-dawn.jpg` | 110 | 原野晨光 |
| `sky-storm.jpg` | 1019 | 暴风雨天空（天气页氛围） |

## 使用规则

- 选择逻辑在 `miniprogram/utils/covers.js`：按活动 id 稳定散列，
  **同一活动恒得同一张，不同活动尽量不同**。不要按列表顺序发图。
- 一律 `mode="aspectFill"`；加载失败回退森林绿纯色 hero（不允许破图）。
- 包体预算：本目录合计约 520KB；新增图片前先算 `miniprogram/` 总体积（主包上限 2MB）。
- 只放「山、林、雪、晨昏光」相关实景；不放人物特写、动物、城市、静物。
