import 'dotenv/config';
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { io } from 'socket.io-client';
import { db } from '../src/prisma/db.ts';
const ip=Object.values(networkInterfaces()).flatMap(v=>v||[]).find(v=>v.family==='IPv4'&&!v.internal&&v.address.startsWith('192.168.'))?.address;
assert(ip,'LAN interface unavailable');const bases=['http://localhost:3102','http://127.0.0.1:3102',`http://${ip}:3102`],users=[],ids=new Set(),sockets=[];
const post=(base,path,origin,body,user,extra={})=>fetch(base+path,{method:'POST',headers:{...(origin===undefined?{}:{origin}),'content-type':'application/json',...(user?{cookie:user.cookie}:{}),...extra},body:JSON.stringify(body)});
try{
 for(let i=0;i<2;i++){const username='origin_'+randomUUID().slice(0,8),password=randomUUID();const user=await db.orm.public.User.create({username,passwordHash:await bcrypt.hash(password,12)});users.push(user);const r=await post(bases[0],'/api/login',bases[0],{username,password});assert.equal(r.status,200);user.cookie=r.headers.get('set-cookie').split(';')[0];}
 for(const base of bases){const r=await post(base,'/api/conversations',base,{userId:users[1].id},users[0]);assert.equal(r.status,200,await r.clone().text());ids.add((await r.json()).conversationId);const self=await post(base,'/api/conversations',base,{userId:users[0].id},users[0]);assert.equal(self.status,400);assert.match((await self.json()).error,/с собой/);
  const socket=io(base,{transports:['websocket'],extraHeaders:{origin:base,cookie:users[0].cookie},reconnection:false});sockets.push(socket);await new Promise((r,j)=>{socket.once('connect',r);socket.once('connect_error',j);});
 }
 assert.equal(ids.size,1);
 for(const origin of ['http://evil.example','null','http://localhost:3102.evil.example','http://localhost:3102/path'])assert.equal((await post(bases[0],'/api/conversations',origin,{userId:users[1].id},users[0],{'x-forwarded-host':'localhost:3102'})).status,403);
 assert.equal((await post(bases[0],'/api/conversations',undefined,{userId:users[1].id},users[0],{'sec-fetch-site':'cross-site'})).status,403);
 assert.equal((await post(bases[0],'/api/conversations',undefined,{userId:users[1].id},users[0])).status,200);
 assert.equal((await post(bases[0],'/api/conversations',bases[0],{userId:users[1].id})).status,401);
 for(const path of ['/api/upload','/api/audio/upload','/api/videos/upload?name=empty.mp4','/api/documents/upload?name=empty.txt','/api/profile/avatar','/api/groups']){
  assert.equal((await post(bases[2],path,'http://evil.example',{},users[0])).status,403,path);
  const valid=await post(bases[2],path,bases[2],{},users[0]);assert.notEqual(valid.status,403,path);assert.notEqual(valid.status,500,path);
 }
 for(const path of ['/api/login','/api/register','/api/logout'])assert.equal((await post(bases[2],path,'https://evil.example',{},users[0])).status,403,path);
 const denied=io(bases[2],{transports:['websocket'],extraHeaders:{origin:'https://evil.example',cookie:users[0].cookie},reconnection:false,timeout:5000});sockets.push(denied);
 await new Promise((resolve,reject)=>{denied.once('connect',()=>reject(new Error('Untrusted Socket.IO Origin accepted')));denied.once('connect_error',resolve);});
 console.log('PASS localhost/127.0.0.1/actual LAN: conversation create/dedup/self rejection, Socket.IO; hostile/null/malformed/missing browser Origin denied; native/auth handling and all upload/avatar/group Origin guards');
}finally{sockets.forEach(s=>s.disconnect());for(const id of ids)if(Number.isSafeInteger(id)&&id>0)await db.orm.public.Conversation.where({id}).delete();for(const u of users)await db.orm.public.User.where({id:u.id}).delete();await db.close();}
