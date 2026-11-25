import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigins, parseOrigin, permittedOrigin } from '../src/lib/origin-policy.ts';
import { validMutationOrigin } from '../src/lib/request-origin.ts';
test('development allowlist contains only loopback and actual private interfaces', () => {
 const list=allowedOrigins({NODE_ENV:'development',PORT:'3000'},['192.168.7.9','10.0.0.8','172.20.0.5','203.0.113.4']);
 assert(list.has('http://localhost:3000'));assert(list.has('http://192.168.7.9:3000'));assert(!list.has('http://192.168.7.10:3000'));assert(!list.has('http://203.0.113.4:3000'));
 assert(permittedOrigin('http://192.168.7.9:3000','192.168.7.9:3000',list));assert(!permittedOrigin('http://evil.example','192.168.7.9:3000',list));assert(!permittedOrigin('http://localhost:3000','evil.example',list));
});
test('production requires configured origins; malformed origins and wildcards fail closed',()=>{
 const list=allowedOrigins({NODE_ENV:'production',APP_ORIGIN:'https://chat.example',APP_ALLOWED_ORIGINS:'https://second.example'},['192.168.7.9']);assert.equal(list.size,2);assert(!list.has('http://localhost:3000'));
 for(const value of ['null','https://chat.example/path','https://u:p@chat.example','https://chat.example?x=1','https://chat.example#x','file:///tmp','https://chat.example.evil'])assert(!permittedOrigin(value,'chat.example',list));
 assert.equal(parseOrigin('https://chat.example'), 'https://chat.example');assert.throws(()=>allowedOrigins({NODE_ENV:'production',APP_ALLOWED_ORIGINS:'*'}));
});
test('request policy ignores internal URL and forwarded host; missing Origin distinguishes native and browser requests',()=>{
 const previous={...process.env};try{
 Object.assign(process.env,{NODE_ENV:'development'});process.env.PORT='3000';process.env.APP_ALLOWED_ORIGINS='http://192.168.7.9:3000';delete process.env.APP_ORIGIN;
 const req=(headers:Record<string,string>)=>new Request('http://0.0.0.0:3000/api/conversations',{method:'POST',headers:{host:'192.168.7.9:3000','content-type':'application/json',...headers}});
 assert(validMutationOrigin(req({origin:'http://192.168.7.9:3000'})));assert(!validMutationOrigin(req({origin:'http://evil.example','x-forwarded-host':'192.168.7.9:3000'})));
 assert(!validMutationOrigin(req({origin:'http://192.168.7.9:3000',host:'evil.example'})));assert(!validMutationOrigin(req({origin:'null'})));
 assert(validMutationOrigin(req({})));assert(!validMutationOrigin(req({'sec-fetch-site':'cross-site'})));assert(!validMutationOrigin(req({'sec-fetch-site':'same-origin'})));
 assert(validMutationOrigin(req({'sec-fetch-site':'same-origin',referer:'http://192.168.7.9:3000/chat'})));assert(!validMutationOrigin(req({'content-type':'multipart/form-data; boundary=test'})));
 }finally{for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});
