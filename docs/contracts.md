# 工具契约、金额与官方来源

上游地址固定为`https://gwmcp.lkcoffee.com/order/user/mcp`，Streamable HTTP，服务器Bearer认证。MCP SDK处理初始化、JSON/SSE和取消，案例协商版本为2025-06-18。SDK的GET SSE监听收到405可以与正常POST调用并存，不能据此单独判定断连。

| 工具 | 模型可提交的参数 | 作用及顺序 |
|---|---|---|
| queryShopList | longitude、latitude、可选deptName | 先确定店铺；不擅自定位用户 |
| searchProductForMcp | deptId、query | 在已选店搜索 |
| queryProductDetailInfo | deptId、productId | 获取真实属性、可选项和SKU |
| switchProduct | deptId、productId、skuCode、amount、attrOperationParam | 使用最新合法属性ID；subAttr.operation只允许3，随后使用返回SKU |
| previewOrder | deptId、productList | productList含productId、skuCode、amount；允许官方自动优惠；orders入口额外生成intent与确认链接 |
| createOrder | **仅intentId** | 非官方裸参数；服务器逐笔确认、重报价、持久SUBMITTING后组装官方参数 |
| queryOrderDetailInfo | **仅intentId** | 仅查询同授权链已知订单；不接受任意官方orderId |

`cancelOrder`等不在白名单中；不存在付款工具。规格operation其他值没有足够官方依据，不做推测。属性ID、SKU不能用示例值请求真实账户。

预览的主要业务层级为`{code:0, success, data:{...}}`，同时支持文本JSON和structuredContent；多个相互冲突的业务对象会拒绝。金额字段为人民币元，允许小数，代码转换为整数分校验：

| 字段 | 解释 |
|---|---|
| totalInitialPrice | 商品面价合计 |
| privilegeMoney | 优惠合计 |
| discountPrice | 实际应付 |
| couponCodeList | 官方匹配券代码；仅内部快照/建单使用，不暴露到模型 |
| productInfoList | 商品、SKU、数量、完整规格描述 |
| shopInfo | 店铺标识、名称、地址与坐标 |

`totalInitialPrice - privilegeMoney === discountPrice`必须精确成立；商品集合、SKU、数量与请求一致。金额单位来自用户确认及真实案例响应，官方Schema的`number`本身不代表整数分。预览不是建单，但官方可能结合账户优惠信息试算；本项目不伪造“绝对无账户副作用”或“强制禁券”保证。

创建优先使用`orderIdStr`避免JS安全整数精度丢失；二维码来自`payOrderQrCodeUrl`，不返回`payOrderUrl`。不需要付款时明确返回needPay=false。查询状态10为待付；20仅下单成功；30/60/80在已验证映射中分别为制作/待取/完成，才开放取餐信息；未知/取消状态不推断付款。

## 可追溯来源

- [瑞幸AI开放平台](https://open.lkcoffee.com/mcp)、[工具文档](https://open.lkcoffee.com/docs)。
- [switchProduct](https://open.lkcoffee.com/docs#switchProduct)、[previewOrder](https://open.lkcoffee.com/docs#previewOrder)、[createOrder](https://open.lkcoffee.com/docs#createOrder)、[queryOrderDetailInfo](https://open.lkcoffee.com/docs#queryOrderDetailInfo)。
- [官方Skill入口](https://open.lkcoffee.com/skill)：仅参考流程，不打包其内容，不将其授权混入MIT。
- [MCP传输](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)、[生命周期](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)。

官方文档/Schema、维护者原项目真实验证、当前公开代码/合成测试是不同证据来源。官方接口后续变动应重新核对；本文不是上游长期合同或运营许可。
