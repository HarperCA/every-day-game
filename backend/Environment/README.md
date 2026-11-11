# 运行环境（backend/Environment）

新后端（`backend/`）要装的第三方库和要设置的环境变量都在这里。新后端不依赖仓库里别的文件夹，把 `backend/` 整个拿走就能装、能跑。

| 文件 | 作用 |
|---|---|
| package.json | 要装哪些库、版本，Node 版本要求，跑测试的命令 |
| pnpm-lock.yaml | 自动生成：每个库实际装的确切版本，保证每台机器装出来一样，不要手改 |
| env.example | 要设置的环境变量清单（只有名字和说明，不写值） |
| node_modules/ | 装好的库（自动生成，不进 git） |

## 装了什么

| 库 | 版本 | 做什么 |
|---|---|---|
| better-sqlite3 | 12.10.1 | 读写 SQLite（数据库总管、每晚的小库、AI 用量库） |
| vitest | 3.2.7 | 跑测试（只在开发时用） |

版本都写死，不自动升级。better-sqlite3 12.10.1 对 Node 22、24 的 Windows 和 Linux 都有现成的安装包，装的时候不需要编译工具；
旧代码用的 11.10.0 没有 Node 24 的安装包，所以这里换成了 12.10.1。

## 要求

- Node.js 22 或以上（Node 20 没有现成的 better-sqlite3 安装包）
- pnpm 10

## 怎么装、怎么跑测试

```powershell
cd backend/Environment
pnpm install --ignore-workspace     # 只装新后端的，不管仓库根目录的旧配置
pnpm test                           # 跑 backend/ 下全部测试
```

## 代码里怎么用这些库

第三方库只在一个地方取：`backend/共用/工具/sqlite.mjs` 按 `Environment/package.json` 的位置找 better-sqlite3。
以后加新的库，写进这里的 package.json，再在 `backend/共用/工具/` 里集中取用，不在各处直接引用。

## 服务器上

美国服务器跑主库（比赛数据）、每晚流程、Codex；北京服务器跑小程序入口和用户数据（收藏、提醒）。两台都按下面装：

1. 装 Node 22 或以上、pnpm 10。
2. 在 `backend/Environment/` 里 `pnpm install --ignore-workspace --prod`（不装测试工具）。
3. 按 `env.example` 设置环境变量；密钥、主库、日志放在代码目录以外，密钥文件权限 600。
