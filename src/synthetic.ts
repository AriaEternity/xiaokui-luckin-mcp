// 全部为独立编写的假数据。此传输不调用fetch、DNS或任何真实账户。
export const syntheticQuote=()=>({
 shopInfo:{deptId:91001,deptName:'合成演示门店（不是真实店铺）',address:'纯合成地址',longitude:110.1,latitude:30.1},
 productInfoList:[{productId:91002,skuCode:'SYNTHETIC-COLD',amount:1,name:'合成演示咖啡',additionDesc:'合成大杯/冷/无糖'}],
 totalInitialPrice:29.9,privilegeMoney:20,discountPrice:9.9,couponCodeList:['SYNTHETIC-COUPON'],
});
export function syntheticTransport():typeof fetch {
 return async(_input,init)=>{
  if(init?.method==='GET')return new Response(null,{status:405});
  const body=JSON.parse(String(init?.body??'{}'));
  if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'SYNTHETIC-NO-REAL-ACCOUNT',version:'1'}}});
  if(body.method==='notifications/initialized')return new Response(null,{status:202});
  let data:unknown;
  switch(body.params?.name){
   case 'queryShopList':data=[syntheticQuote().shopInfo];break;
   case 'searchProductForMcp':data=[{productId:91002,productName:'合成演示咖啡',skuCode:'SYNTHETIC-COLD'}];break;
   case 'queryProductDetailInfo':data={productId:91002,skuCode:'SYNTHETIC-COLD',productAttrs:[{attributeId:1,attributeName:'温度',productSubAttrs:[{attributeId:2,attributeName:'冷',selected:true,canSelected:true}]}]};break;
   case 'switchProduct':data={productId:91002,skuCode:'SYNTHETIC-COLD'};break;
   case 'previewOrder':data=syntheticQuote();break;
   case 'createOrder':data={orderIdStr:'9000000000000000001',needPay:true,discountPrice:9.9};break;
   case 'queryOrderDetailInfo':data={orderId:'9000000000000000001',orderStatus:10};break;
   default:throw Error('SYNTHETIC_TOOL_DENIED');
  }
  return Response.json({jsonrpc:'2.0',id:body.id,result:{isError:false,content:[{type:'text',text:JSON.stringify({code:0,msg:'success',success:true,data})}]}});
 };
}
