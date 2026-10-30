/* eslint-disable @typescript-eslint/no-require-imports */
/* Actual Next pages in Chromium. Every API request is intercepted; no database/provider writes. */
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const modulePath=process.env.PLAYER_CENTER_BROWSER_MODULE,base=process.env.PLAYER_CENTER_PREVIEW_URL;
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...args);};
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
const capture=require('../data/player-center-preview/captured.json'),{presentProfile}=require('../lib/player-center/presentation.ts'),{compareHistories}=require('../lib/player-center/comparison.ts');
const context={group:{id:'fixture-group',name:'Fixture Group',slug:'fixture',isActive:true},membership:{id:'fixture-member',role:'admin',isActive:true},team:{id:1,name:'Fixture Team',displayOrder:1},leagues:['nba','nfl'].map(sport=>({id:sport+'-fixture',sportKey:sport,name:sport.toUpperCase(),gameMode:'standard',isEnabled:true,settings:{},settingsVersion:1})),isGroupAdmin:true,isSuperAdmin:false,canAdministerGroup:true};
const scoring=sport=>({sport,settings:null,basis:'legacy_defaults'});
async function setup(browser,width,sport='nba',variant=null,scoreContext=null){
 const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<600}),errors=[],writes=[],queries=[],allRequests=[];page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(sport=>{localStorage.setItem('111-fantasy-sport',sport);localStorage.setItem('111-fantasy-theme','dark');},sport);
 await page.route('https://**',route=>route.abort());
 await page.route('**/api/**',route=>{
  const request=route.request(),url=new URL(request.url()),params=url.searchParams;allRequests.push(url.pathname);
  if(request.method()!=='GET'){writes.push(url.pathname);return route.fulfill({json:{success:true,skipped:true}});}
  let body={success:true,notifications:[],unreadCount:0};
  if(url.pathname==='/api/groups/context')body={context,groups:[]};
  else if(url.pathname==='/api/me')body={user:{id:'fixture-user',role:'admin',teamId:1,activeGroupTeamId:1},groupContext:context};
  else if(url.pathname.startsWith('/api/player-center')){
   queries.push(url);const sport=params.get('sport'),season=Number(params.get('season'));
   if(url.pathname.endsWith('/comparisons'))body=compareHistories({sport,season,window:params.get('window')??'last5',metric:params.get('metric')??'fantasy_points',position:params.get('position')??undefined,ascending:params.get('direction')==='asc',scoring:scoring(sport)},capture.histories.filter(h=>h.player.sport===sport&&h.season===season),capture.capturedAt,capture.capturedAt);
   else {const id=Number(params.get('playerId'));let h=structuredClone(capture.histories.find(h=>h.player.sport===sport&&h.season===season&&h.player.playerId===id));
    if(!h)return route.fulfill({status:404,json:{error:'Exact player/season not in fixture capture.'}});
    if(variant)h=variant(h);body=presentProfile(h,scoreContext??scoring(sport),capture.capturedAt);
   }
   body={...body,groupId:context.group.id,leagueId:sport+'-fixture'};
  }else if(url.pathname==='/api/player-history')body={players:[],history:[],rows:[]};
  return route.fulfill({json:body});
 });
 return {page,errors,writes,queries,allRequests};
}
async function waitProfile(page){await page.locator('.pc-profile .pc-table tbody tr').first().waitFor();}
async function fits(page,label){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' fits viewport');}
async function seasonDefault(profile){assert.equal(await profile.getByRole('button',{name:'Season',exact:true}).getAttribute('aria-pressed'),'true');assert.match(await profile.locator('.pc-summary').innerText(),/Season FP/);}
async function compactLog(profile,sport){
 const row=profile.locator('.pc-game-log tbody tr').first(),cell=row.locator('th').first();
 assert.equal(await cell.locator('small').count(),0);assert.equal(await cell.evaluate(el=>getComputedStyle(el).position),'sticky');
 const identity=await cell.innerText();assert.ok(!identity.includes('\n'));assert.match(identity,sport==='nfl'?/^W\d+ · [A-Z][a-z]{2} \d+ (?:@|vs|·) /:/^[A-Z][a-z]{2} \d+ (?:@|vs|·) /);
 assert.ok(await cell.locator('.pc-game-identifier').evaluate(el=>el.getBoundingClientRect().width<=el.parentElement.clientWidth),'complete identifier fits sticky column');
 assert.ok((await row.boundingBox()).height<=40,'game rows remain compact, including incomplete scores');
 const scroll=profile.getByRole('region',{name:'Player game log; scroll horizontally for all statistics',exact:true});
 await scroll.evaluate(el=>{el.scrollLeft=120;});const bounds=await scroll.boundingBox(),sticky=await cell.boundingBox();assert.ok(Math.abs(bounds.x-sticky.x)<=2,'game identifier stays visible while scrolling');await scroll.evaluate(el=>{el.scrollLeft=0;});
}

async function checkTrend(page,profile,sport,season,id){
 const {fantasyTrend,fantasyTrendGames,defaultTrendPeriod}=require('../lib/player-center/fantasyTrend.ts');
 const p=presentProfile(capture.histories.find(h=>h.player.sport===sport&&h.season===season&&h.player.playerId===id),scoring(sport),capture.capturedAt),period=defaultTrendPeriod(fantasyTrendGames(p)),trend=fantasyTrend(p,period),chart=profile.locator('.pc-trend');
 await chart.waitFor();assert.equal(await chart.getByRole('button',{name:period==='last10'?'Last 10':'Season',exact:true}).getAttribute('aria-pressed'),'true');
 assert.deepEqual(await chart.locator('.pc-trend-point').evaluateAll(els=>els.map(el=>el.dataset.eventId)),trend.points.map(p=>p.game.eventId));
 assert.equal(await chart.locator('.pc-formulas,.pc-contributions').count(),0);
 assert.equal(await chart.locator('.pc-trend-plot').evaluate(el=>Math.round(el.getBoundingClientRect().height)),200,'chart CSS loaded');
 assert.equal(await chart.locator('.pc-trend-metrics dd').first().innerText(),new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(trend.average));
 assert.equal(await chart.locator('.pc-trend-average').evaluate(el=>getComputedStyle(el).strokeDasharray),'5px, 5px');
 const points=chart.locator('.pc-trend-point'),detail=chart.locator('.pc-trend-detail');
 await points.last().focus();await page.keyboard.press('Home');assert.ok(await points.first().evaluate(el=>el===document.activeElement));assert.match(await detail.innerText(),new RegExp(String(trend.points[0].points).replace('.', '\\.')));
 await page.keyboard.press('ArrowRight');assert.equal(await points.nth(Math.min(1,trend.points.length-1)).getAttribute('aria-pressed'),'true');
 await page.keyboard.press('End');assert.ok(await points.last().evaluate(el=>el===document.activeElement));
 if(page.viewportSize().width<600)await points.first().tap();else await points.first().hover();
 assert.equal(await points.first().getAttribute('aria-pressed'),'true');await points.last().click();assert.equal(await points.last().getAttribute('aria-pressed'),'true');
 await chart.getByRole('button',{name:'Last 5',exact:true}).click();assert.equal(await points.count(),Math.min(5,fantasyTrendGames(p).length));
 await chart.getByRole('button',{name:period==='last10'?'Last 10':'Season',exact:true}).click();await fits(page,`${sport} trend ${page.viewportSize().width}`);
}


test('NBA/NFL fixture preview: tabs, season boundaries, position filters, coverage-gated sorts, modal focus and responsive tables', {skip:(!modulePath||!base)&&'Set PLAYER_CENTER_BROWSER_MODULE and PLAYER_CENTER_PREVIEW_URL',timeout:240000},async()=>{
 const {chromium}=require(modulePath),browser=await chromium.launch();
 try{for(const width of [360,390,1280]){
  const {page,errors,writes,allRequests}=await setup(browser,width);
  await page.goto(base+'/player-center-preview',{waitUntil:'domcontentloaded',timeout:90000});await waitProfile(page);await page.locator('.pc-browser tbody tr').first().waitFor();
  const profile=page.locator('.pc-preview-layout .pc-profile'),pool=page.locator('.pc-browser');
  assert.equal(await profile.getByRole('tab',{name:'Game log',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await profile.locator('tbody tr').count(),2);assert.match(await profile.locator('.pc-summary').innerText(),/39\.5/);await seasonDefault(profile);await compactLog(profile,'nba');assert.match(await profile.locator('.pc-metrics').innerText(),/15\.5/);
  await fits(page,`${width}px NBA`);assert.equal(await profile.locator('.pc-sticky').first().evaluate(el=>getComputedStyle(el).position),'sticky');
  if(width<600)assert.ok(await profile.locator('.pc-table-scroll').evaluate(el=>el.scrollWidth>el.clientWidth));
  assert.match(await pool.locator('.pc-sort-state').innerText(),/Alphabetical/);
  assert.equal(await pool.locator('.pc-coverage').getAttribute('open'),null);await pool.locator('.pc-coverage > summary').focus();await page.keyboard.press('Enter');assert.match(await pool.locator('.pc-coverage-content').innerText(),/not authoritative rankings/);await page.keyboard.press('Enter');

  await pool.getByRole('button',{name:'Season',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.pc-sort-state').textContent.includes('high to low'));
  await pool.getByLabel('Stat sort',{exact:true}).selectOption('points');await page.waitForFunction(()=>document.querySelector('.pc-sort-state').textContent.includes('PTS'));
  await pool.getByRole('button',{name:'Change stat sort direction'}).click();await page.waitForFunction(()=>document.querySelector('.pc-sort-state').textContent.includes('low to high'));
  const expected=compareHistories({sport:'nba',season:2027,window:'season',metric:'points',ascending:true,scoring:scoring('nba')},capture.histories.filter(h=>h.player.sport==='nba'&&h.season===2027),capture.capturedAt,capture.capturedAt);
  assert.deepEqual(await pool.locator('tbody .pc-player-button > span').allTextContents(),expected.players.map(row=>row.player.name+'Player profile'));
  await pool.getByLabel('Position filter').selectOption('G');await pool.locator('.pc-player-button').filter({hasText:/Stephen Curry/}).waitFor();assert.equal(await pool.locator('tbody tr').count(),1);
  await pool.getByLabel('Position filter').selectOption('All');await pool.getByRole('searchbox').fill('LeBron');assert.equal(await pool.locator('tbody tr').count(),1);await pool.getByRole('searchbox').fill('');
  await profile.getByRole('button',{name:'Last 3',exact:true}).click();await pool.locator('.pc-player-button').filter({hasText:/Stephen Curry/}).click();await page.waitForFunction(()=>document.querySelector('.pc-profile h2').textContent==='Stephen Curry');await waitProfile(page);await seasonDefault(profile);assert.match(await profile.locator('.pc-metrics').innerText(),/23/);
  await profile.getByRole('button',{name:'Last game',exact:true}).click();await pool.locator('.pc-player-button').filter({hasText:/LeBron James/}).click();await page.waitForFunction(()=>document.querySelector('.pc-profile h2').textContent==='LeBron James');await waitProfile(page);await seasonDefault(profile);

  await profile.getByRole('button',{name:'Season',exact:true}).click();assert.match(await profile.locator('.pc-metrics').innerText(),/15\.5/);
  await profile.getByRole('tab',{name:'Season stats',exact:true}).click();await profile.locator('.pc-season-table').first().waitFor();assert.match(await profile.innerText(),/2026–27 season statistics/);
  const averages=profile.getByRole('region',{name:'Season averages',exact:true});assert.match(await averages.innerText(),/15\.5/);assert.match(await averages.innerText(),/min\/G/);assert.equal(await averages.locator('.pc-sticky').first().evaluate(el=>getComputedStyle(el).position),'sticky');
  assert.equal(await profile.locator('.pc-season-grid').count(),0);assert.equal(await profile.locator('.pc-season-details').getAttribute('open'),null);
  await profile.locator('.pc-season-details > summary').click();await profile.getByRole('region',{name:'Shooting totals',exact:true}).waitFor();assert.match(await profile.getByRole('region',{name:'Shooting per game',exact:true}).innerText(),/made–att\/G/);await fits(page,`${width}px NBA season tables`);
  if(process.env.PLAYER_CENTER_SCREENSHOT_DIR){fs.mkdirSync(process.env.PLAYER_CENTER_SCREENSHOT_DIR,{recursive:true});await profile.screenshot({path:path.join(process.env.PLAYER_CENTER_SCREENSHOT_DIR,`nba-season-${width}.png`)});}
  await profile.getByRole('tab',{name:'Fantasy',exact:true}).click();await checkTrend(page,profile,'nba',2027,6);assert.match(await profile.innerText(),/Legacy default scoring/);await fits(page,`${width}px NBA fantasy`);
  if(process.env.PLAYER_CENTER_SCREENSHOT_DIR)await profile.screenshot({path:path.join(process.env.PLAYER_CENTER_SCREENSHOT_DIR,`nba-fantasy-${width}.png`)});
  await profile.getByRole('tab',{name:'Game log',exact:true}).click();await profile.getByRole('button',{name:'Last 5',exact:true}).click();await profile.getByLabel('Profile season').selectOption('2026');await page.waitForFunction(()=>document.querySelector('.pc-profile .pc-summary').textContent.includes('60'));
  await profile.getByRole('tab',{name:'Game log',exact:true}).click();assert.equal(await profile.locator('tbody tr').count(),60);await seasonDefault(profile);
  await profile.getByRole('tab',{name:'Fantasy',exact:true}).click();await checkTrend(page,profile,'nba',2026,6);assert.equal(await profile.locator('.pc-trend-point').count(),10);
  await profile.locator('.pc-trend').getByRole('button',{name:'Season',exact:true}).click();assert.equal(await profile.locator('.pc-trend-point').count(),60);
  await profile.getByLabel('Profile season').selectOption('2027');await profile.locator('.pc-trend-point').nth(1).waitFor();await checkTrend(page,profile,'nba',2027,6);
  await profile.getByRole('tab',{name:'Game log',exact:true}).click();await waitProfile(page);
  const opener=page.getByRole('button',{name:'Open player modal',exact:true});await opener.click();const dialog=page.getByRole('dialog',{name:'LeBron James player profile'});await dialog.waitFor();await dialog.locator('tbody tr').first().waitFor();
  await seasonDefault(dialog);await compactLog(dialog,'nba');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Close player profile');
  await page.keyboard.press('Shift+Tab');assert.ok(await page.evaluate(()=>document.querySelector('[role="dialog"]').contains(document.activeElement)));
  assert.equal(await page.locator('[role="tabpanel"]').evaluateAll(els=>new Set(els.map(el=>el.id)).size),2);
  await fits(page,`${width}px modal`);if(process.env.PLAYER_CENTER_SCREENSHOT_DIR){fs.mkdirSync(process.env.PLAYER_CENTER_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.PLAYER_CENTER_SCREENSHOT_DIR,`nba-modal-${width}.png`)});}await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.ok(await opener.evaluate(el=>el===document.activeElement));
  await page.getByRole('button',{name:'NFL',exact:true}).click();await waitProfile(page);await pool.getByLabel('Position filter').selectOption('QB');await pool.locator('.pc-player-button').filter({hasText:/Patrick Mahomes/}).click();await page.waitForFunction(()=>document.querySelector('.pc-profile h2').textContent==='Patrick Mahomes');await waitProfile(page);
  assert.ok((await profile.locator('thead').innerText()).includes('Pass YDS'));assert.equal(await profile.locator('tbody tr').count(),5);await seasonDefault(profile);await compactLog(profile,'nfl');assert.match(await profile.locator('.pc-summary').innerText(),/18\.8/);await fits(page,`${width}px NFL QB`);if(process.env.PLAYER_CENTER_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.PLAYER_CENTER_SCREENSHOT_DIR,`nfl-qb-${width}.png`),fullPage:true});
  await profile.getByRole('tab',{name:'Season stats',exact:true}).click();await profile.locator('.pc-season-table').first().waitFor();assert.match(await profile.getByRole('region',{name:'passing',exact:true}).innerText(),/1,309/);assert.match(await profile.innerText(),/yd\/att/);assert.equal(await profile.getByRole('region',{name:'defensive',exact:true}).count(),0);await fits(page,`${width}px NFL season`);
  if(process.env.PLAYER_CENTER_SCREENSHOT_DIR)await profile.screenshot({path:path.join(process.env.PLAYER_CENTER_SCREENSHOT_DIR,`nfl-season-${width}.png`)});
  await profile.getByRole('tab',{name:'Fantasy',exact:true}).click();await checkTrend(page,profile,'nfl',2026,435);
  await profile.locator('[data-event-id="401872945"]').click();assert.match(await profile.locator('.pc-trend-detail').innerText(),/28\.98 FP/);await fits(page,`${width}px verified NFL fantasy`);
  if(process.env.PLAYER_CENTER_SCREENSHOT_DIR)await profile.screenshot({path:path.join(process.env.PLAYER_CENTER_SCREENSHOT_DIR,`nfl-fantasy-recovered-${width}.png`)});
  await pool.getByLabel('Position filter').selectOption('K');await pool.locator('.pc-player-button').filter({hasText:/Harrison Butker/}).click();await page.waitForFunction(()=>document.querySelector('.pc-profile h2').textContent==='Harrison Butker');await waitProfile(page);
  assert.match(await profile.locator('thead').innerText(),/FGM/);assert.ok(!(await profile.locator('thead').innerText()).includes('Pass YDS'));
  await profile.getByRole('tab',{name:'Season stats',exact:true}).click();await profile.getByRole('region',{name:'kicking',exact:true}).waitFor();assert.match(await profile.innerText(),/kick points/);assert.equal(await profile.getByRole('region',{name:'passing',exact:true}).count(),0);
  await profile.getByRole('tab',{name:'Fantasy',exact:true}).click();assert.match(await profile.innerText(),/Kicker fantasy scoring unavailable/);assert.equal(await profile.locator('.pc-breakdown').count(),0);
  await pool.getByLabel('Position filter').selectOption('D/ST');await pool.locator('.pc-player-button').filter({hasText:/KC D\/ST/}).click();await page.waitForFunction(()=>document.querySelector('.pc-profile h2').textContent==='KC D/ST');await waitProfile(page);
  assert.match(await profile.locator('tbody tr').first().innerText(),/Final/);assert.match(await profile.innerText(),/Verified bye week: 5/);assert.match(await profile.innerText(),/Scheduled/);
  for(const position of ['RB','WR']){await pool.getByLabel('Position filter').selectOption(position);await pool.locator('.pc-player-button').first().click();await page.waitForFunction(position=>document.querySelector('.pc-profile .pc-name p').textContent.includes(position),position);await waitProfile(page);assert.ok((await profile.locator('thead').innerText()).includes(position==='RB'?'CAR':'TGTS'));await seasonDefault(profile);await compactLog(profile,'nfl');if(position==='RB'){const recovered=profile.locator('tbody tr').filter({hasText:'W5 · Oct 11 vs DET'});assert.match(await recovered.innerText(),/3\.6/);assert.ok(!(await recovered.innerText()).includes('Incomplete'));}}
  await page.getByRole('button',{name:'Simulate missing profile data'}).click();await profile.getByText('Game log unavailable',{exact:true}).waitFor();assert.equal(await profile.locator('tbody tr').count(),0);
  await page.getByRole('button',{name:'Restore captured data'}).click();await waitProfile(page);await profile.getByLabel('Profile season').selectOption('2025');await profile.getByText('Game log unavailable',{exact:true}).waitFor();assert.match(await profile.innerText(),/not included in the fixture capture/);
  await fits(page,`${width}px NFL missing`);assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'preview never starts heartbeat/maintenance');assert.deepEqual(allRequests,[],'fixture preview does not authenticate or initialize production preferences');
  if(process.env.PLAYER_CENTER_SCREENSHOT_DIR){fs.mkdirSync(process.env.PLAYER_CENTER_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.PLAYER_CENTER_SCREENSHOT_DIR,`preview-${width}.png`),fullPage:true});}
  await page.close();
 }}finally{await browser.close();}
});

test('real Player History pages resolve exact local IDs, preserve league-history navigation, and show DNP/live/missing states', {skip:(!modulePath||!base)&&'Set browser module and URL',timeout:300000},async()=>{
 const {chromium}=require(modulePath),browser=await chromium.launch();
 try{for(const sport of ['nba','nfl'])for(const width of [360,390,1280]){
  const h=capture.histories.find(h=>h.player.sport===sport&&h.season===(sport==='nba'?2027:2026));
  const {page,errors,queries}=await setup(browser,width,sport);
  console.log('History QA',sport,width);await page.goto(`${base}/player-history?sport=${sport}&playerId=${h.player.playerId}`,{waitUntil:'domcontentloaded',timeout:90000});try { await waitProfile(page); } catch(error) { console.log('History failure',sport,width,errors,queries.map(url=>url.href),(await page.locator('body').innerText()).slice(0,4000));throw error; }
  assert.equal(await page.locator('.pc-profile h2').innerText(),h.player.name);assert.match(await page.locator('.pc-history-detail').innerText(),/Back to players/);await seasonDefault(page.locator('.pc-profile'));await compactLog(page.locator('.pc-profile'),sport);await fits(page,`${sport} history ${width}`);
  assert.ok(queries.some(url=>url.searchParams.get('sport')===sport&&url.searchParams.get('playerId')===String(h.player.playerId)));
  await page.getByRole('tab',{name:'Season stats',exact:true}).click();await page.locator('.pc-season-table').first().waitFor();await fits(page,`${sport} history season ${width}`);
  await page.getByRole('tab',{name:'Fantasy',exact:true}).click();await checkTrend(page,page.locator('.pc-profile'),sport,h.season,h.player.playerId);await fits(page,`${sport} history fantasy ${width}`);
  await page.getByRole('tab',{name:'Game log',exact:true}).click();await waitProfile(page);

  if(width<600){await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));const tail=await page.locator('.pc-history-detail .pc-footnote').last().boundingBox(),nav=await page.locator('.app-mobile-bottom-nav').boundingBox();assert.ok(tail.y+tail.height<nav.y,'profile footer clears mobile navigation');}
  await page.getByRole('button',{name:'← Back to players'}).click();await page.locator('.pc-browser').waitFor({state:'visible'});await page.locator('.pc-player-button').first().click();await waitProfile(page);
  await page.getByRole('button',{name:'111 Sports draft history',exact:true}).click();await page.getByRole('button',{name:'← Player Center',exact:true}).waitFor();await page.getByRole('button',{name:'← Player Center',exact:true}).click();await waitProfile(page);assert.deepEqual(errors,[]);await page.close();
 }
 const {page}=await setup(browser,390,'nba',h=>{h.games[0].participation='dnp';h.games[1].status='live';h.coverage.expectedGames=null;h.coverage.issues.push('simulated_QA_DNP_live');return h;});
 await page.goto(`${base}/player-history?sport=nba&playerId=6`,{waitUntil:'domcontentloaded',timeout:90000});await waitProfile(page);
 assert.match(await page.locator('.pc-profile tbody').innerText(),/DNP/);assert.match(await page.locator('.pc-profile tbody').innerText(),/Live/);assert.ok(!(await page.locator('.pc-profile tbody').innerText()).includes('39.5'));await page.close();
 }finally{await browser.close();}
});

test('compact season tables and trend interactions work in both sport modals; unknown seasons and real zero scores stay distinct', {skip:(!modulePath||!base)&&'Set browser module and URL',timeout:180000},async()=>{
 const {chromium}=require(modulePath),browser=await chromium.launch();
 try{
  for(const width of [360,390,1280])for(const sport of ['nba','nfl']){
   const {page,errors,allRequests}=await setup(browser,width,sport);
   await page.goto(base+'/player-center-preview',{waitUntil:'domcontentloaded',timeout:90000});await waitProfile(page);
   if(sport==='nfl'){await page.getByRole('button',{name:'NFL',exact:true}).click();await waitProfile(page);}
   await page.getByRole('button',{name:'Open player modal',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.locator('.pc-game-log tbody tr').first().waitFor();await seasonDefault(dialog);await compactLog(dialog,sport);await dialog.getByRole('button',{name:'Last 3',exact:true}).click();await dialog.getByLabel('Profile season').selectOption(String(sport==='nba'?2026:2025));await dialog.getByRole('button',{name:'Season',exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Season',exact:true}).getAttribute('aria-pressed'),'true');await dialog.getByLabel('Profile season').selectOption(String(sport==='nba'?2027:2026));await dialog.locator('.pc-game-log tbody tr').first().waitFor();await seasonDefault(dialog);
   await dialog.getByRole('tab',{name:'Season stats',exact:true}).click();await dialog.locator('.pc-season-table').first().waitFor();
   if(sport==='nba'){await dialog.locator('.pc-season-section .pc-table-scroll').first().focus();await page.keyboard.press('Tab');assert.ok(await dialog.locator('.pc-season-details > summary').evaluate(el=>el===document.activeElement),'season disclosure is reachable by Tab');await page.keyboard.press('Enter');}await fits(page,`${sport} modal season ${width}`);
   await dialog.getByRole('tab',{name:'Fantasy',exact:true}).click();await checkTrend(page,dialog,sport,sport==='nba'?2027:2026,sport==='nba'?6:435);
   await dialog.locator('.pc-trend-point').last().focus();await page.keyboard.press('Tab');assert.ok(await dialog.getByRole('button',{name:'Close player profile'}).evaluate(el=>el===document.activeElement),'focus still wraps inside modal');await fits(page,`${sport} modal fantasy ${width}`);
   if(process.env.PLAYER_CENTER_SCREENSHOT_DIR)await dialog.screenshot({path:path.join(process.env.PLAYER_CENTER_SCREENSHOT_DIR,`${sport}-trend-modal-${width}.png`)});
   await dialog.getByRole('button',{name:'Close player profile'}).click();await dialog.waitFor({state:'detached'});assert.deepEqual(errors,[]);assert.deepEqual(allRequests,[]);await page.close();
  }
  const mismatch=await setup(browser,390,'nba',h=>{h.seasonStats.season=2026;return h;});
  await mismatch.page.goto(`${base}/player-history?sport=nba&playerId=6`,{waitUntil:'domcontentloaded',timeout:90000});await waitProfile(mismatch.page);
  await mismatch.page.getByRole('tab',{name:'Season stats',exact:true}).click();await mismatch.page.getByText('Season totals unavailable',{exact:true}).waitFor();assert.equal(await mismatch.page.locator('.pc-season-table').count(),0);await mismatch.page.close();
  const zero=await setup(browser,390,'nba',h=>{for(const game of h.games)for(const key of Object.keys(game.stats))game.stats[key]=0;return h;});
  await zero.page.goto(`${base}/player-history?sport=nba&playerId=6`,{waitUntil:'domcontentloaded',timeout:90000});await waitProfile(zero.page);await zero.page.getByRole('tab',{name:'Fantasy',exact:true}).click();
  assert.deepEqual(await zero.page.locator('.pc-trend-metrics dd').allTextContents(),['0','0','0']);assert.match(await zero.page.locator('.pc-trend-detail').innerText(),/0 FP/);assert.equal(await zero.page.locator('.pc-trend-missing').count(),0);assert.deepEqual(zero.errors,[]);await zero.page.close();
 }finally{await browser.close();}
});


test('genuinely unknown fumbles retain compact incomplete rows and withheld fantasy totals', {skip:(!modulePath||!base)&&'Set browser module and URL',timeout:120000},async()=>{
 const {chromium}=require(modulePath),browser=await chromium.launch();
 try{for(const [id,event,label]of [[1,'401872991','W5 · Oct 11 vs DET'],[435,'401872945','W2 · Sep 20 vs IND']]){
  const {page,errors}=await setup(browser,390,'nfl',h=>{h.games.find(g=>g.eventId===event).stats.fumbles_lost=null;return h;});
  await page.goto(`${base}/player-history?sport=nfl&playerId=${id}`,{waitUntil:'domcontentloaded',timeout:90000});await waitProfile(page);const profile=page.locator('.pc-profile');await seasonDefault(profile);
  const row=profile.locator('.pc-game-log tbody tr').filter({hasText:label});assert.match(await row.innerText(),/Incomplete/);assert.ok((await row.boundingBox()).height<=40);
  await profile.getByRole('tab',{name:'Fantasy',exact:true}).click();const missing=profile.locator(`[data-event-id="${event}"]`);await missing.click();assert.match(await profile.locator('.pc-trend-detail').innerText(),/Unavailable/);assert.equal(await missing.getAttribute('data-fp'),'unavailable');assert.match(await profile.locator('.pc-trend-metrics').innerText(),/Verified-game average/);assert.ok((await profile.locator('.pc-trend-line').getAttribute('d')).split('M').length-1>=2);assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
});

test('trend one/zero/all-incomplete states, player/season reset, and Group/snapshot scores remain honest', {skip:(!modulePath||!base)&&'Set browser module and URL',timeout:180000},async()=>{
 const {chromium}=require(modulePath),browser=await chromium.launch();
 try{
  const preview=await setup(browser,360),page=preview.page;
  await page.goto(base+'/player-center-preview',{waitUntil:'domcontentloaded',timeout:90000});await waitProfile(page);
  const profile=page.locator('.pc-preview-layout .pc-profile'),pool=page.locator('.pc-browser');
  await pool.locator('.pc-player-button').filter({hasText:/Stephen Curry/}).click();await page.waitForFunction(()=>document.querySelector('.pc-profile h2').textContent==='Stephen Curry');await waitProfile(page);
  await profile.getByRole('tab',{name:'Fantasy',exact:true}).click();await checkTrend(page,profile,'nba',2027,4);assert.equal(await profile.locator('.pc-trend-point').count(),1);
  await profile.locator('.pc-trend').getByRole('button',{name:'Last 5',exact:true}).click();
  await pool.locator('.pc-player-button').filter({hasText:/LeBron James/}).click();await page.waitForFunction(()=>document.querySelector('.pc-profile h2').textContent==='LeBron James');await waitProfile(page);
  await profile.getByRole('tab',{name:'Fantasy',exact:true}).click();await checkTrend(page,profile,'nba',2027,6);
  await profile.getByLabel('Profile season').selectOption('2025');await profile.getByText('No completed fantasy scores yet',{exact:true}).waitFor();assert.deepEqual(await profile.locator('.pc-trend-metrics dd').allTextContents(),['—','—','—']);assert.equal(await profile.locator('.pc-trend-point').count(),0);
  await profile.locator('.pc-trend').getByRole('button',{name:'Last 5',exact:true}).click();await profile.getByLabel('Profile season').selectOption('2027');await checkTrend(page,profile,'nba',2027,6);
  assert.deepEqual(preview.allRequests,[]);assert.deepEqual(preview.errors,[]);await page.close();
  for(const sport of ['nba','nfl']){
   const id=sport==='nba'?6:435;
   const absent=await setup(browser,390,sport,h=>{for(const g of h.games)g.stats[sport==='nba'?'turnovers':'fumbles_lost']=null;return h;});
   await absent.page.goto(`${base}/player-history?sport=${sport}&playerId=${id}`,{waitUntil:'domcontentloaded',timeout:90000});await waitProfile(absent.page);await absent.page.getByRole('tab',{name:'Fantasy',exact:true}).click();await absent.page.locator('.pc-trend').waitFor();
   assert.deepEqual(await absent.page.locator('.pc-trend-metrics dd').allTextContents(),['—','—','—']);assert.equal(await absent.page.locator('.pc-trend-average').count(),0);assert.equal((await absent.page.locator('.pc-trend-line').getAttribute('d')).trim(),'');assert.equal(await absent.page.locator('.pc-trend-point:not(.pc-trend-missing)').count(),0);await fits(absent.page,sport+' incomplete');assert.deepEqual(absent.errors,[]);await absent.page.close();
   for(const basis of ['league_settings','slate_snapshot']){
    const scoreContext={sport,basis,settings:{sport,scoring:sport==='nba'?{points:2,assists:3}:{passingTouchdowns:6,receptions:.5}}};
    const group=await setup(browser,390,sport,null,scoreContext),h=capture.histories.find(h=>h.player.sport===sport&&h.player.playerId===id&&h.season===(sport==='nba'?2027:2026));
    await group.page.goto(`${base}/player-history?sport=${sport}&playerId=${id}`,{waitUntil:'domcontentloaded',timeout:90000});await waitProfile(group.page);await group.page.getByRole('tab',{name:'Fantasy',exact:true}).click();await group.page.locator('.pc-trend-point').first().waitFor();
    const p=presentProfile(h,scoreContext,capture.capturedAt),expected=Object.values(p.gameFantasyPoints).filter(v=>v!==null),mean=expected.reduce((a,b)=>a+b,0)/expected.length;
    assert.equal(await group.page.locator('.pc-trend-metrics dd').first().innerText(),new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(mean));assert.match(await group.page.locator('.pc-trend .pc-scoring-basis').innerText(),basis==='slate_snapshot'?/Frozen slate scoring/:/Current Group scoring/);assert.deepEqual(group.errors,[]);await group.page.close();
   }
  }
 }finally{await browser.close();}
});
