import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { db } from '../src/prisma/db.ts';
const base = process.env.VERIFY_URL; if (!base?.startsWith('https://')) throw new Error('VERIFY_URL must be HTTPS');
const users=[], uploads=[], ids=new Set(), pending=[]; let browser;
const pages=[];
const root=await mkdtemp(join(tmpdir(),'mediachat-https-ui-'));
const post=(path,body,user)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin:base,...(user?{cookie:user.cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
try {
 for(let i=0;i<2;i++){
  const username=`https_${randomUUID().slice(0,8)}_${i}`,password=randomUUID();
  const reg=await post('/api/register',{username,password});assert.equal(reg.status,201,await reg.clone().text());const {user}=await reg.json();users.push(user);
  const login=await post('/api/login',{username,password});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/; Secure/i);assert.match(login.headers.get('set-cookie'),/; HttpOnly/i);user.cookie=login.headers.get('set-cookie').split(';')[0];
 }
 const created=await post('/api/conversations',{userId:users[1].id},users[0]);assert.equal(created.status,200);const {conversationId}=await created.json();ids.add(conversationId);
 const {chromium}=await import('/private/tmp/mediachat-direct-browser/node_modules/playwright-core/index.mjs');
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const errors=[];
 for(const user of users){
  const context=await browser.newContext({viewport:{width:1100,height:850}});context.setDefaultTimeout(90000);context.setDefaultNavigationTimeout(120000);
  await context.addCookies([{name:'mediachat_session',value:user.cookie.split('=')[1],url:base,httpOnly:true,secure:true,sameSite:'Lax'}]);
  const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.request().method()==='POST')console.log('HTTP',new URL(r.url()).pathname,r.status());});
  page.on('requestfailed',r=>console.log('NETWORK',new URL(r.url()).pathname,r.failure()?.errorText));
  page.on('response',r=>{if(r.request().method()==='POST'&&r.status()===201&&/\/api\/(upload|audio\/upload|videos\/upload|documents\/upload)/.test(r.url()))pending.push(r.json().then(d=>{const url=d.imageUrl||d.audioUrl||d.videoUrl||d.documentUrl;if(url)uploads.push(url);}));});
  await page.goto(`${base}/?chat=${conversationId}`,{waitUntil:'domcontentloaded'});await page.getByText('Соединение установлено',{exact:true}).waitFor();
 }
 const [a,b]=pages;const text=`HTTPS UI ${randomUUID().slice(0,8)}`;
 await a.getByPlaceholder('Написать сообщение...').fill(text);await a.getByRole('button',{name:'Отправить сообщение',exact:true}).click();await b.getByLabel('Сообщения чата').getByText(text,{exact:true}).waitFor();
 await b.getByPlaceholder('Написать сообщение...').fill('Ответ HTTPS');await b.getByRole('button',{name:'Отправить сообщение',exact:true}).click();await a.getByLabel('Сообщения чата').getByText('Ответ HTTPS',{exact:true}).waitFor();
 console.log('PASS Chrome HTTPS session and two-way realtime private text');
 const png=await sharp({create:{width:180,height:100,channels:3,background:'purple'}}).png().toBuffer();
 const wav=join(root,'test.wav'),mp4=join(root,'test.mp4');
 execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440','-t','2',wav]);
 execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=240x160:rate=10','-t','2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',mp4]);
 for(const [label,name,mimeType,buffer] of [['Изображение','https.png','image/png',png],['Музыка','https.wav','audio/wav',await readFile(wav)],['Видео','https.mp4','video/mp4',await readFile(mp4)],['Документ или архив','https.txt','text/plain',Buffer.from('HTTPS document')]]){
  await a.getByRole('button',{name:'Прикрепить вложение',exact:true}).click();const chooser=a.waitForEvent('filechooser');await a.getByRole('menuitem',{name:label,exact:true}).click();await(await chooser).setFiles({name,mimeType,buffer});
 }
 await a.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await b.getByRole('link',{name:'Скачать https.txt',exact:true}).waitFor({timeout:300000});
 await b.getByRole('button',{name:'Открыть изображение',exact:true}).click();await b.getByRole('dialog',{name:'Просмотр изображения'}).waitFor();await b.keyboard.press('Escape');await b.getByRole('dialog',{name:'Просмотр изображения'}).waitFor({state:'detached'});
 await b.getByRole('button',{name:'Воспроизвести https.wav',exact:true}).click();await b.getByRole('button',{name:'Пауза',exact:true}).waitFor();
 await b.getByRole('button',{name:'Открыть видео https.mp4',exact:true}).click();const viewer=b.getByRole('dialog',{name:'Просмотр видео: https.mp4',exact:true});await viewer.waitFor();await viewer.getByRole('button',{name:'Пауза видео',exact:true}).waitFor();await viewer.getByRole('button',{name:'Остановить и закрыть видео',exact:true}).click();
 const download=b.waitForEvent('download');await b.getByRole('link',{name:'Скачать https.txt',exact:true}).click();assert.equal((await download).suggestedFilename(),'https.txt');
 await b.reload({waitUntil:'domcontentloaded'});await b.getByRole('link',{name:'Скачать https.txt',exact:true}).waitFor();assert.deepEqual(errors,[]);
 console.log('PASS Chrome HTTPS file picker/upload for image/audio/video/document, image viewer, audio/video playback, original download and reload; zero JS exceptions');
} catch(error) {
 for(const page of pages) { try {console.error('UI state:',(await page.locator('footer').innerText()).slice(-1800));}catch{ /* page may already be closed */ } }
 throw error;
} finally {
 await Promise.allSettled(pending);await browser?.close();
 for(const id of ids)await db.orm.public.Conversation.where({id}).delete();for(const user of users)await db.orm.public.User.where({id:user.id}).delete();
 for(const url of uploads){const name=url.split('/').pop(),id=name.split('.')[0];const folder=url.includes('/audio/')?'audio':url.includes('/videos/')?'videos':url.includes('/documents/')?'documents':'';await db.orm.public.MediaCleanupJob.where({url}).delete();for(const path of [join('uploads',folder,name),join('uploads',folder,'metadata',id+'.json'),join('uploads','previews',id+'.webp'),join('uploads','videos','posters',id+'.jpg')])await rm(path,{force:true});}
 await rm(root,{recursive:true,force:true});await db.close();
}
