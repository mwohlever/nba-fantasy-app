/* eslint-disable @typescript-eslint/no-require-imports */
/* Actual draft server-page output + actual LineupBuilder, AppNav and authenticated API contracts.
   Transport, auth and database are isolated fixtures; no production login or write is performed. */
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path');
require('../scripts/lib/playerCenterRollout.cjs').registerTypescript();
const {presentProfile}=require('../lib/player-center/presentation.ts'),{compareHistories}=require('../lib/player-center/comparison.ts');
const capture=require('../data/player-center-preview/captured.json'),loadPage=require('./helpers/player-center-draft-page.cjs');
const modulePath=process.env.PLAYER_CENTER_BROWSER_MODULE;
test('actual NBA/NFL draft pages retain scoped server inputs, actual-stat research, profile tabs and roster actions at 360/390/1280', {skip:!modulePath&&'Set PLAYER_CENTER_BROWSER_MODULE',timeout:360000},async()=>{
 const {chromium}=require(modulePath),root=path.resolve(__dirname,'..');
 const css=await require('postcss')([require('@tailwindcss/postcss')({base:root,optimize:true})]).process(fs.readFileSync(path.join(root,'app/globals.css'),'utf8'),{from:path.join(root,'app/globals.css')});
 const browser=await chromium.launch();
 try{for(const sport of ['nba','nfl']){
  const {props,queries,snapshot,pool}=await loadPage(sport),bundle=require('./helpers/nfl-draft-browser-bundle.cjs')(sport);
  assert.equal(props.sport,sport);assert.equal(props.initialSelectedSlateId,193);assert.deepEqual(props.teams.map(t=>t.id),[1,2]);assert.ok(queries.find(q=>q.table==='slates').filters.some(([key,value])=>key==='league_id'&&value===sport+'-a'));assert.ok(queries.find(q=>q.table==='teams').filters.some(([key,value])=>key==='group_id'&&value==='a'));
  const groupContext={group:{id:'a',name:'Draft fixture Group',slug:'a',isActive:true},team:{id:1,name:'First team'},membership:{role:'admin',isActive:true},canAdministerGroup:true,leagues:[{id:sport+'-a',sportKey:sport,name:sport,isEnabled:true,settings:{},gameMode:'standard'}]};
  for(const enabled of [true,false])for(const width of [360,390,1280]){
   const activeBundle=enabled?bundle:require('./helpers/nfl-draft-browser-bundle.cjs')(sport,false);
   const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<600}),errors=[],requests=[],writes=[],forecasts=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());if(url.hostname!=='draft.test')return route.abort();
    if(request.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>'});
    if(url.pathname.startsWith('/api/')){
     if(url.pathname.includes('projections'))forecasts.push(url.pathname);
     if(request.method()!=='GET'){writes.push(url.pathname);return route.fulfill({status:403,json:{error:'Read-only test: no pick is saved.'}});}
     let body={success:true},scope={groupId:'a',sport,slateId:193};
     if(url.pathname==='/api/me')body={user:{id:'fixture-user',role:'admin',teamId:1,activeGroupTeamId:1,displayName:'Fixture'},groupContext};
     else if(url.pathname==='/api/lineups')body={...scope,lineups:[],draftContext:sport==='nfl'?{history:{available:true,initialized:false,board:{participantIds:[1,2],rosterSize:7},picks:[],corrections:[],turn:{state:'empty',overallPick:1,round:1,pickInRound:1,teamId:1}},participants:props.teams,canProxyDraft:true,...scope,slate:props.slates[0]}:undefined};
     else if(url.pathname==='/api/slate-availability')body={...scope,availablePlayerIds:props.players.map(p=>p.id)};
     else if(url.pathname==='/api/player-stats')body={...scope,playerStats:[],teamResults:[]};
     else if(url.pathname==='/api/team-results')body={...scope,teamResults:[]};
     else if(url.pathname==='/api/draft-projections')body={...scope,projections:Object.fromEntries(props.players.map(p=>[p.id,{projection:9999}]))};
     else if(url.pathname==='/api/lineups/nfl-games')body={slateId:193,gamesByTeam:{}};
     else if(url.pathname==='/api/player-history-detail')body={games:[],history:[],summary:null};
     else if(url.pathname.startsWith('/api/player-center')){
      requests.push(url);assert.equal(url.searchParams.get('slateId'),'193');assert.equal(url.searchParams.get('sport'),sport);
      const scoring={sport,basis:'slate_snapshot',settings:snapshot},season=Number(url.searchParams.get('season'));
      if(url.pathname.endsWith('/comparisons'))body={...compareHistories({sport,season,scoring,window:url.searchParams.get('window'),metric:url.searchParams.get('metric'),position:url.searchParams.get('position')??undefined,ascending:url.searchParams.get('direction')==='asc'},pool,capture.capturedAt,capture.capturedAt),groupId:'a',leagueId:sport+'-a'};
      else{const h=pool.find(h=>h.player.playerId===Number(url.searchParams.get('playerId'))&&h.season===season);assert.ok(h,'exact local identity and season');body={...presentProfile(h,scoring,capture.capturedAt),groupId:'a',leagueId:sport+'-a'};}
     }
     return route.fulfill({json:body});
    }
    return route.fulfill({contentType:'text/html',body:`<html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style><div id="app"></div><script>${activeBundle.replaceAll('</script','<\\/script')}
     window.fixtureGroup={groupContext:${JSON.stringify(groupContext)},availableGroups:[],isLoading:false,isSwitchingGroup:false,setActiveGroup:()=>{}};
     ReactDOMClient.createRoot(document.getElementById('app')).render(React.createElement(React.Fragment,null,React.createElement(AppNav),React.createElement('main',{className:'app-page-content mx-auto max-w-5xl p-4'},React.createElement(DraftBuilder,${JSON.stringify(props)}))));</script></html>`});
   });
   console.log('Draft retirement QA',sport,enabled?'center':'catalog',width);await page.goto(`http://draft.test/lineups/draft?sport=${sport}&slateId=193`,{waitUntil:'domcontentloaded',timeout:90000});await page.getByRole('button',{name:'Players',exact:true}).click();
   const research=page.locator('.pc-browser');await research.locator('tbody tr').first().waitFor();
   if(!enabled){
    assert.equal(await research.getByLabel('Stat sort',{exact:true}).count(),0);await research.getByLabel('Position filter').selectOption(sport==='nba'?'F/C':'QB');
    const name=sport==='nba'?'LeBron James':'Patrick Mahomes';await research.getByRole('searchbox').fill(name);await research.locator('button.pc-player-button').filter({hasText:name}).click();
    const modal=page.getByRole('dialog',{name:name+' player profile'});await modal.waitFor();assert.equal(await modal.getByRole('region',{name:'Roster actions'}).count(),1);assert.equal(await modal.getByRole('tab').count(),0);assert.match(await modal.innerText(),/not activated/);assert.doesNotMatch(await modal.innerText(),/projection|probability/i);
    await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});assert.equal(requests.length,0);assert.deepEqual(forecasts,[]);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.close();continue;
   }

   for(const label of ['Last game','Last 3','Last 5','Season']){await research.getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(100);assert.equal(await research.getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed'),'true');}
   await research.getByLabel('Position filter').selectOption(sport==='nba'?'F/C':'QB');await research.getByLabel('Stat sort',{exact:true}).selectOption(sport==='nba'?'points':'passing_yards');await research.getByRole('button',{name:'Change stat sort direction'}).click();
   const name=sport==='nba'?'LeBron James':'Patrick Mahomes';await research.getByRole('searchbox').fill(name);await research.locator('button.pc-player-button').filter({hasText:name}).waitFor();assert.equal(await research.locator('tbody tr').count(),1);
   await research.locator('button.pc-player-button').filter({hasText:name}).click();const modal=page.getByRole('dialog',{name:name+' player profile'});await modal.waitFor();await modal.locator('.pc-game-log tbody tr').first().waitFor();assert.equal(await modal.getByRole('button',{name:'Season',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await modal.getByRole('region',{name:'Roster actions'}).count(),1);assert.ok(!(await modal.locator('.pc-profile').innerText()).includes('9999'));
   await modal.getByRole('tab',{name:'Season stats',exact:true}).click();await modal.locator('.pc-season-table').first().waitFor();await modal.getByRole('tab',{name:'Fantasy',exact:true}).click();await modal.locator('.pc-trend-point').first().waitFor();assert.match(await modal.locator('.pc-scoring-basis').innerText(),/Frozen slate/);
   await modal.locator('.pc-trend-point').first().focus();await page.keyboard.press('End');assert.equal(await modal.locator('.pc-trend-point').last().getAttribute('aria-pressed'),'true');
   await modal.locator('.pc-trend-detail').scrollIntoViewIfNeeded();const detail=await modal.locator('.pc-trend-detail').boundingBox(),footer=await modal.locator('.pc-modal-footer').boundingBox();assert.ok(detail.y+detail.height<=footer.y+1,'selected score can be read above the roster footer after internal scrolling');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(forecasts,[],'draft browsing never requests forecasts');assert.deepEqual(writes,[],'opening profiles never saves picks');assert.deepEqual(errors,[]);assert.ok(requests.some(url=>url.pathname.endsWith('/comparisons')));
   if(process.env.PLAYER_CENTER_SCREENSHOT_DIR){fs.mkdirSync(process.env.PLAYER_CENTER_SCREENSHOT_DIR,{recursive:true});await modal.screenshot({path:path.join(process.env.PLAYER_CENTER_SCREENSHOT_DIR,`${sport}-real-draft-${width}.png`)});}
   await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});await research.getByRole('button',{name:'Info about '+name}).click();await page.getByRole('dialog',{name:name+' player profile'}).waitFor();assert.deepEqual(writes,[]);await page.close();
  }
 }}finally{await browser.close();}
});
