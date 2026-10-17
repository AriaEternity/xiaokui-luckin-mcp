# 来源、许可与商标

本项目从仓库维护者自有 KuiNest v4 中按明确文件清单抽取瑞幸桥接代码，并由维护者授权以 MIT 发布。源项目标记为 UNLICENSED 不代表整个私人项目被重新许可；授权只适用于本公开仓库列出的内容。来源和变换见 `docs/source-provenance.json`。

本仓库不含原项目第三方 node_modules、Node发行二进制或任何私人运行数据。依赖由 npm 按 package-lock.json 安装，保留各自版权/许可证：

| 直接依赖 | 用途 | 许可证 |
|---|---|---|
| @modelcontextprotocol/sdk | MCP、Streamable HTTP、OAuth协议处理 | MIT |
| fastify | HTTP服务 | MIT |
| @fastify/cookie | 主人会话Cookie | MIT |
| @fastify/rate-limit | 请求限流 | MIT |
| express | 官方SDK的OAuth处理器装配 | MIT |
| typescript | 构建工具 | Apache-2.0 |
| @types/node、@types/express | 类型声明 | MIT |

Node内置SQLite随Node发行版提供，遵守其发行版所附声明；本仓库不分发Node或SQLite二进制。传递依赖以锁文件和安装包自带许可为准。

瑞幸咖啡、luckin coffee、ChatGPT、OpenAI等名称用于说明兼容性，各商标归其权利人。本项目不隶属、不代表也不获上述公司背书。

官方 my-coffee Skill 仅作为接口流程参考，未复制、修改或重新分发；请从[官方入口](https://open.lkcoffee.com/skill)取得并遵守其独立许可。社区参考项目仅链接致谢，不声称拥有其代码或把它们纳入本项目MIT授权。
