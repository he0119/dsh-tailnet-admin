# 发布

发布以**标签**为锚：推一个 `v*` 标签，Publish 工作流把它发到 npm 的**可信发布**（Trusted Publishing）
上，成功后自动建 GitHub Release。CI 里没有任何长期 token —— 发布时用 OIDC 换一次短期凭据，并签好
provenance 证明。

依赖与构建走 pnpm（`packageManager` 钉在 `pnpm@12.6.0`），发布链路上仍有两处是 npm：`npm view` 查线上
版本、`npm publish` 真发布 —— 可信发布与 provenance 是 npm CLI 的能力，工作流里那两步没有换。

## 包名与 scope

本包叫 **`@he0119/dsh-tailnet-admin`**。`@he0119` 是 npm 账号 `he0119` 的 **user scope**：不需要单独注册，
**第一次发布带该 scope 的包时自动建立**。

带 scope 有两个连带约定，都写在 `package.json` 里，别漏：

- `publishConfig.access = "public"`：scoped 包**默认 restricted**，而 restricted 需要付费组织。工作流里
  另外显式写了 `--access public`，两处一致。
- `repository.url` 必须指向本仓库：`--provenance` 要求包元数据里的仓库与工作流所在的仓库一致，缺了或写错
  会在生成证明那一步失败。

## 首版是一次性例外：必须手动发

npm 的信任发布**没有 pending publisher**：包必须先在 registry 上存在，才能在包设置页登记 Trusted
Publisher。也就是说 `@he0119/dsh-tailnet-admin` 的**第一个版本发不出去** —— 标签推上去会在 OIDC 换 token
那一步失败，这不是工作流写错了（上游一直在讨论要不要放开：[npm/cli#8544](https://github.com/npm/cli/issues/8544)）。

```sh
# 1) 手动发首版（同时也是 @he0119 scope 的创建动作）
npm login                      # 以 he0119 登录，需要 2FA
pnpm run build                 # lib/ 不进 git，先出产物
npm publish --access public    # 不加 --provenance：本机没有 OIDC，签不出证明
#    ↑ 发出去的就是 package.json 里那个版本（当前 0.1.0）：先 pnpm version 改号再发，
#      别用 npm publish 顺手发一个 git 里没有的版本

# 2) 去 npm 包设置页登记 Trusted Publisher（表格见下一节）
#    https://www.npmjs.com/package/@he0119/dsh-tailnet-admin/access

# 3) 之后再发版就走标签（见「一次发布」）：本地 npm 登录状态可以退出，CI 不再需要任何 token
```

首版手动发出来的那个版本没有 provenance 证明（`dist.attestations` 为空），后面的版本都有；这是流程本身的
代价，不是配置漏了。

## npm 侧的一次性登记

| 字段 | 值 |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `he0119` |
| Repository | `dsh-tailnet-admin` |
| Workflow filename | `publish.yml` |
| Environment | 留空 |

## 一次发布

分两段：**版本号走 PR 合进 `main`**，**想发的时候点一次 Release 按钮**。

```sh
# 1) 版本号：只改 package.json，这一步不发布
pnpm version 0.2.0 --no-git-tag-version
git checkout -b chore/release-0.2.0
git commit -am "chore(release): 0.2.0"
git push -u origin chore/release-0.2.0
gh pr create --title "chore(release): 0.2.0" --body "…"   # 等 check 绿了再合
#    合并之后 main 上就是 0.2.0，npm 上还没有 —— 这中间想合多少别的 PR 都行

# 2) 想发的时候点按钮
gh workflow run release.yml --ref main -f version=0.2.0

npm view @he0119/dsh-tailnet-admin version   # 工作流绿了再确认线上版本（见「工作流绿了但查不到」）
```

`version` 这个入参**不是版本号的来源** —— 工作流仍只从 `main` 的 `package.json` 读版本号，入参是发布者对
自己要发什么的**断言**，对不上就什么都不做。它挡三类事：记错了现在升到哪一版、在错误的分支上点、手滑点了
两次。

标签由工作流在**当刻 `main` 顶端**打好再推 —— 标签与版本提交因此按构造是同一个 SHA，不需要人去挑提交。
用 `GITHUB_TOKEN` 推的标签不会再触发别的 workflow，所以 Release 工作流会显式以 `workflow_call` 调
Publish。

## Publish 的三道硬校验

任何一道不过，都会**在碰 npm 之前**失败：

| 校验 | 挡下什么 |
| --- | --- |
| 标签指向的提交里 `package.json` 就是 `vX.Y.Z` | 标签打在版本提交**之后**的某个提交上 |
| 标签指向的提交是 `origin/main` 的祖先 | 标签打在没合进 main 的分支上 |
| `main` 当前的 `package.json` 仍是这个版本 | 往旧版本倒灌：main 升到 0.2.1 之后再补发 0.2.0，npm 的 `latest` 会被拽回去 |

已经在 npm 上的同版本会被识别为「已存在」并安全跳过（这一步跳过时 Release 条目仍然会建出来）。重试时
**不要删标签**：再点一次按钮、或 `gh run rerun <run-id>`，两条路都不会重复发布。

需要绕开按钮时，标签推送这条入口一直在：

```sh
git tag -a v0.2.0 -m "chore(release): 0.2.0" origin/main
git push origin v0.2.0
```

## 工作流绿了但 `npm view` 查不到

可信发布是异步的：`npm publish` 打出 `+ @he0119/dsh-tailnet-admin@0.2.0` 的同时还会说
「Your package is being processed and may take a few minutes to become available」。在那几分钟里 registry
对这个版本就是 404，`latest` 也还停在上一版 —— 不是缓存问题，等一会儿再看。因此**刚发完就重跑同一条
工作流**，它可能仍按「没发过」去发一次，那一发会被 npm 以「该版本已存在」拒绝。

## Release 条目与日志

Release 由 Publish 工作流在 **npm 发布成功之后**创建，顺序不会倒过来。日志用 GitHub 自己生成的
（`gh release create --generate-notes`），分组规则在 [`.github/release.yml`](../.github/release.yml)。

GitHub 原生只按 label 分组 —— `changelog.categories[*].labels` 里的 `*` 是「兜底」而**不是**通配符。所以
分组靠标签，标签由 [`.github/workflows/autolabeler.yml`](../.github/workflows/autolabeler.yml) 按 **PR
标题**自动补上（规则表在 [`.github/autolabeler.yml`](../.github/autolabeler.yml)）。**PR 标题要照约定式
提交写**，否则分组会落到「其它改动」。
