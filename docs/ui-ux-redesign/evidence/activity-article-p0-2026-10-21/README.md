# P0 探针报告 — 活动图文发布（封面 + 图集 + 图文混排）

- 日期：2026-10-21
- 环境：`cloud1-d9ghcm034574b9d55` · `trailApi` Active / timeout 20 / Nodejs16.13
- 探针方式：生产 `trailApi` 新增 `checkImage`；临时组件 `components/p0-probe` 挂在 `pages/lab`（仅 DEV_ONLY），验完已从工作树移除。
- 截图：`p0-lab.png`（306×660 模拟器；图片块 5、封面已选、上传/检查耗时行）

## 1. 图片安全检查（生产）

`checkImage` 已随 `trailApi` 部署；部署后下载线上包与工作树逐文件对比（排除 node_modules/.DS_Store/AGENTS.md/package-lock）**差异为空**。

| 用例 | 结果 |
|---|---|
| 安全图（`assets/photos/cover-ridge.jpg`，45 KB） | `{ok:true,data:{pass:true}}` |
| 非 `activity-media/` 路径（`cloud://.../avatars/x.jpg`） | `{ok:false,error:{code:'INVALID_INPUT',message:'图片标识无效。'}}` |
| 不存在的 `activity-media/` 文件 | `{ok:true,data:{pass:false,reason:'read_failed'}}` |
| 不安全图（87014 分支） | **UNVERIFIED**：没有可用的不安全样本，未伪造 |
| >1MB 分支 | **UNVERIFIED**：没有构造超大图；分支是 `buffer.length > 1MB → too_large` |

## 2. 延迟与并发

| 场景 | 读数 |
|---|---|
| 冷启动首张（上传 + 检查） | 上传 1278 ms · 检查 2233 ms |
| 热调用顺序 3 张 | 1949 / 1686 / 1654 ms |
| 并发 3 张检查 | 总 1661 ms，3 张全 `pass:true` |

结论：编辑器图片处理采用**并发 3**；10 张图预计 ~6 s 检查，加客户端上传仍可接受。逐张串行会让 10 张图等到 ~17 s，不采用。

## 3. 作者体验探针（块列表 + 图片）

用临时组件 `p0-probe` 驱动，生产 `checkImage`：

- 4 个文本块：分别向第 2、4 块输入，数据落到 `blocks[1].text` / `blocks[3].text`，互不串。
- 添加图片块 → 写入临时图 → `compressImage` → `uploadFile` → `checkImage` → 追加 fileID：成功，`fileIds=1`。
- 设为封面：`coverFileId` 等于该 fileID；删除整块后 `coverFileId` 被清空。
- 布局：306×660 下图片块、缩略图、按钮、提示行可读（见截图）。
- **UNVERIFIED：真实键盘焦点/键盘收起行为**。automator 的 `tap` + `input` 不触发 `bindfocus`/`bindblur`（`focusLog=[]`），所以“在第 2 段中间打字再点第 4 段”必须人工在模拟器/真机上试一次；代码已按路径 `setData`（只更新 `blocks[i].text`），但这不是焦点行为的像素证据。

## 4. 云存储跨用户读

- 单账号上传/显示/删除都成功；三个探针文件删除后 `checkImage` 返回 `read_failed`（`STORAGE_FILE_NONEXIST`）。
- **UNVERIFIED：另一个账号能否读同一 fileID**。仓库已有的跨用户头像路径（`components/person-row/person-row.wxml` 的 `<image src="{{avatar}}">`，活动名单传 `r.avatar`）是强先例，但 P0 没有第二个账号，不能把它写成已证。
- 发布前必须补：双账号实测，或在云开发控制台确认存储权限为「所有用户可读」。

## 5. 清理

- 三个探针文件均已删除；删除接口返回 `STORAGE_FILE_NONEXIST`，说明此前清理已生效。
- 临时组件与 `pages/lab` 接线已移除（见工作树 diff）；证据只保留本目录的截图与本报告。
- `smoke-test.js` 新增 `domain/files.js` 的 8 条断言：184/0。

## 6. 决定

1. 继续 **B：内容块（段落 / 图片组）**，不降级到固定图集。
2. 编辑器上传/检查并发 3；逐张进度 + 总进度。
3. 跨用户读与真实键盘焦点是发布前必须补的两项；不因为 P0 通过就把它们写成已验证。
4. `checkImage` 已进生产 `trailApi`，但客户端尚未调用；功能收口前不放出图文发布入口。
