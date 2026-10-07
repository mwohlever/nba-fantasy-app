/* Real Draft UI + AppNav in Chromium. All requests are intercepted; no external writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test');
const fixture=require('./helpers/nfl-draft-board-fixture.cjs');
const modulePath=process.env.NFL_DRAFT_BOARD_BROWSER_MODULE??process.env.FOOTBALL_BROWSER_MODULE;
test('NFL complete board: 360/390/486/1024, current-only actions, corrections, final pick, and bottom navigation',{
  skip:!modulePath&&'Set NFL_DRAFT_BOARD_BROWSER_MODULE to installed Playwright',
},async()=>{
  const {chromium}=require(modulePath),root=path.resolve(__dirname,'..');
  const css=await require('postcss')([require('@tailwindcss/postcss')({base:root,optimize:true})]).process(fs.readFileSync(path.join(root,'app/globals.css'),'utf8'),{from:path.join(root,'app/globals.css')});
  const bundle=require('./helpers/nfl-draft-browser-bundle.cjs')();const browser=await chromium.launch();
  try{
    for(const width of [360,390,486,1024])for(const commissioner of [true,false]){
      let state=fixture.history();const writes=[],errors=[];
      const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
      const viewerTeam=commissioner?4:1,user={id:commissioner?'mark':'andy',role:commissioner?'admin':'player',systemRole:'user',teamId:viewerTeam,activeGroupTeamId:viewerTeam,displayName:commissioner?'Mark':'Andy'};
      const groupContext={group:{id:'a',name:'111 Sports',slug:'111',isActive:true},team:{id:viewerTeam,name:user.displayName},membership:{role:commissioner?'admin':'member',isActive:true},canAdministerGroup:commissioner,leagues:[{id:'nfl-a',sportKey:'nfl',name:'NFL',isEnabled:true,gameMode:'standard',settings:{},settingsVersion:5}]};
      const players=[...fixture.history(21).picks.map(p=>({id:p.player_id,name:p.player_name,position_group:p.player_position,is_active:true,nfl_player_id:String(p.player_id),team_abbreviation:'BUF'})),{id:900,name:'Replacement receiver',position_group:'WR',is_active:true,nfl_player_id:'900'}];
      const slate={id:193,sport:'nfl',date:'2099-10-08',start_date:'2099-10-08',end_date:'2099-10-12',display_name:'Week 5',is_locked:false,rules_snapshot:fixture.snapshot};
      function lineups(){return fixture.teams.map(team=>{
        const picks=state.picks.filter(p=>p.team_id===team.id&&p.status==='active');
        const player_slots=picks.map(p=>({player_id:p.player_id,roster_slot_position:p.roster_slot_position,roster_slot_index:p.roster_slot_index}));
        if(team.id===4&&state.corrections.length)player_slots.push({player_id:900,roster_slot_position:'WR',roster_slot_index:1});
        return {team_id:team.id,player_ids:player_slots.map(p=>p.player_id),player_slots};
      });}
      await page.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());if(url.hostname!=='nfl-draft.test')return route.abort();
        if(request.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>'});
        if(url.pathname.startsWith('/api/')){
          let body;const identity={groupId:'a',sport:'nfl',slateId:193};
          if(request.method()==='POST'){
            assert.equal(url.pathname,'/api/lineups');const input=request.postDataJSON();writes.push(input);
            assert.equal(input.teamId,1);assert.equal(input.slateId,193);assert.equal(state.turn.overallPick,21);assert.ok(input.playerIds.includes(899));assert.equal(input.expectedPlayerIds.length,6);
            state=fixture.history(21);Object.assign(state.picks.at(-1),{actor_user_id:user.id,actor_name:user.displayName,is_proxy:commissioner});body={success:true,isPick:true,overallPick:21};
          }else if(url.pathname==='/api/me')body={user,groupContext};
          else if(url.pathname==='/api/lineups')body={...identity,lineups:lineups(),draftContext:{history:state,participants:fixture.teams,canProxyDraft:commissioner,groupId:'a',slateId:193,slate}};
          else if(url.pathname==='/api/slate-availability')body={...identity,availablePlayerIds:players.map(p=>p.id)};
          else if(url.pathname==='/api/player-stats')body={...identity,playerStats:[],teamResults:[]};
          else if(url.pathname==='/api/team-results')body={...identity,teamResults:[]};
          else if(url.pathname==='/api/draft-projections')body={...identity,projections:{}};
          else if(url.pathname==='/api/lineups/nfl-games')body={slateId:193,gamesByTeam:{}};
          else if(url.pathname==='/api/player-history-detail')body={games:[],history:[],summary:null};
          else body={success:true,notifications:[],unreadCount:0};
          return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
        }
        const props={players,teams:fixture.teams,slates:[slate],slateTeamConfigs:fixture.teams.map((t,i)=>({slate_id:193,team_id:t.id,draft_order:i+1,is_participating:true})),rosterSlots:fixture.snapshot.roster.slots.map(s=>({position:s.position,slot_count:s.slotCount})),playerAverages:[],initialSelectedSlateId:193,savedLineupsForInitialSlate:[],playerStats:[],teamResults:[],defaultViewMode:'draft',sport:'nfl'};
        return route.fulfill({contentType:'text/html',body:`<html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style><div id="app"></div><script>${bundle.replaceAll('</script','<\\/script')}
          window.fixtureGroup={groupContext:${JSON.stringify(groupContext)},availableGroups:[],isLoading:false,isSwitchingGroup:false,setActiveGroup:()=>{}};
          ReactDOMClient.createRoot(document.getElementById('app')).render(React.createElement(React.Fragment,null,React.createElement(AppNav),React.createElement('main',{className:'app-page-content mx-auto max-w-5xl p-4'},React.createElement(DraftBuilder,${JSON.stringify(props)}))));</script></html>`});
      });
      await page.goto('http://nfl-draft.test/lineups/draft?sport=nfl&slateId=193');
      await page.getByRole('button',{name:'Draft Order',exact:true}).click();
      const board=page.getByRole('region',{name:'Draft order'});await board.locator('[data-draft-slot="21"]').waitFor();
      assert.equal(await board.locator('[data-draft-slot]').count(),21);
      assert.equal(await board.locator('[data-draft-state="current"]').count(),1);
      assert.match(await board.locator('[data-draft-slot="17"]').innerText(),/Removed.*Corrected \/ reversed/s);
      assert.equal(await board.locator('[data-draft-slot="17"]').getAttribute('data-draft-state'),'corrected');
      assert.match(await board.locator('[data-draft-slot="20"]').innerText(),/Matthew Stafford/);
      const actionName=commissioner?'Make Pick for Andy':'Make My Pick';assert.equal(await board.getByRole('button',{name:actionName,exact:true}).count(),1);
      await board.getByText('Roster corrections (2)',{exact:true}).click();await board.getByText(/Roster adjustment.*Replacement receiver/).waitFor();
      await board.locator('[data-draft-slot="17"] summary').click();assert.match(await board.locator('[data-draft-slot="17"]').innerText(),/Nico Collins.*Removed/s);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
      const checkCells=async()=>{for(const cell of await board.locator('th,td').all()){const size=await cell.evaluate(el=>({text:el.innerText,scroll:el.scrollWidth,width:el.clientWidth}));assert.ok(size.scroll<=size.width+1,`${width}px ${commissioner?'commissioner':'player'} cell must fit: ${JSON.stringify(size)}`);}};
      await checkCells();
      if(commissioner){await board.getByRole('button',{name:'Edit Picks',exact:true}).click();await board.getByRole('button',{name:'Edit pick 20',exact:true}).waitFor();await checkCells();await board.getByRole('button',{name:'Done',exact:true}).click();}
      const nav=page.locator('.app-mobile-bottom-nav');if(width<640){await nav.waitFor({state:'visible'});await board.locator('[data-draft-slot="21"]').scrollIntoViewIfNeeded();assert.ok(await nav.isVisible());}
      if(process.env.NFL_BOARD_SCREENSHOT_DIR){fs.mkdirSync(process.env.NFL_BOARD_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.NFL_BOARD_SCREENSHOT_DIR,`${width}-${commissioner?'commissioner':'player'}.png`),fullPage:true});}
      // Only the authoritative current row starts the existing flow.
      await board.getByRole('button',{name:actionName,exact:true}).click();
      await page.getByPlaceholder(/Search/).fill('Final QB');
      page.on('dialog',dialog=>dialog.accept());
      await page.locator('button.draft-player-card').filter({hasText:'Final QB'}).click();
      await board.getByText('Draft complete',{exact:true}).waitFor();
      assert.equal(writes.length,1);assert.match(await board.locator('[data-draft-slot="21"]').innerText(),/Final QB/);
      assert.equal(await board.locator('[data-draft-state="current"]').count(),0);assert.equal(await board.locator('[data-draft-slot="21"] button').count(),0);
      assert.match(await board.locator('[data-draft-slot="17"]').innerText(),/Removed/);assert.deepEqual(errors,[]);
      state=fixture.history(0,false);await page.reload();await page.getByRole('button',{name:'Draft Order',exact:true}).click();await board.locator('[data-draft-slot="1"]').waitFor();
      assert.equal(await board.locator('[data-draft-slot]').count(),21);assert.equal(await board.locator('[data-draft-state="future"]').count(),20);assert.equal(await board.locator('[data-draft-state="future"] button').count(),0);
      assert.equal(await board.locator('[data-draft-state="current"] button').count(),commissioner?1:0);await checkCells();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(process.env.NFL_BOARD_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.NFL_BOARD_SCREENSHOT_DIR,`${width}-${commissioner?'commissioner':'player'}-empty.png`),fullPage:true});
      await page.close();
    }
  }finally{await browser.close();}
});
