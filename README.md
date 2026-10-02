# dsh-bilibili

> 常驻 **DSH Web** 界面右下角的哔哩哔哩小组件：扫码登录 → 推荐流 → 站内播放。

一个 DSH 插件（bundle）。浏览器不直连 B 站（其 API 不发 CORS 头），所有出网请求都由插件的 Host 半侧代理。

---

## 功能

| | |
|---|---|
| 🔐 **扫码登录** | 面板内生成二维码，手机 B 站 App 扫码即登录；也可手动粘贴 `SESSDATA` |
| 👤 **登录态常驻右下角** | 收起态圆形入口直接显示你的头像 |
| 🎬 **推荐流** | 登录后主页为 B 站推荐视频，2 列卡片（封面 / 时长 / UP 主 / 播放量） |
| 🔁 **换一批 / 刷新** | 换一批走下一批；刷新重载当前视图。Host 侧带批次缓存与下一批预取，常态下**瞬间返回** |
| 🔍 **搜索** | 顶部搜索框，回车或点「搜索」提交（接口需 wbi 签名） |
| 🕘 **历史** | 阅读观看历史（游标分页） |
| ⭐ **收藏** | 读取「默认收藏夹」（分页） |
| ▶️ **站内播放** | 点卡片在面板内播放，支持拖动进度与续播；中键/`Ctrl`+点击仍在新标签打开 B 站 |

---

## 界面

```
┌─────────────────────────────────────┐
│ [头像] 昵称                [退出] [×] │
├─────────────────────────────────────┤
│ [ 搜索 B 站视频…          ] [搜索]    │
│ 为你推荐      [历史][收藏][换一批][刷新] │
├─────────────────────────────────────┤
│  卡片  卡片                          │
│  卡片  卡片                          │
└─────────────────────────────────────┘
```

- **历史 / 收藏** 是可切换的 chip，高亮表示当前视图，再点一次回到推荐。
- 非「推荐」视图下，**换一批** 自动变成 **下一页**；**刷新** 始终重载当前视图。
- 右上角 `×` 收起为右下角圆形入口；入口显示头像表示已登录。

---

## 安装

```bash
# 1. 放进 DSH profile（示例：web）
cd ~/.dsh/profiles/web
pnpm add /path/to/dsh-bilibili      # 或以 link: 依赖登记
```

```yaml
# 2. cordis.patch.yml 追加
- insert:
    - id: dsh-bilibili
      name: dsh-bilibili
```

```bash
# 3. 重启
setsid bash ~/.dsh/restart-dsh.sh </dev/null >/dev/null 2>&1 &   # 或你自己的重启方式
```

> **Host 半侧代码只在 DSH 启动时加载。** 改动 `index.js` 后禁用/启用插件不会生效（只会从缓存的模块重放 `apply`），**必须重启**。`client.js` 会随 `dsh-client-hmr` 热更新。

---

## 登录

**方式一：扫码（推荐）**
点开面板 → 出现二维码 → 手机哔哩哔哩 App 扫码 → 手机点确认。成功后凭据由 Host 校验并落盘。

**方式二：粘贴 Cookie**
面板右下角「改为手动粘贴 Cookie」→ 从浏览器 F12 复制 `SESSDATA` 的值，或直接整行 Cookie → 保存。

凭据存放在：

```
<DSH_HOME>/dsh-bilibili/session.json      # 权限 0600，目录 0700
```

只保留 `SESSDATA / bili_jct / DedeUserID / DedeUserID__ckMd5 / sid / buvid3 / buvid4 / b_nut`，
**先经 `nav` 校验通过才写入**，从不回传浏览器、不写日志。

### ⚠️ 代价与风险

- `SESSDATA` **等同于该账号的完整登录权限**。落盘意味着这台机器能冒充该账号。
- 属于非官方接口。B 站可能对该账号**限流或风控**，**建议使用小号**。
- 凭据约数月过期，失效后面板会提示重新导入。

---

## 架构

```
client.js   Client 半侧：shell.overlay 槽位，渲染面板；只请求本包的同源路由
index.js    Host 半侧：持有凭据、出网、转发视频流
```

| 路由 | 作用 |
|---|---|
| `GET/POST/DELETE /dsh-bilibili/session` | 登录态读取 / 校验并保存 / 退出 |
| `GET /dsh-bilibili/login/qrcode` | 生成二维码（返回模块矩阵，前端画 SVG） |
| `GET /dsh-bilibili/login/poll` | 轮询扫码状态，成功后收 `Set-Cookie` 并落盘 |
| `GET /dsh-bilibili/feed?cursor=` | 推荐流（登录则个性化） |
| `GET /dsh-bilibili/library/{history,fav,search}` | 历史 / 默认收藏夹 / 搜索 |
| `GET /dsh-bilibili/play?bvid=&cid=` | 解析播放地址（`cid` 可省，会自动补齐） |
| `GET /dsh-bilibili/media?u=` | **Range-aware 视频流代理** |

### 三个必须知道的实现约束

1. **视频流必须代理。** 实测 CDN 只认 bilibili 的 `Referer`：带它 `206`，不带或外来 `403`。所以 `<video>` 指向本包的
   `media` 路由，由 Host 带着正确头部转发。
2. **媒体代理必须做背压。** `res.write()` 返回 `false` 时要 `await drain`。浏览器缓冲够了会主动暂停读，
   若仍按 CDN 速度拉取，整个视频会堆进 DSH 进程内存（实测单个 447MB 视频涨 140MB），
   GC 压力会让播放和整个界面一起卡。修好后暂停期间从 CDN 的拉取会收敛到 0。
3. **搜索必须 wbi 签名。** 不签名会返回 `412`。签名 = 排序 + 转义 + `wts` + `md5(query + mixin)` 的 `w_rid`，
   密钥从 `nav` 的 `wbi_img` 推导，缓存 6 小时。

---

## 已知限制

- 只读「默认收藏夹」，**不能切换其他收藏夹**。
- 仅支持视频（`archive`）。番剧 / 直播 / 动态不出现在历史里。
- 播放清晰度固定 `qn=64`（720p，mp4 `durl`）；**未做清晰度切换**。
- 未实现：投币、点赞、弹幕、评论区、稍后再看。
- 面板宽度 380px，信息密度按此调校。

---

## 目录结构

```
dsh-bilibili/
├── package.json          # bundle 清单：dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # 插入插件行
├── index.js              # Host 半侧（登录 / 流 / 播放 / 搜索 / 历史 / 收藏）
├── client.js             # Client 半侧（面板 / 二维码 / 卡片 / 播放器）
├── icon.svg              # 插件管理器图标
├── locale/{en,zh}.json   # 插件显示名称与描述
└── node_modules/         # 仅 qrcode-generator（零依赖）
```

## 依赖

- [`qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator)（MIT，零依赖）— 二维码编码。
  仅使用其 ESM 默认导出；注意它的 `stringToBytes` 默认是 latin1，本插件用 `TextEncoder` 覆盖以保证字节正确。

## License

[MIT](LICENSE) © 2026 CloudWoR
