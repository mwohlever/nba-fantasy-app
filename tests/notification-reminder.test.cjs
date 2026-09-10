/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
function load(file, globals = {}, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: n => mocks[n] ?? require(n), process: {env: {NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'YWJj'}}, Event, ...globals });
  return module.exports;
}
function browser(options = {}) {
  const values = new Map();
  const events = new Map();
  const calls = [];
  let subscription = options.subscription === false ? null : {endpoint: 'current', toJSON: () => ({endpoint:'current',keys:{auth:'auth',p256dh:'key'}})};
  const notification = {permission: options.permission ?? 'granted', requestPermission: async () => { calls.push('permission'); return notification.permission = options.permissionResult ?? 'granted'; }};
  const registration = { pushManager: {getSubscription: async () => subscription, subscribe: async () => {calls.push('subscribe'); return subscription = {endpoint:'current',toJSON:()=>({endpoint:'current',keys:{auth:'auth',p256dh:'key'}})};}}};
  const window = {Notification: notification, PushManager: {}, atob, matchMedia:()=>({matches:false}), localStorage: {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}, addEventListener:(k,fn)=>events.set(k,fn), removeEventListener:k=>events.delete(k), dispatchEvent:e=>events.get(e.type)?.()};
  const globals = {window, Notification:notification, navigator:{userAgent:'Android',serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration)}}, fetch:async (url,init)=>{
    calls.push([url,init]);
    return {ok:!options.fail && !options.loggedOut,status:options.loggedOut?401:options.fail?500:200,json:async()=> url.includes('preferences')?{preferences:{notificationsEnabled: options.masterEnabled ?? true}}:{success:true,subscriptions:options.devices??[{endpoint:'current',is_active:true}]}};
  }};
  return {globals,values,calls,events};
}
const helper = () => load('lib/notificationReminder.ts');
const ready = {supported:true,authenticated:true,loading:false,active:false,dismissed:false,masterEnabled:true};
for (const [name, change, expected] of [
  ['default permission, inactive device',{},true],['active current device',{active:true},false],
  ['logged out',{authenticated:false},false],['unsupported',{supported:false},false],
  ['loading prevents flash',{loading:true},false],['dismissed install',{dismissed:true},false],
  ['master off is respected',{masterEnabled:false},false],
]) test(name,()=>assert.equal(helper().shouldShowReminder({...ready,...change}),expected));
test('storage is SSR safe',()=>{assert.equal(helper().isReminderDismissed(),false);helper().dismissReminder();});
test('dismissal persists across app entries; cleared site data permits reminder',()=>{
  const b=browser(); const first=load('lib/notificationReminder.ts',b.globals);
  first.dismissReminder(); assert.equal(b.values.get(first.REMINDER_KEY),'1');
  assert.equal(load('lib/notificationReminder.ts',b.globals).isReminderDismissed(),true);
  b.values.clear(); assert.equal(load('lib/notificationReminder.ts',b.globals).isReminderDismissed(),false);
});
test('unavailable localStorage has session fallback',()=>{
 const b=browser();Object.defineProperty(b.globals.window,'localStorage',{get(){throw Error('blocked');}});
 const h=load('lib/notificationReminder.ts',b.globals);assert.equal(h.isReminderDismissed(),false);h.dismissReminder();assert.equal(h.isReminderDismissed(),true);
});
for(const [name,opts,expected] of [
 ['exact endpoint active',{},true],['other device only',{devices:[{endpoint:'other',is_active:true}]},false],
 ['inactive registration',{devices:[{endpoint:'current',is_active:false}]},false],
 ['no local subscription despite active registered devices',{subscription:false},false],
 ['multiple devices',{devices:[{endpoint:'other',is_active:true},{endpoint:'current',is_active:true}]},true],
 ['denied permission with stale subscription',{permission:'denied'},false],
]) test(name,async()=>{const b=browser(opts);const h=load('lib/pushDevice.ts',b.globals);assert.equal((await h.inspectPushDevice()).active,expected);});
test('unauthenticated API never provides device state',async()=>{const b=browser({loggedOut:true});assert.equal(await load('lib/pushDevice.ts',b.globals).inspectPushDevice(),null);});
test('failed state lookup stays unknown',async()=>{const b=browser({fail:true});await assert.rejects(load('lib/pushDevice.ts',b.globals).inspectPushDevice());});
test('enable requests permission, subscribes, saves using existing API and recognizes current endpoint',async()=>{
 const b=browser({permission:'default',subscription:false});const h=load('lib/pushDevice.ts',b.globals);
 assert.equal(await h.enableCurrentDevicePush(),'current');assert.ok(b.calls.includes('permission'));assert.ok(b.calls.includes('subscribe'));
 const post=b.calls.find(c=>Array.isArray(c)&&c[1]?.method==='POST');assert.equal(post[0],'/api/push-subscriptions');assert.equal(JSON.parse(post[1].body).endpoint,'current');
 assert.equal((await h.inspectPushDevice()).active,true);
});
test('existing subscription reused without creating another device',async()=>{const b=browser();await load('lib/pushDevice.ts',b.globals).enableCurrentDevicePush();assert.ok(!b.calls.includes('subscribe'));assert.ok(!b.calls.includes('permission'));});
test('denied never requests permission or posts',async()=>{const b=browser({permission:'denied'});await assert.rejects(load('lib/pushDevice.ts',b.globals).enableCurrentDevicePush(),/blocked/);assert.equal(b.calls.length,0);});
test('failed enable never announces success',async()=>{const b=browser({fail:true});let enabled=false;b.events.set('111-push-device-enabled',()=>enabled=true);await assert.rejects(load('lib/pushDevice.ts',b.globals).enableCurrentDevicePush());assert.equal(enabled,false);});

// Execute component hooks and actions without installing another test framework.
function component(options={}) {
 const b=browser(options);const h=load('lib/notificationReminder.ts',b.globals);
 let refs=[],refIndex=0,states=[],index=0,effects=[],deps=[],effectIndex=0,path='/home',cleanup=[];
 const react={useRef:initial=>{const i=refIndex++;return refs[i]??(refs[i]={current:initial});},useState:initial=>{const i=index++;if(!(i in states))states[i]=initial;return [states[i],v=>states[i]=v];},useEffect:(fn,next)=>{const i=effectIndex++;if(!deps[i]||next.some((v,j)=>v!==deps[i][j])){deps[i]=next;effects.push(()=>{cleanup[i]?.();cleanup[i]=fn();});}}};
 const mocks={'react':react,'next/navigation':{usePathname:()=>path},'next/link':{default:'a'},'@/lib/notificationReminder':h,'@/lib/pushDevice':load('lib/pushDevice.ts',b.globals),'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}};
 const C=load('components/NotificationReminder.tsx',b.globals,mocks).default;
 function render(){index=0;refIndex=0;effectIndex=0;const tree=C();effects.splice(0).forEach(f=>f());return tree;}
 const flush=async()=>{await new Promise(resolve => setImmediate(resolve));};
 function nodes(tree){return !tree||typeof tree!=='object'?[]:[tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];}
 return {b,h,render,flush,nodes,route:p=>{path=p;},action:(tree,label)=>nodes(tree).find(n=>n.props?.children===label).props.onClick()};
}
test('no initial flash; Not Now closes and survives route changes',async()=>{const c=component({subscription:false,permission:'default'});assert.equal(c.render(),null);await c.flush();let tree=c.render();assert.ok(tree);c.action(tree,'Not Now');assert.equal(c.render(),null);assert.equal(c.b.values.get(c.h.REMINDER_KEY),'1');c.route('/groups/another');c.render();await c.flush();assert.equal(c.render(),null);});
test('Turn On reuses helper and closes on success',async()=>{const c=component({subscription:false,permission:'default'});c.render();await c.flush();c.action(c.render(),'Turn On Notifications');await c.flush();assert.equal(c.render(),null);assert.equal(c.h.isReminderDismissed(),true);assert.ok(c.b.calls.includes('subscribe'));});
test('failed permission leaves retryable prompt and no completion',async()=>{const c=component({subscription:false,permission:'default',permissionResult:'default'});c.render();await c.flush();c.action(c.render(),'Turn On Notifications');await c.flush();assert.ok(c.render());assert.equal(c.h.isReminderDismissed(),false);});
test('denied action links directly to device notification settings and dismisses once',async()=>{const c=component({subscription:false,permission:'denied'});c.render();await c.flush();const tree=c.render();const link=c.nodes(tree).find(n=>n.props?.href);assert.equal(link.props.href,c.h.NOTIFICATION_DEVICE_URL);link.props.onClick();assert.equal(c.render(),null);assert.ok(!c.b.calls.includes('permission'));});
for(const [name,options] of [['logged out',{loggedOut:true}],['active',{ }],['master disabled',{subscription:false,masterEnabled:false}]])test(`component hidden: ${name}`,async()=>{const c=component(options);c.render();await c.flush();assert.equal(c.render(),null);});
test('root shell mounts once, settings uses shared helper, direct settings link is supported',()=>{
 const layout=fs.readFileSync('app/layout.tsx','utf8');assert.equal(layout.match(/<NotificationReminder \/>/g).length,1);
 assert.ok(layout.indexOf("<NotificationReminder />") < layout.indexOf("<GroupProvider>"));
 const controls=fs.readFileSync('components/profile/PushDeviceControls.tsx','utf8');assert.match(controls,/await enableCurrentDevicePush\(\)/);assert.match(controls,/async function disablePush/);assert.match(controls,/async function removeRegisteredDevice/);
 const profile=fs.readFileSync('app/profile/page.tsx','utf8');assert.match(profile,/searchParams.get\("section"\) === "notifications"/);assert.match(profile,/id="push-device"/);
 const prompt=fs.readFileSync('components/NotificationReminder.tsx','utf8');assert.doesNotMatch(prompt,/useGroupContext|router.replace|visibilitychange/);
});
test('route and Group navigation reuse the entry assessment without another prompt check',async()=>{
 const c=component({subscription:false,permission:'default'});c.render();await c.flush();assert.ok(c.render());const calls=c.b.calls.length;
 c.route('/groups/another');assert.ok(c.render());await c.flush();assert.equal(c.b.calls.length,calls);
});
test('login page hides prompt and login entry is checked',async()=>{
 const c=component({subscription:false});c.route('/login');assert.equal(c.render(),null);await c.flush();assert.equal(c.b.calls.length,0);
 c.route('/home');c.render();await c.flush();assert.ok(c.render());c.route('/login');assert.equal(c.render(),null);
});
test('successful enable in settings closes an already visible reminder',async()=>{
 const c=component({subscription:false});c.render();await c.flush();assert.ok(c.render());c.b.globals.window.dispatchEvent(new Event('111-push-device-enabled'));assert.equal(c.render(),null);assert.equal(c.h.isReminderDismissed(),true);
});
test('unsupported browser never fetches device state',async()=>{
 const c=component({subscription:false});delete c.b.globals.window.PushManager;c.render();await c.flush();assert.equal(c.render(),null);assert.equal(c.b.calls.length,0);
});
test('iOS browser tab is suppressed; installed app can be prompted',async()=>{
 const c=component({subscription:false});c.b.globals.navigator.userAgent='iPhone';c.render();await c.flush();assert.equal(c.render(),null);
 const installed=component({subscription:false});installed.b.globals.navigator.userAgent='iPhone';installed.b.globals.navigator.standalone=true;installed.render();await installed.flush();assert.ok(installed.render());
});
test('late device response after dismissal cannot reopen prompt',async()=>{
 const c=component({subscription:false});c.render();c.h.dismissReminder();await c.flush();assert.equal(c.render(),null);
});

function apiFixture() {
 const rows=[{id:'a',user_id:'user',endpoint:'current',is_active:true},{id:'b',user_id:'user',endpoint:'other',is_active:true},{id:'c',user_id:'different-user',endpoint:'foreign',is_active:true}];
 const db={from:()=>{let filtered=rows,patch;const q={select:()=>q,eq:(k,v)=>{filtered=filtered.filter(r=>r[k]===v);return q;},order:()=>q,update:p=>{patch=p;return q;},then:resolve=>{if(patch)filtered.forEach(r=>Object.assign(r,patch));return Promise.resolve({data:filtered,error:null}).then(resolve);}};return q;}};
 const api=load('app/api/push-subscriptions/route.ts',{}, {'@/lib/auth':{getCurrentUser:async()=>({id:'user'})},'@/lib/supabaseAdmin':{supabaseAdmin:db},'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status??200})}}});return {api,rows};
}
test('canonical GET returns only authenticated user active devices',async()=>{const {api}=apiFixture();const response=await api.GET();assert.equal(response.body.subscriptions.length,2);assert.ok(response.body.subscriptions.every(r=>r.user_id==='user'));});
test('existing disable affects only requested endpoint and keeps other devices active',async()=>{
 const {api,rows}=apiFixture();assert.equal((await api.DELETE({json:async()=>({endpoint:'current'})})).status,200);
 assert.equal(rows[0].is_active,false);assert.equal(rows[1].is_active,true);assert.equal(rows[2].is_active,true);
 assert.equal((await api.GET()).body.subscriptions.length,1);
});
test('disable cannot modify a different user endpoint',async()=>{const {api,rows}=apiFixture();await api.DELETE({json:async()=>({endpoint:'foreign'})});assert.equal(rows[2].is_active,true);});
