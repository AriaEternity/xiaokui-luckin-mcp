# 在ChatGPT连接自己的瑞幸MCP

本文使用公开独立版路径/客户端ID，不能直接拿来覆盖原私人系统的连接。先按部署指南完成HTTPS、主人账户和自己的凭据。入口要求完整OAuth，**不要选择“OAuth或无认证”的混合模式**。

![流程示意，非界面截图](flow.svg)

## 连接参数

将以下`coffee.example.com`换成你在PUBLIC_ORIGIN中配置的**完全一致**的HTTPS origin，无末尾斜杠：

| 参数 | 完整点单 |
|---|---|
| Server URL / Resource | `https://coffee.example.com/api/luckin/orders/mcp` |
| Client ID | `xiaokui-chatgpt-luckin-orders` |
| Client Secret | 留空，public client |
| Scope | `luckin:orders:create` |
| Authorization URL | `https://coffee.example.com/oauth/authorize` |
| Token URL | `https://coffee.example.com/oauth/token` |
| Issuer | `https://coffee.example.com` |
| Callback | `https://chatgpt.com/connector_platform_oauth_redirect` |
| Token endpoint auth | none |
| PKCE | S256 |

只有查询时使用`/api/luckin/mcp`、`xiaokui-chatgpt-luckin`、`luckin:catalog:read`；只有预览时使用`/api/luckin/preview/mcp`、`xiaokui-chatgpt-luckin-preview`、`luckin:checkout:preview`。各客户端只允许自己的资源和scope。

## 操作路径

在ChatGPT网页的插件页面选择添加自定义MCP，填写服务器URL，选择OAuth及预注册客户端，检查权限并创建/安装。首次使用时在**自己的HTTPS网站**登录主人账户，核对scope后同意。按账号和工作区权限，实际入口名称可能不同。[OpenAI添加自定义MCP官方说明](https://developers.openai.com/api/docs/guides/custom-mcp-server)提供当前操作路径。

如果使用文件式配置，可以参考`examples/chatgpt-mcp.json`中的provided client配置；它只是模板，不包含凭据，也不自动创建插件。预注册客户端、`none`及参数字段依据[官方认证指南](https://developers.openai.com/plugins/build/auth)和[配置参考](https://developers.openai.com/plugins/build/plugins)。本项目不提供DCR/CIMD端点；不要填不存在的registration URL。

添加后应发现orders七工具；如只见三工具，检查是否连接了catalog，或刷新工具清单。OAuth报invalid_target/invalid_scope时核对URL、client和scope，不能通过放宽服务端校验解决。不要把瑞幸Token填入ChatGPT的Client Secret。

## 首次完整点单

可以对AI说：

> 使用我的瑞幸点单连接，帮我在我指定的门店选一杯咖啡。先读取真实商品规格并预览，展示门店、完整规格、数量、优惠与应付金额，再给我本人的确认链接。在我于网页批准前不要创建订单。

本人点击确认页、登录并批准，回到同一ChatGPT对话让AI继续。网页批准只批准本笔、尚未下单或付款；服务端仍会重核。实际创建后请自己扫码，随后让AI查询官方状态。不要根据一句“我付了”推断支付或展示取餐码。

创建超时/UNKNOWN时先核实官方账户，禁止继续尝试重建。不能通过编辑MCP参数增加`confirmed:true`或让模型调用批准端点绕过页面。

## 验证范围

来源项目已在ChatGPT真实完成首单。公开版已做独立合成OAuth/HTTP/SDK验证，尚需使用者在自己的域名和账号完成连接及真实验收；文档不保证任意账号、地区、移动端或未来UI可用。无需为本项目提供OpenAI API Key。
