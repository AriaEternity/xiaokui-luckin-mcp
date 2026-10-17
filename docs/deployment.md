# 部署、凭据与恢复

这是给自己的**独立新实例**的示例，不是修改任何既有KuiNest/聊天服务的脚本。本文命令没有自动执行。先确认目标机器、域名、端口、备份和权限；已有服务占用4318时换本实例PORT并同步nginx，不能停掉原服务。

## 1. 工具链与全新release

使用Node 24.20.0 / npm11.19.0。可从[Node官方下载目录](https://nodejs.org/dist/v24.20.0/)获取匹配架构的发行包，按该目录官方SHASUMS256.txt验证实际下载文件；不要复制Windows node_modules到Linux。systemd示例假设Node安装在`/opt/node-v24.20.0-linux-x64`，实际不同则同时修正ExecStart。

在普通用户的干净构建目录执行`npm ci --ignore-scripts && npm run verify`。代码使用Node内置SQLite，无需打开安装脚本或手动构建原生模块。准备全新、唯一release，例如`/opt/xiaokui-luckin/releases/20261017-v0.1.0`，目标已存在即停止。发布运行文件为`dist/`、`node_modules/`、package.json、package-lock.json和LICENSE/第三方声明；保留依赖许可证与实际运行文件，不在生产安装新依赖。

发布归档只从这些明确文件构建，解包前检查路径、链接和SHA-256，不含data、secrets、.env、日志、数据库或原工程备份。代码root拥有且服务用户只读。`current`为root维护的指向该release的符号链接；WorkingDirectory与ExecStart均通过该指针，不只切换工作目录而遗留旧绝对启动脚本。

## 2. 单主人与私有目录

在独立主机上由管理员创建专用非登录用户和状态目录：

```sh
sudo useradd --system --home-dir /var/lib/xiaokui-luckin --shell /usr/sbin/nologin xiaokui-luckin
sudo install -d -m 0700 -o xiaokui-luckin -g xiaokui-luckin /var/lib/xiaokui-luckin
sudo install -d -m 0700 -o root -g root /etc/xiaokui-luckin
```

用户或目录已存在时先核对，不重复创建或递归改权限。在本机交互终端运行`umask 077; npm run owner:init`，仅隐藏输入主人口令；将生成的owner.json以root:0400安装到`/etc/xiaokui-luckin/owner.json`。目标已存在时先停下来核对，不能覆盖旧主人配置。不要把该文件纳入公开归档，即使其中只有哈希。

## 3. 瑞幸Token安全注入

使用自己的官方合法凭据，不要粘贴进聊天、issue、命令参数或环境变量。以下在管理员本机终端隐藏输入，目标已存在会拒绝覆盖：

```sh
sudo bash -c 'set -euo pipefail; set -C; umask 077; read -r -s -p "Luckin Token (without Bearer): " coffee_token; printf "\n" >&2; test -n "$coffee_token"; printf "%s\n" "$coffee_token" > /etc/xiaokui-luckin/luckin-token; chmod 0400 /etc/xiaokui-luckin/luckin-token; unset coffee_token'
```

原始源文件root:0400，父目录0700；systemd通过LoadCredential生成只读运行副本，Node只接收路径。不要使用`systemctl show ... Environment`全文、`cat`、请求追踪或抓包来验Token。

创建`/etc/xiaokui-luckin/bridge.env`，只放非秘密配置：

```ini
PUBLIC_ORIGIN=https://coffee.example.com
DATA_ROOT=/var/lib/xiaokui-luckin
PORT=4318
SYNTHETIC_UPSTREAM=false
ENABLE_PREVIEW=false
ENABLE_ORDERS=false
ENABLE_ORDER_CREATE=false
```

**默认仅catalog；以后逐步启用preview/orders；真正创建最后单独开启。** OWNER_FILE与LUCKIN_TOKEN_FILE由示例unit使用`%d`凭据目录指定，不在env文件写入实际Token。不要在同一实例切换到别人的瑞幸账户或随意替换主人标识；已有intent/授权与其绑定。

## 4. 加载前的只读预检

- Node/npm、Linux架构与资源：`node --version`、`npm --version`、`uname -m`、`free -m`、`df -h /opt /var/lib`。
- 当前指针：`readlink -f /opt/xiaokui-luckin/current`，确认全新目标且代码权限只读。
- 凭据只查元数据：`sudo stat -c '%F %a %U %G %h' /etc/xiaokui-luckin/luckin-token /etc/xiaokui-luckin/owner.json`。应常规文件、0400、root、硬链接数1；不要输出内容。
- 检查unit、全部drop-in和旧ExecStart，不能意外继承其他实例配置；`systemd-analyze verify`仅做语法/依赖检查，不能证明凭据已加载。
- 检查现有nginx虚拟主机、端口冲突、自己的证书与PUBLIC_ORIGIN一致；出站需允许官方HTTPS。

## 5. 启动与HTTPS验收

根据目标主机安装并审阅`deploy/xiaokui-luckin.service`、nginx站点及代理片段。unit采用专用用户、umask0077、只写独立状态根、256MiB内存上限；`LoadCredential`源文件必须在启动前存在，加载失败可能在Node启动前使unit失败。**普通用户systemd测试不能替代生产系统管理器的加载检查。**

实际应用时先`nginx -t`、unit verify，之后才`systemctl daemon-reload`与启动这个新服务，最后平滑reload nginx。不要复制示例覆盖不相关站点或重启其他应用。确认：

```sh
curl --fail http://127.0.0.1:4318/health/ready
curl --fail https://coffee.example.com/.well-known/oauth-authorization-server
curl --fail https://coffee.example.com/.well-known/oauth-protected-resource/api/luckin/mcp
curl -i https://coffee.example.com/api/luckin/mcp
```

最后一项应401并带正确resource_metadata challenge。查询成功后，启用preview/orders，按ChatGPT指南新增相应OAuth连接、发现5/7工具；先真实预览验收。启用`ENABLE_ORDER_CREATE=true`后仍需要本人逐笔批准。自动化检查不能调用真实create/cancel/pay，也不能替用户生成或消费真实批准。

检查运行副本是否被本程序接受，可以看新资源元数据、匿名401、健康与本人的只读查询；不要打印凭据内容或把“systemd启动成功”误作上游认证成功。若缺凭据启动失败，先关闭创建、核对元数据/源权限，不改变安全策略兼容不可信文件。

## 回退与恢复

1. 升级前保存当前release指向、unit/env/nginx的受限副本及SHA；数据备份另行加密，不能进公开包。
2. 部署始终新建release，保留旧版。不覆盖历史目录，不在运行中执行npm升级。
3. 紧急停建单：仅把本实例`ENABLE_ORDER_CREATE`改false并重启本实例；保留订单状态和OAuth库。不要自动取消。
4. 完整回退：先核对当前配置仍等于本次发布后的哈希；恢复旧env/unit/nginx与旧指针，语法检查后仅重启本实例、按需reload nginx。有漂移先合并撤回，不能覆盖他人改动。
5. **不恢复旧OAuth数据库快照，不删除intent/锁，不复制或改写Token。** 旧版不支持订单时，应保持订单路由关闭；仍保留全部新状态，待恢复新版本或本人官方核实。
6. SUBMITTING/UNKNOWN/遗留锁只统计状态，不输出商品/订单/支付详情；必须本人在官方账户核实。回退不能撤销上游已创建订单，不能把未知状态变成可重试。
7. 重新升级仍使用原状态和授权绑定，验证老授权、refresh、原只读路由，以及UNKNOWN/重放不重新建单。

本公开版本未替使用者改任何真实systemd/nginx，也不声称所有Linux发行版、系统管理器或资源配置均已实测。首次落地应先独立演练，再由本人做受控真实验收。
