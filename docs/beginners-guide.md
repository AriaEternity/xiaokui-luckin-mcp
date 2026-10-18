# 零基础部署：让自己的 ChatGPT 查询瑞幸门店和报价

这份教程不要求你拥有 KuiNest，也不要求你写后端代码。你要准备自己的云服务器、域名、合法官方凭据，并亲自完成账号登录和授权。AI 可以解释和排错，不能代替你同意付费、提供密码或执行真实交易。

**首次目标是“查到真实门店、商品和预览报价”，不是下单。** 文中安装命令用于一台全新的 Ubuntu 24.04 x64 服务器；不要拿去覆盖已有网站。每个代码块也要逐条执行，遇到非零退出或报错就停在该步，让 AI 根据脱敏错误排查。

## 0. 先确认你具备哪些条件

**在哪里：自己的浏览器和 ChatGPT 网页。**

- 阅读 README 的“复制给 ChatGPT 的部署提示词”，把它和本仓库地址发给能联网阅读文档的 ChatGPT。无法联网时，提供 README 和本教程文本，不能让 AI 猜仓库内容。
- 确认账号/工作区界面允许添加自定义 MCP，并允许 OAuth；看不到入口时先问管理员或核对[OpenAI 官方说明](https://developers.openai.com/api/docs/guides/custom-mcp-server)。**购买套餐不等于必然拥有该权限。**
- 本人访问[瑞幸 AI 开放平台](https://open.lkcoffee.com/mcp)，确认能合法取得自己的官方 MCP Token。不要把 Token 发给 AI。
- 告诉 AI：使用电脑还是手机、有无服务器/域名、系统是什么、能接受的费用范围；不必提供密码、验证码或身份证件。

**成功标志：** 已确认能添加自定义 MCP，也能使用本人官方凭据，并选择了一个部署环境。缺少其中任一项时，先解决条件，不急着买服务器。

## 1. 服务器是什么，如何选择

服务器就是一台持续联网运行的小电脑。ChatGPT 要通过 HTTPS 找到这个网关；关掉自己电脑后服务也要在线，所以本教程使用云端 Linux 服务器。GitHub 只是放代码，不会替你持续运行后端；把仓库链接发给 AI 也不会自动安装服务。

| 方式 | 本项目情况 | 新手建议 |
|---|---|---|
| 云端 Ubuntu 24.04、x86_64 虚拟机 | 已有 Node/systemd/nginx 模板，来源独立版在此环境做过合成验证 | 推荐；普通单用户可先选约 2 核、2GB 内存、20GB 以上磁盘，实际按负载调整 |
| 已有 Linux 主机 | 可独立实例部署，但需检查端口和已有站点 | 请 AI 先核对，不能停止别人的服务 |
| 托管应用平台/免费容器 | 需持久磁盘、私有文件、稳定 HTTPS 和常驻进程，仓库没有已验证的一键模板 | 不作为本教程路线，免费休眠/临时磁盘可能丢状态 |
| 家里电脑加隧道 | 需自行解决在线时间、TLS、Cookie 和持久化 | 进阶方案；没有一键支持承诺 |

**在哪里：你选定的云服务商控制台。输入/选择：** 新建 Ubuntu 24.04 LTS、x86_64/amd64、带公网地址的实例。确认续费、流量、磁盘和备份收费后由本人付款；免费试用也要看额度、到期和自动续费。按平台要求准备安全登录方式，密钥留在本人设备。

费用可能包括服务器与流量、域名年费、可选备份/监控、你的 ChatGPT 订阅和实际饮品。HTTPS 可使用免费 Let's Encrypt 证书；源码本身按 MIT 免费提供，不需要 OpenAI API Key。本教程不承诺某家云永久免费，也不替你购买服务。

**成功标志：** 控制台显示实例运行中，你能打开它的浏览器终端。**失败排查：** 先用云控制台连接；不要反复尝试未知 SSH 用户名或分享私钥。

## 2. 域名、DNS 与网络入口

**在哪里：域名服务商的 DNS 控制台。** 域名是好记的服务器地址，DNS 将它指到服务器，HTTPS 证书让浏览器确认身份并加密。可以给已有域名新增 `coffee` 子域名，无需再买一个域名。

新增一条 A 记录：主机名 `coffee`，值为你的服务器公网 IPv4。没配置 IPv6 就不要添加 AAAA。本文用 `coffee.example.com` 占位，**后续所有命令、配置都要替换成自己的完整域名**，不要真的申请 example.com 的证书。初次先用直接 DNS 解析，避免代理/CDN缓存或访问挑战干扰 OAuth。

**在哪里：云安全组。** 入站开放 HTTP 80、HTTPS 443；SSH 22 仅按本人管理需要限制来源。不要向公网开放内部服务端口 4318。服务器还需能出站访问 GitHub、npm、Node 官方源和瑞幸官方 HTTPS。

**成功标志：** 稍后在服务器执行 `dig +short coffee.example.com A`，结果与控制台公网地址相同。**失败排查：** 检查记录主机名、DNS 服务商、旧 AAAA 和解析缓存；不要把解析失败误判为程序错误。

## 3. 在服务器准备操作环境

**在哪里：云服务器浏览器终端。以下均为 Linux 命令，不是在自己 Windows PowerShell 里执行。**

```sh
whoami
uname -m
cat /etc/os-release
```

应该是 Ubuntu 24.04、`x86_64`，优先使用有 sudo 权限的普通账户。若当前是 root，让 AI 先引导你用 `adduser mcp-builder`、`usermod -aG sudo mcp-builder`、`su - mcp-builder` 创建并切换普通账户；新系统密码在终端本人输入。后续只有明确的系统安装步骤用 sudo，npm 安装不使用 sudo。

```sh
sudo apt-get update
sudo apt-get install -y git curl xz-utils ca-certificates nginx dnsutils nano
```

**成功标志：** 安装结束返回命令提示符，`git --version` 可用。**失败排查：** sudo 权限、系统版本、软件源和剩余磁盘；ARM 主机不能继续使用下文 x64 包，请 AI 按匹配架构和模板路径调整。

## 4. 安装项目指定的 Node.js 和 npm

Node.js 用来运行后端；npm 用来安装代码需要的包。本仓库要求 Node 24.20.0 / npm 11.19.0，不能直接用系统可能附带的旧版 Node，也不要随意升到 25。

**在哪里：服务器普通用户终端。**

```sh
mkdir -p ~/mcp-downloads
cd ~/mcp-downloads
curl -fLO https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-x64.tar.xz
curl -fLO https://nodejs.org/dist/v24.20.0/SHASUMS256.txt
sha256sum --ignore-missing --check SHASUMS256.txt
```

**成功标志：** 对刚下载的 `node-v24.20.0-linux-x64.tar.xz` 显示 `OK`。下载或校验失败必须先解决，不能跳过校验。接下来确认 `/opt/node-v24.20.0-linux-x64` 不存在；若已存在，先检查其中 Node 版本，不要覆盖。

```sh
sudo tar -xJf node-v24.20.0-linux-x64.tar.xz -C /opt
export PATH=/opt/node-v24.20.0-linux-x64/bin:$PATH
node --version
npm --version
```

应分别看到 `v24.20.0`、`11.19.0`。每次重新打开终端都先执行上述 `export PATH=...`；systemd 使用绝对路径，不依赖它。来源为 [Node 官方发行目录](https://nodejs.org/dist/v24.20.0/)。若看到别的版本，运行 `command -v node` 排查路径，不要改仓库版本限制掩盖问题。

## 5. 下载代码并做离线验证

**在哪里：服务器普通用户终端。**

```sh
cd ~
git clone https://github.com/AriaEternity/xiaokui-luckin-mcp.git
cd ~/xiaokui-luckin-mcp
npm ci --ignore-scripts
npm run verify
```

**成功标志：** 类型检查、构建、测试与公开扫描全部通过，出现 `dist/main.js`。测试只使用虚构店铺/商品和回环网络；**通过测试不代表能查询真实瑞幸账户，更不代表已下单**。本项目使用 Node 内置 SQLite，没有 better-sqlite3 原生安装步骤。

**失败排查：** `EBADENGINE` 查 Node/npm；`npm ci` 网络错误查官方 npm 出站；不能删锁文件改用任意依赖版本；测试失败先给 AI 看脱敏的错误名，不要反复重跑。目录已存在时先 `git status` 核对，不能再次覆盖克隆。

## 6. 建立独立程序目录和服务用户

**在哪里：仍在服务器 `~/xiaokui-luckin-mcp`。仅用于首次安装。**

```sh
sudo useradd --system --home-dir /var/lib/xiaokui-luckin --shell /usr/sbin/nologin xiaokui-luckin
sudo install -d -m 0700 -o xiaokui-luckin -g xiaokui-luckin /var/lib/xiaokui-luckin
sudo install -d -m 0700 -o root -g root /etc/xiaokui-luckin
sudo install -d -m 0755 /opt/xiaokui-luckin/releases
RELEASE=/opt/xiaokui-luckin/releases/initial
test ! -e "$RELEASE"
```

最后一行成功时不输出内容；**若失败就停止，不执行下一块**。用户/目录已存在也先核对，不能用递归改权限或删除来“重来”。

```sh
sudo mkdir "${RELEASE:?请先设置本节RELEASE}"
sudo cp -R dist node_modules scripts package.json package-lock.json LICENSE THIRD_PARTY_NOTICES.md "${RELEASE:?}/"
sudo chmod -R u=rwX,go=rX "${RELEASE:?}"
sudo ln -s "${RELEASE:?}" /opt/xiaokui-luckin/current
readlink -f /opt/xiaokui-luckin/current
```

**成功标志：** 最后一行指向 `/opt/xiaokui-luckin/releases/initial`。程序归 root 管理，服务用户只写自己的状态目录。`data/`、秘密、日志和 `.git` 没有复制进运行程序。权限错误先核对命令所在目录和目标，不要 `chmod 777`。

## 7. 初始化本站主人账号，安全保存官方 Token

**在哪里：服务器交互终端。** 主人账号是你自己网关的登录账号，与瑞幸账号和 ChatGPT 账号不同。`owner:init` 会隐藏输入至少 16 字符的口令，只保存随机 salt 与 scrypt 哈希，不能覆盖旧主人。

下面执行 `npm run owner:init` 对应的同一脚本，用绝对路径把文件直接放到 root 私有目录：

```sh
sudo env OWNER_FILE=/etc/xiaokui-luckin/owner.json /opt/node-v24.20.0-linux-x64/bin/node /opt/xiaokui-luckin/current/scripts/owner-init.mjs
sudo chmod 0400 /etc/xiaokui-luckin/owner.json
```

默认用户名为 `owner`。两次输入自己设置的长口令，不显示字符是正常的。成功会提示主人配置已创建。请存入自己的密码管理器，**不要发到 AI、issue 或截图里**。初始化失败优先检查已有文件和交互终端；不能删除主人文件来重建身份。

本人在官方平台登录并取得 Token 后，只在自己服务器终端执行以下隐藏输入命令，粘贴 Token 时**不带 `Bearer ` 前缀**：

```sh
sudo bash -c 'set -euo pipefail; set -C; umask 077; read -r -s -p "Luckin Token (without Bearer): " coffee_token; printf "\n" >&2; test -n "$coffee_token"; printf "%s\n" "$coffee_token" > /etc/xiaokui-luckin/luckin-token; chmod 0400 /etc/xiaokui-luckin/luckin-token; unset coffee_token'
sudo stat -c '%F %a %U %G %h' /etc/xiaokui-luckin/owner.json /etc/xiaokui-luckin/luckin-token
```

**成功标志：** 两个文件均为常规文件、权限 400、root 所有、链接数 1。不要 `cat` 文件或把 Token 写在命令参数里。官方没有给你使用资格时在此停止，本项目不提供绕过、代申请或共享凭据。

## 8. 配置并启动服务，设置开机启动

**在哪里：服务器终端。** `sudo nano /etc/xiaokui-luckin/bridge.env` 打开编辑器，填入下列非秘密内容，域名换成自己的：

```ini
PUBLIC_ORIGIN=https://coffee.example.com
DATA_ROOT=/var/lib/xiaokui-luckin
PORT=4318
SYNTHETIC_UPSTREAM=false
ENABLE_PREVIEW=false
ENABLE_ORDERS=false
ENABLE_ORDER_CREATE=false
```

nano 用 Ctrl+O、回车保存，Ctrl+X 退出。`PUBLIC_ORIGIN` 不带路径/末尾斜杠；这里不填任何 Token。先只开放 catalog 查询。systemd 的 LoadCredential 会为进程提供主人文件和 Token 的安全副本。

```sh
cd ~/xiaokui-luckin-mcp
sudo install -m 0644 deploy/xiaokui-luckin.service /etc/systemd/system/xiaokui-luckin.service
sudo systemd-analyze verify /etc/systemd/system/xiaokui-luckin.service
sudo systemctl daemon-reload
sudo systemctl enable --now xiaokui-luckin.service
sudo systemctl is-active xiaokui-luckin.service
curl --fail http://127.0.0.1:4318/health/ready
```

**成功标志：** `active` 与 `{"status":"ready"}`。关闭终端不会停止服务，机器重启后自动启动，数据保存在 `/var/lib/xiaokui-luckin`。若报错，按 [FAQ](faq.md) 检查凭据元数据、Node 绝对路径、端口与 unit；不要打印全部环境或 HTTP 正文来排错。

## 9. 配置 HTTPS（先申请证书，再安装正式站点）

**在哪里：服务器终端。** 先创建一个仅供证书验证的 HTTP 站点，避免证书还不存在就安装含证书路径的模板。本文只适用于新子域名，已有同名站点先请 AI 核对。

```sh
sudo install -d -m 0755 /var/www/xiaokui-acme
sudo nano /etc/nginx/sites-available/xiaokui-luckin
```

填入下面内容（替换域名）：

```nginx
server {
    listen 80;
    server_name coffee.example.com;
    root /var/www/xiaokui-acme;
    location ^~ /.well-known/acme-challenge/ { try_files $uri =404; }
    location / { return 404; }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/xiaokui-luckin /etc/nginx/sites-enabled/xiaokui-luckin
sudo nginx -t
sudo systemctl reload nginx
sudo snap install --classic certbot
sudo /snap/bin/certbot certonly --webroot -w /var/www/xiaokui-acme -d coffee.example.com
```

本人填写通知邮箱、阅读并决定是否同意证书服务条款。成功后证书在 `/etc/letsencrypt/live/自己的域名/`。失败先查 DNS、80 端口、旧 AAAA、代理和 nginx 配置，不能绕过证书校验。依据 [Ubuntu HTTPS 文档](https://ubuntu.com/server/docs/how-to/security/obtain-tls-certificates/)。

如果 `snap` 不存在，先在 Ubuntu 安装 `sudo apt-get install -y snapd`，核对 `snapd.socket` 与初始化状态后再继续。受管平台不支持 snap/systemd 时，不属于本教程验证路线，请 AI 按官方平台文档重新确认方案，不能用随机安装脚本替代。

保持上面的 80 站点供后续续期。在同一个站点文件末尾追加仓库 `deploy/nginx-site.conf` 的完整 HTTPS server 块，并把其中**域名和两条证书路径**都替换成自己的。然后：

```sh
cd ~/xiaokui-luckin-mcp
sudo install -m 0644 deploy/nginx-proxy.conf /etc/nginx/snippets/xiaokui-luckin.conf
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://coffee.example.com/.well-known/oauth-authorization-server
curl -sS -o /dev/null -w '%{http_code}\n' https://coffee.example.com/api/luckin/mcp
```

**成功标志：** 元数据包含你自己的 issuer，最后返回 `401`，代表匿名访问被正确拦截。根网址 404 正常，项目没有首页。网站必须是浏览器信任的 HTTPS；不能为 Secure Cookie 改用 HTTP。

设置证书更新后平滑加载 nginx（只在自己的新机器上）：

```sh
sudo install -d /etc/letsencrypt/renewal-hooks/deploy
sudo nano /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

写入两行 `#!/bin/sh` 和 `systemctl reload nginx`，保存后执行：

```sh
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo systemctl status snap.certbot.renew.timer --no-pager
sudo /snap/bin/certbot renew --dry-run
```

应看到续期定时器 active、演练成功；失败先解决再长期使用。不要在安装网页证书时向 AI 提供私钥。

## 10. 在 ChatGPT 连接只读查询

**在哪里：自己电脑浏览器中的 ChatGPT 网页。** 根据当前账号可见入口，在插件页面新增自定义 MCP，选择 **OAuth** 和预注册/静态客户端。不要选择无认证、混合认证、DCR 或 CIMD；本仓库没有提供后两者的注册端点。

| 要填的项目 | 首次只读连接 |
|---|---|
| Server URL / Resource | `https://coffee.example.com/api/luckin/mcp` |
| Client ID | `xiaokui-chatgpt-luckin` |
| Client Secret | 留空，绝不是瑞幸 Token |
| Scope | `luckin:catalog:read` |
| Authorization URL | `https://coffee.example.com/oauth/authorize` |
| Token URL | `https://coffee.example.com/oauth/token` |
| PKCE / Token endpoint auth | S256 / none |
| Redirect URI | `https://chatgpt.com/connector_platform_oauth_redirect` |

部分字段由发现文档自动获得，不必在界面找不存在的输入框。完整参数见 [ChatGPT 指南](chatgpt.md)。官方入口和账号策略见第 0 步链接；本仓库符合稳定回调的 issuer 标识模式，但仍应核对管理页实际回调，若不一致先排查，不能放宽重定向白名单。

创建并安装后，首次调用会跳到自己的 HTTPS 网站。用第 7 步的 `owner` 和本站口令登录，核对“只读查询”再同意。**这是连接授权，不是任何一笔订单批准。**

**成功标志：** 看到 3 个工具，ChatGPT 能用连接查询自己指定的公开地点附近门店、商品和详情。门店查询需要你明确允许使用的经纬度；可选公开商场，不必提供家庭地址。模型不能猜坐标或商品编码。这里开始访问真实官方账户，返回菜单价仍不是最终订单价。

**失败排查：** 没有添加入口先查账号权限；401 查授权是否完成；invalid_target/invalid_scope 查 Resource、Client ID、Scope 是否属于同一入口；登录反复出现先检查 HTTPS/Cookie，服务重启后本项目网页登录需要重新登录。

## 11. 再启用真实预览，保持创建关闭

**在哪里：服务器终端。** 编辑 `bridge.env`，只把 `ENABLE_PREVIEW` 改成 `true`，保留 `ENABLE_ORDERS=false`、`ENABLE_ORDER_CREATE=false`，然后：

```sh
sudo systemctl restart xiaokui-luckin.service
curl --fail http://127.0.0.1:4318/health/ready
```

**在哪里：ChatGPT。** 新增一个 preview 连接，使用 `/api/luckin/preview/mcp`、`xiaokui-chatgpt-luckin-preview`、`luckin:checkout:preview`，OAuth authorize/token URL 与上一步相同。原 catalog 授权不会自动变成 preview。

可对 AI 说：“只用我的瑞幸预览连接，按我指定门店查询一杯咖啡，读取规格后试算，展示规格、数量、优惠和实际应付。现在不要创建、批准或支付任何订单。”

**成功标志：** 5 个工具；实际官方预览有明确金额和配置。没预览报价就不能把菜单价说成实付。若后续本人决定开启真实交易，再单独阅读 [完整点单](chatgpt.md#首次完整点单) 和 [安全模型](../SECURITY.md)，启用 orders 及创建总开关，新增对应连接，并亲自在受保护网页逐笔批准。本教程到预览即完成，不要求你购买饮品。

## 12. 保留数据、备份和排障

- `/etc/xiaokui-luckin`：主人哈希、Token、非秘密配置；只能本人管理，不上传 GitHub。
- `/var/lib/xiaokui-luckin`：OAuth 数据和订单状态；服务重启保留。网页登录会话在内存，重启后重新登录，不影响已经持久化的订单证据。
- `/opt/xiaokui-luckin/current`：当前程序，可切换版本；更新走 [部署与恢复](deployment.md#回退与恢复)，不要在正在运行的目录中直接升级依赖。
- 做一致性备份时先停**本实例**，把配置/状态备份存入受限、加密位置，再启动；快照可能含凭据与订单，绝不能进公开仓库。回滚代码时保留当前 OAuth、订单、UNKNOWN 和锁，不用旧状态覆盖。
- 同机安装另一个 MCP 时，使用不同服务用户、目录、域名和监听端口；不能两个都绑定 4318。请 AI 同时修改 PORT 和相应 nginx `proxy_pass`。

遇到 UNKNOWN/创建超时：立即停止创建，在官方账户本人核实；不重试、不换 intent、不删锁或数据。其他错误见 [常见问题](faq.md)。向 AI 只提供错误名/状态码与脱敏配置，不提供密码、Token、Cookie、授权链接、付款链接、订单号或私人地址。

## 验证范围

原私人实践有真实付款取餐案例；此独立公开版沿用已记录的合成验证，本轮新手教程不代表在新云商、新域名、新账号执行过安装或真实交易。命令依赖上述 Ubuntu/x64/权限条件，域名、官方账号资格、费用、TLS 和 ChatGPT OAuth 必须由使用者在自己的环境完成。没有承诺所有账号/地区/套餐都可用。
