import { createECDH, createHmac, createPrivateKey, randomBytes, sign, createCipheriv, createHash } from 'node:crypto';
import { Hono } from 'hono';
import type { Env } from '../../auth';
import { db } from '../../db';
import { now, todayIST } from '../../util';

const unbase = (s:string) => Buffer.from(s,'base64url');
const b64 = (x:Buffer|string) => Buffer.from(x).toString('base64url');
function hkdf(salt:Buffer, ikm:Buffer, info:Buffer, len:number) { const prk=createHmac('sha256',salt).update(ikm).digest(); return createHmac('sha256',prk).update(info).update(Buffer.from([1])).digest().subarray(0,len); }
function vapid(origin:string) {
  const d=process.env.VAPID_PRIVATE_KEY, pub=process.env.VAPID_PUBLIC_KEY; if(!d||!pub) throw new Error('VAPID keys missing');
  const raw=unbase(pub); if(raw.length!==65||unbase(d).length!==32) throw new Error('invalid VAPID keys');
  const key=createPrivateKey({key:{kty:'EC',crv:'P-256',x:b64(raw.subarray(1,33)),y:b64(raw.subarray(33)),d},format:'jwk'});
  const header=b64(JSON.stringify({typ:'JWT',alg:'ES256'})), body=b64(JSON.stringify({aud:origin,exp:Math.floor(Date.now()/1000)+3600,sub:process.env.VAPID_SUBJECT||'mailto:admin@example.com'}));
  const token=header+'.'+body; return {token:token+'.'+b64(sign('sha256',Buffer.from(token),{key,dsaEncoding:'ieee-p1363'})),publicKey:pub};
}
export async function sendPush(s:{endpoint:string;p256dh:string;auth:string}, payload:object) {
  const endpoint=new URL(s.endpoint); if(endpoint.protocol!=='https:') throw new Error('push endpoint must use HTTPS');
  const server=createECDH('prime256v1'); server.generateKeys(); const client=unbase(s.p256dh), serverPub=server.getPublicKey(); const auth=unbase(s.auth);
  if(client.length!==65||auth.length<16) throw new Error('invalid subscription keys');
  const secret=server.computeSecret(client); const ikm=hkdf(auth,secret,Buffer.concat([Buffer.from('WebPush: info\0'),client,serverPub]),32);
  const salt=randomBytes(16), cek=hkdf(salt,ikm,Buffer.from('Content-Encoding: aes128gcm\0'),16), nonce=hkdf(salt,ikm,Buffer.from('Content-Encoding: nonce\0'),12);
  const cipher=createCipheriv('aes-128-gcm',cek,nonce); const plain=Buffer.concat([Buffer.from(JSON.stringify(payload)),Buffer.from([2])]); const encrypted=Buffer.concat([cipher.update(plain),cipher.final(),cipher.getAuthTag()]);
  const rs=Buffer.alloc(4); rs.writeUInt32BE(4096); const body=Buffer.concat([salt,rs,Buffer.from([serverPub.length]),serverPub,encrypted]); const jwt=vapid(endpoint.origin);
  return fetch(s.endpoint,{method:'POST',headers:{'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream','TTL':'3600','Authorization':`vapid t=${jwt.token}, k=${jwt.publicKey}`},body:new Uint8Array(body),redirect:'manual'});
}
const setting=(key:string,def:string) => (db.query('SELECT value FROM settings WHERE key=?').get(key) as any)?.value||def;
const mins=(s:string) => { const m=/^(\d\d):(\d\d)$/.exec(s); return m?Number(m[1])*60+Number(m[2]):null; };
function muted(localMinutes:number, clock:Date) { const a=mins(setting('reminder_quiet_start','22:00')), b=mins(setting('reminder_quiet_end','07:00')); if(a!==null&&b!==null&&(a<=b?localMinutes>=a&&localMinutes<b:localMinutes>=a||localMinutes<b)) return true;
  if(setting('reminder_gym_mute','1')==='1') {
    const custom=(db.query("SELECT value FROM settings WHERE key='routine_blocks'").get() as any)?.value;
    let windows:{start:string;end:string}[]=[];
    if(custom) try {const blocks=JSON.parse(custom);const day=new Date(clock.getTime()+330*60_000).getUTCDay();windows=blocks.filter((x:any)=>/gym/i.test(x.label)&&x.days?.includes(day));} catch { /* malformed profile */ }
    else windows=[{start:setting('gym_start','17:00'),end:setting('gym_end','19:00')}];
    if(windows.some(x=>{const gs=mins(x.start),ge=mins(x.end);return gs!==null&&ge!==null&&localMinutes>=gs&&localMinutes<ge})) return true;
  } return false; }
/** Called each minute by the server. Delivery keys make retries and restarts idempotent. */
export async function runReminderScheduler(clock=new Date()) {
  if(!process.env.VAPID_PRIVATE_KEY||!process.env.VAPID_PUBLIC_KEY) return;
  const ist=new Date(clock.getTime()+330*60_000), day=ist.toISOString().slice(0,10), minute=ist.getUTCHours()*60+ist.getUTCMinutes(); if(muted(minute,clock)) return;
  const jobs:{key:string;title:string;body:string;url:string}[]=[];
  const due=(at:number|null)=>at!==null&&minute>=at&&minute<at+5;
  if(due(mins(setting('reminder_morning','07:30')))) jobs.push({key:'morning',title:'Your study plan',body:'Open Today to pick your next step.',url:'/#/today'});
  if(due(mins(setting('reminder_checkin','21:30')))) jobs.push({key:'checkin',title:'Evening check-in',body:'Log your study and energy for today.',url:'/#/log'});
  if(due(mins(setting('reminder_mistakes','19:00'))) && db.query('SELECT 1 FROM mistakes WHERE status=\'open\' AND due_on<=? LIMIT 1').get(day)) jobs.push({key:'mistakes',title:'Mistakes due',body:'A short review is ready.',url:'/#/mistakes'});
  const blocks=db.query(`SELECT DISTINCT time_block,title,id FROM plan_tasks WHERE date=? AND status IN ('todo','doing') AND time_block IS NOT NULL AND deleted_at IS NULL`).all(day) as any[];
  for(const b of blocks) { const start=mins(String(b.time_block).slice(0,5)); if(start!==null && due(start-5)) jobs.push({key:'block-'+b.id,title:'Next study block',body:b.title,url:'/#/today'}); }
  const subs=db.query('SELECT * FROM push_subscriptions').all() as any[];
  for(const job of jobs) for(const sub of subs) {
    const key=day+'/'+job.key+'/'+createHash('sha256').update(sub.endpoint).digest('hex').slice(0,16);
    if(db.query('SELECT 1 FROM reminder_deliveries WHERE key=?').get(key)) continue;
    try { const r=await sendPush(sub,{title:job.title,body:job.body,url:job.url});
      if(r.status===404||r.status===410) db.run('DELETE FROM push_subscriptions WHERE endpoint=?',[sub.endpoint]);
      else if(r.ok) { db.run('INSERT OR IGNORE INTO reminder_deliveries(key,sent_at) VALUES (?,?)',[key,now()]); db.run('UPDATE push_subscriptions SET last_sent_at=? WHERE endpoint=?',[now(),sub.endpoint]); }
      else console.warn('push failed',r.status);
    } catch(e) { console.warn('push failed',e); }
  }
}
export function pushRoutes() { const r=new Hono<Env>();
  r.get('/push/vapid',c => { const pub=process.env.VAPID_PUBLIC_KEY,priv=process.env.VAPID_PRIVATE_KEY; return c.json({public_key:pub||null,enabled:!!pub&&!!priv&&unbase(pub).length===65&&unbase(priv).length===32}); });
  r.post('/push/subscriptions',async c => { const b=await c.req.json().catch(()=>null); const endpoint=b?.endpoint,p=b?.keys?.p256dh,a=b?.keys?.auth;
    try {if(typeof endpoint!=='string'||new URL(endpoint).protocol!=='https:'||typeof p!=='string'||typeof a!=='string'||unbase(p).length!==65||unbase(a).length<16) throw 0;}catch{return c.json({error:{code:'validation',message:'valid push subscription required',details:{}}},422);}
    db.run('INSERT INTO push_subscriptions(endpoint,p256dh,auth,created_at) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth',[endpoint,p,a,now()]); return c.json({ok:true},201); });
  r.delete('/push/subscriptions',async c => {const b=await c.req.json().catch(()=>null); if(typeof b?.endpoint!=='string') return c.json({error:{code:'validation',message:'endpoint required',details:{}}},422); db.run('DELETE FROM push_subscriptions WHERE endpoint=?',[b.endpoint]); return c.body(null,204);});
  return r; }
