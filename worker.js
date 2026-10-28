// Cloudflare Worker для бойчика. Использует Workers AI через binding "AI".
const ALLOWED_ORIGINS = ["https://comedyfox6-oss.github.io"];
const MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/meta/llama-3.1-8b-instruct",
];
const MAX_MESSAGES=20, MAX_CHARS=2000, MAX_TOKENS=300;
export default {
 async fetch(req,env){
  const origin=req.headers.get("Origin")||"";
  const isLocal=/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowed=ALLOWED_ORIGINS.includes(origin)||isLocal;
  const cors={"Access-Control-Allow-Origin":allowed?origin:ALLOWED_ORIGINS[0],"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"};
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST") return json({error:"use POST"},405,cors);
  if(!allowed) return json({error:"forbidden origin"},403,cors);
  let body; try{body=await req.json()}catch{return json({error:"bad json"},400,cors)}
  const messages=cleanMessages(body&&body.messages);
  if(!messages.length)return json({error:"no messages"},400,cors);
  const max_tokens=clamp(Number(body.max_tokens)||200,20,MAX_TOKENS);
  const temperature=clamp(body.temperature==null?0.9:Number(body.temperature),0,1.2);
  for(const model of MODELS){
   try{
    const out=await env.AI.run(model,{messages,max_tokens,temperature});
    const text=extractText(out);
    if(text)return json({choices:[{message:{role:"assistant",content:text}}],model},200,cors);
   }catch(e){/* пробуем следующую модель */}
  }
  return json({error:"ai_unavailable"},502,cors);
 }
};
function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
function json(obj,status,headers){return new Response(JSON.stringify(obj),{status,headers:{"Content-Type":"application/json; charset=utf-8",...headers}})}
function cleanMessages(input){
 if(!Array.isArray(input))return [];
 const roles=["system","user","assistant"];
 const list=input.filter(m=>m&&roles.includes(m.role)&&typeof m.content==="string"&&m.content.trim()).map(m=>({role:m.role,content:m.content.slice(0,MAX_CHARS)}));
 const system=list.filter(m=>m.role==="system").slice(0,1),rest=list.filter(m=>m.role!=="system").slice(-MAX_MESSAGES),merged=[];
 for(const m of rest){const last=merged[merged.length-1];if(last&&last.role===m.role)last.content+="\n"+m.content;else merged.push({...m})}
 while(merged.length&&merged[0].role!=="user")merged.shift();
 return [...system,...merged]
}
function extractText(out){
 if(!out)return "";
 let t=(typeof out==="string"&&out)||(out.response&&String(out.response))||(out.choices&&out.choices[0]&&out.choices[0].message&&out.choices[0].message.content)||(out.result&&out.result.response)||"";
 return String(t).replace(/<think>[\s\S]*?<\/think>/gi,"").trim()
}