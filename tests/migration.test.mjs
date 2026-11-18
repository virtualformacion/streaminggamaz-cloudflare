import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decode64} from '../lib/encoding.js';
import {onRequest as email} from '../functions/api/getLastEmail.js';
import vm from 'node:vm';
const legacy=await readFile(new URL('fixtures/original-getLastEmail.cjs',import.meta.url),'utf8');
const env={GMAIL_CLIENT_ID:'fake',GMAIL_CLIENT_SECRET:'fake',GMAIL_REFRESH_TOKEN:'fake'};
const codes=["amazon.com: Sign-in attempt", "amazon.com: Intento de inicio de sesión", "Netflix: Tu código de inicio de sesión", "Este código vence en 15 minutos", "Tu código de acceso único para Disney+"];
const subjects=["Importante: Cómo actualizar tu Hogar con Netflix", "Importante: Cómo cambiar tu Hogar con Netflix", "Tu código de acceso temporal de Netflix", "Tu código de acceso temporal de Netflix", "Completa tu solicitud de cambio de contraseña", "Completa tu solicitud de restablecimiento de contraseña"];
const urls=['https://www.netflix.com/account/travel/verify?nftoken=123','https://www.netflix.com/account/update-primary-location?nftoken=456','https://www.netflix.com/password?g=789'];
function msg(subject,body='<p>Código 123456 🟢 ??? ~~~</p>',mime='text/html',age=0,to='test@example.com') {
 return {payload:{headers:[{name:'To',value:to},{name:'Subject',value:subject},{name:'Date',value:new Date(Date.now()-age).toUTCString()}],body:{},parts:[{mimeType:mime,body:{data:Buffer.from(body).toString('base64url')}}]},snippet:body};
}
async function legacyResult(messages){
 const mock={users:{getProfile:async()=>({data:{emailAddress:'test@example.com'}}),messages:{list:async()=>({data:messages.length?{messages:messages.map((_,i)=>({id:String(i)}))}:{}}),get:async({id})=>({data:messages[Number(id)]})}}};
 const context={exports:{},process:{env},Buffer,console:{log(){}},setTimeout:fn=>fn(),require:name=>name==='dotenv'?{config(){}}:{google:{auth:{OAuth2:class{setCredentials(){}}},gmail:()=>mock}}};
 vm.runInNewContext(legacy,context);
 const r=await context.exports.handler({body:JSON.stringify({email:'test@example.com'})});return {status:r.statusCode,data:JSON.parse(r.body)};
}
async function migratedResult(messages,partStatus=200){
 const realFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{
  calls++;
  if(url.includes('oauth2'))return Response.json({access_token:'fake'});
  assert.equal(options.headers.Authorization,'Bearer fake');
  if(url.includes('messages?')){assert.equal(new URL(url).searchParams.get('maxResults'),'10');assert.equal(new URL(url).searchParams.has('q'),false);return Response.json(messages.length?{messages:messages.map((_,i)=>({id:String(i)}))}:{});}
  assert.equal(url,'https://gmail.googleapis.com/batch/gmail/v1');
  const ids=[...options.body.matchAll(/GET \/gmail\/v1\/users\/me\/messages\/(\d+)\?format=full/g)].map(m=>Number(m[1]));assert.ok(ids.length<=20);
  // Reverse response parts to test matching Content-ID rather than relying on order.
  const parts=ids.map((id,i)=>`--response_test\r\nContent-Type: application/http\r\nContent-ID: <response-m${i}>\r\n\r\nHTTP/1.1 ${partStatus} OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(partStatus===200?messages[id]:{error:'quota'})}\r\n`).reverse();
  return new Response(parts.join('')+'--response_test--\r\n',{headers:{'Content-Type':'multipart/mixed; boundary="response_test"'}});
 };
 try{const r=await email({env,request:new Request('https://example.com/api/getLastEmail',{method:'POST',body:JSON.stringify({email:'test@example.com'})})});return {result:{status:r.status,data:await r.json()},calls};}finally{globalThis.fetch=realFetch;}
}
test('Decode Gmail Base64URL, unpadded data, UTF-8 and GitHub standard Base64',()=>{
 for(const s of ['Código 🟢 ¿Quién?','???','~~~','a','ab','abc','ñáéíóú']){assert.equal(decode64(Buffer.from(s).toString('base64url')),s);assert.equal(decode64(Buffer.from(s).toString('base64')),s);}
 assert.equal(decode64('Pz8_'),'???');assert.equal(decode64('fn5-'),'~~~');
 assert.equal(decode64('YQ'),'a');assert.equal(decode64('YWI'),'ab');
});
test('Same output as original Netlify function for every original subject and link',async()=>{
 const cases=codes.map(s=>[msg(s)]);
 for(const subject of subjects)for(const url of urls)cases.push([msg(subject,`Enlace ${url}]`,'text/plain')]);
 cases.push([], [msg('Otro asunto')], [msg(codes[0],undefined,undefined,11*60*1000)], [msg(codes[0],undefined,undefined,0,'other@example.com')], [msg(subjects[0],urls[0],'text/plain'),msg(codes[0])]);
 for(const messages of cases)assert.deepEqual((await migratedResult(messages)).result,await legacyResult(messages));
});
test('Find the tenth message; preserve batch response order',async()=>{
 for(const count of [10]){const messages=Array.from({length:count-1},()=>msg('Otro asunto'));messages.push(msg(codes[0]));const actual=await migratedResult(messages);assert.deepEqual(actual.result,await legacyResult(messages));assert.equal(actual.calls,2+Math.ceil(count/20));}
});
test('Surface Gmail batch inner errors',async()=>{const r=await migratedResult([msg(codes[0])],429);assert.equal(r.result.status,500);assert.match(r.result.data.error,/429/);});
