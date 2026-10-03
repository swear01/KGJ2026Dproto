const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
    const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}/?test`;
    await page.goto(url);
    const state = () => page.evaluate(() => flowTest.state);
    const advance = seconds => page.evaluate(s => flowTest.advance(s), seconds);
    const reset = () => page.evaluate(() => flowTest.reset());
    assert.equal((await state()).running, false);
    await page.locator('#practice').click();
    assert((await state()).practiceMode&&!((await state()).running),'Practice must open the actual neck chamber without starting motion');
    const neckLevel=await page.evaluate(()=>{
      const neck=flowTest.obstacles.find(o=>o.kind==='neck');flowTest.input(true);flowTest.advance(6.1);
      return {neck,held:flowTest.state};
    });
    assert(!neckLevel.held.won&&!neckLevel.held.failed&&neckLevel.held.gasps===0&&neckLevel.held.body.y>neckLevel.neck.y+50,'Broadside constant exhale must remain wedged before automatic gasping');
    await page.locator('#practice').click();
    await page.keyboard.down('Space');await advance(2);const wedged=await state();
    assert((await page.locator('#hint').textContent()).includes('吸氣'),'A stuck body must show the inhale-to-retreat hint');
    await page.keyboard.up('Space');await advance(2.1);const retreat=await state();
    assert(retreat.body.y>wedged.body.y+45&&retreat.collisions>wedged.collisions&&Math.abs(retreat.body.angle-wedged.body.angle)>.3,'Inhale must retreat into the chamber and rotate through ramp contact');
    await page.keyboard.down('Space');
    const neckPass=await page.evaluate(()=>{
      const neck=flowTest.obstacles.find(o=>o.kind==='neck');let clear=true,slotWidth=Infinity;
      for(let i=0;i<300&&!flowTest.state.won;i++) {
        flowTest.advance(1/120);const points=flowTest.bodyPoints(),y=flowTest.state.body.y;
        for(let j=0;j<points.length;j++){const a=points[j],b=points[(j+1)%points.length];for(const t of [0,.25,.5,.75])if(flowTest.inSolid(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t))clear=false;}
        if(y<neck.y+20&&y>neck.y-85)slotWidth=Math.min(slotWidth,Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)));
      }
      return {state:flowTest.state,clear,slotWidth};
    });
    await page.keyboard.up('Space');
    assert(neckPass.state.won&&neckPass.state.practiceMode&&neckPass.state.gasps===0&&neckPass.clear&&neckPass.slotWidth<neckLevel.neck.gap,'Breathing and contact rotation must clear the actual slot without penetration, angle edits or automatic gasps');
    assert.equal(await page.locator('#win-title').textContent(),'通過了！','Practice completion must identify its local goal');
    await page.locator('#again').click();assert((await state()).practiceMode&&!((await state()).won),'Retry must preserve the practice level');
    await page.locator('#reset').click();assert(!(await state()).practiceMode&&(await state()).body.y===6600,'Returning to the complete level must restore the pulmonary start');
    await page.locator('#breath').focus();
    const orientations=await page.evaluate(()=>{
      const free=[-2.5,-1.6,-.8,0,.8,1.6,2.5,3].map(angle=>{
        flowTest.seedBody({x:flowTest.center(5250),y:5250,angle,omega:0});flowTest.input(true);flowTest.advance(.15);
        return {angle,body:flowTest.state.body,collisions:flowTest.state.collisions};
      });
      const neck=flowTest.obstacles.find(o=>o.kind==='neck');
      flowTest.seedBody({x:flowTest.center(neck.y)-12,y:neck.y+100,angle:Math.PI/2,omega:0});flowTest.input(true);flowTest.advance(2);
      const narrow=flowTest.state;flowTest.reset();return {free,narrow};
    });
    assert(orientations.free.every(p=>p.collisions===0&&p.body.angle===p.angle&&p.body.omega===0),'Free flight must preserve every initial orientation without a preferred-angle force');
    assert(orientations.narrow.cleared.includes('neck')&&orientations.narrow.gasps===0&&orientations.narrow.breathPhase==='exhale','A body that already fits must pass without inhaling or an unlock flag');
    const collisions=await page.evaluate(()=>{
      const plane=[{x:-100,y:4300},{x:200,y:4300},{x:200,y:4700},{x:-100,y:4700}];
      const energy=b=>(b.vx*b.vx+b.vy*b.vy+flowTest.inertia*b.omega*b.omega)/2;
      const impacts=[-1.15,-.6,0,.6].map(angle=>{
        flowTest.seedBody({x:216,y:4500,vx:-180,vy:60,angle,omega:0});
        const before=flowTest.state.body,hit=flowTest.collidePolygon(plane,.58,.12),after=flowTest.state.body;
        return {hit,before,after,energyBefore:energy(before),energyAfter:energy(after),clear:flowTest.bodyPoints().every(p=>p.x>=200)};
      });
      const slot=[{x:0,y:4450},{x:302,y:4450},{x:302,y:4550},{x:0,y:4550}];
      const fits=[0,Math.PI/2].map(angle=>{
        flowTest.seedBody({x:320,y:4500,angle});const points=flowTest.bodyPoints();
        const width=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));
        return {width,hit:flowTest.collidePolygon(slot)};
      });
      flowTest.seedBody({x:218,y:4500,vx:-8,vy:0,angle:0,omega:0});
      flowTest.collidePolygon(plane,.58,.12);
      const slow=flowTest.state.body,p=flowTest.support(1,0);
      const restingNormal=slow.vx-slow.omega*(p.y-slow.y);
      flowTest.seedBody({x:216,y:4500,vx:80,vy:0,angle:0,omega:0});
      flowTest.collidePolygon(plane,.58,.12);const separating=flowTest.state.body;
      flowTest.seedBody({x:flowTest.bounds(4500)[0]+28,y:4500,vx:-220,vy:20,angle:-.6,omega:0});
      flowTest.advance(.12);const curved=flowTest.state;
      const wallClear=flowTest.bodyPoints().every(p=>!flowTest.inSolid(p.x,p.y));
      const fish=flowTest.obstacles[0],shaft=flowTest.shelfShape(fish),x=(shaft[0].x+shaft[2].x)/2;
      flowTest.seedBody({x,y:fish.y+90,vx:0,vy:-800,angle:0,omega:0});flowTest.advance(.3);
      const fishHit=flowTest.state;
      flowTest.reset();return {impacts,fits,restingNormal,separating,curved,wallClear,fishHit};
    });
    assert(collisions.impacts.every(p=>p.hit&&p.clear&&p.energyAfter<=p.energyBefore+1e-6&&p.after.vx>0), 'Elastic impacts must rebound, separate the actual outline and avoid adding kinetic energy');
    assert(collisions.impacts[1].after.omega < -3 && collisions.impacts[2].after.omega > 3, 'Changing impact orientation must change torque and spin direction');
    assert(collisions.fits[0].width>36&&collisions.fits[0].hit&&collisions.fits[1].width<36&&!collisions.fits[1].hit, 'Turning to the narrow side must change whether the same slot fits');
    assert(collisions.restingNormal>=-.001&&collisions.restingNormal<.5, 'Low-speed contact must separate gently without elastic rebound');
    assert.equal(collisions.separating.vx,80,'A separating body must not receive another rebound impulse');
    assert(collisions.curved.body.vx>0&&Math.abs(collisions.curved.body.omega)>2&&collisions.wallClear, 'Curved cavity walls must rebound and rotate the body without outline penetration');
    assert(collisions.fishHit.injuries>0, 'A fast irregular body must collide with thin fishbone geometry');
    const breathing=await page.evaluate(()=>{
      flowTest.seedBody({x:320,y:5000},.4);flowTest.input(true);flowTest.advance(.05);flowTest.input(false);
      const start=flowTest.state.air;
      flowTest.advance(.3);const early=flowTest.state;
      flowTest.advance(.6);const middleStart=flowTest.state.air;
      flowTest.advance(.3);const middle=flowTest.state;
      flowTest.advance(.9);const lateStart=flowTest.state.air;
      flowTest.advance(.3);const full=flowTest.state;
      flowTest.advance(1.3);const gentleOut=flowTest.state;
      flowTest.advance(1.4);const nextInhale=flowTest.state;
      flowTest.advance(1.2);const gentleIn=flowTest.state;
      flowTest.seedBody({x:320,y:5000},.025);flowTest.input(true);
      for(let i=0;i<30&&flowTest.state.breathPhase!=='gasp';i++)flowTest.advance(1/120);
      const empty=flowTest.state;
      flowTest.input(false);flowTest.advance(.2);const released=flowTest.state;
      flowTest.input(true);flowTest.advance(.7);const gasp=flowTest.state;
      flowTest.advance(.9);const gaspFull=flowTest.state;
      flowTest.advance(1/120);const resumed=flowTest.state;
      flowTest.seedBody({x:320,y:5000},.001);flowTest.input(true);flowTest.advance(1/120);flowTest.input(false);
      flowTest.advance(1.8);const unheldFull=flowTest.state;
      flowTest.advance(1/120);const unheldRest=flowTest.state;
      flowTest.reset();return {earlyGain:early.air-start,middleGain:middle.air-middleStart,lateGain:full.air-lateStart,
        early,middle,full,gentleOut,nextInhale,gentleIn,empty,released,gasp,gaspFull,resumed,unheldFull,unheldRest};
    });
    assert(breathing.earlyGain>0&&breathing.middleGain>breathing.earlyGain*3&&breathing.lateGain<breathing.middleGain/3, 'Refill must start slowly, accelerate mid-inhale and ease off before full');
    assert(breathing.middle.flow<breathing.early.flow&&breathing.full.air===1, 'Inward airflow must follow refill intensity and reach capacity continuously');
    assert(breathing.gentleOut.breathPhase==='rest-exhale'&&breathing.gentleOut.air<1&&breathing.gentleOut.flow>0, 'A full lung must move into gentle automatic exhalation');
    assert(breathing.nextInhale.breathPhase==='inhale'&&breathing.gentleIn.air>breathing.nextInhale.air&&breathing.gentleIn.flow<0, 'Released input must continue a gentle inhalation/exhalation cycle');
    assert(breathing.empty.air===0&&breathing.empty.breathPhase==='gasp'&&breathing.empty.held&&breathing.empty.gasps===1, 'Empty air must trigger exactly one forced deep inhale even while held');
    assert(breathing.released.breathPhase==='gasp'&&breathing.gasp.breathPhase==='gasp'&&breathing.gasp.held, 'Releasing and pressing again must not interrupt the forced breath');
    assert(breathing.gasp.flow<-.4&&breathing.gasp.body.vy>40&&breathing.gasp.body.y>breathing.empty.body.y, 'A deep gasp must create stronger inward flow and pull through normal physics');
    assert(breathing.gaspFull.air===1&&breathing.gaspFull.gasps===1&&breathing.resumed.breathPhase==='exhale'&&breathing.resumed.air<1, 'A forced breath must fill before held input resumes exhalation');
    assert(breathing.unheldFull.air===1&&!breathing.unheldFull.held&&breathing.unheldRest.breathPhase==='rest-exhale', 'Releasing during a gasp must finish filling and return to gentle breathing');
    assert.equal((await state()).gasps,0,'Reset must clear forced breathing');
    await page.evaluate(()=>flowTest.seedBody({x:320,y:5000},.01));
    await page.keyboard.down('Space');await advance(.15);
    assert((await page.locator('#state').textContent()).includes('深吸氣'), 'The HUD must explain the forced breath');
    assert((await page.locator('#button-label').textContent()).includes('強制深吸氣'), 'The button must show actual inhale mode while the key is held');
    assert.equal(await page.locator('#breath').evaluate(el=>el.classList.contains('active')),false,'Held input must not display exhaling during a gasp');
    await page.keyboard.up('Space');await advance(.2);
    assert.equal((await state()).breathPhase,'gasp','Real keyboard release cannot cancel forced inhalation');
    await page.locator('#reset').click();
    assert.equal(await page.locator('#breath').evaluate(el=>el.classList.contains('forced')),false,'Reset must clear forced UI state');
    await page.locator('#breath').focus();
    await page.keyboard.down('Space');
    await advance(1);
    const up = await state();
    assert(up.body.y < 6600, 'Exhale must move the object upward');
    assert(up.air < 1, 'Exhale must use air');
    await page.keyboard.up('Space');
    await advance(.1);
    const coast = await state();
    assert(coast.body.y < up.body.y && coast.body.vy < 0, 'Release must preserve upward inertia instead of forcing the object down');
    await advance(3);
    const down = await state();
    assert(down.body.vy > 0, 'Released breathing must eventually let the object drift downward');
    assert(down.air > up.air, 'Inhale must replenish air');

    const field = await page.evaluate(() => {
      const bend = flowTest.velocityAt(280, 5780, 1, 1);
      const reversed = flowTest.velocityAt(280, 5780, 1, -.2);
      let backflow = false;
      for (let y=6370;y<6700;y+=20) for(let x=410;x<565;x+=15) {
        if (!flowTest.inSolid(x,y) && flowTest.velocityAt(x,y,3,1).y>40) backflow=true;
      }
      return { bend, reversed, backflow };
    });
    assert(Math.abs(field.bend.x)>70, 'The field must bend laterally around obstacles');
    assert(field.bend.x*field.reversed.x + field.bend.y*field.reversed.y < 0, 'Inhale must reverse the same field');
    assert(field.backflow, 'Exhale must still contain a local recirculating region');

    await reset();
    await page.keyboard.down('Space');
    await advance(1);
    await page.keyboard.up('Space');
    await advance(50);
    const fallen = await state();
    assert(fallen.failed && fallen.failureReason==='fell', 'Dropping back to the pulmonary floor must fail');
    const stoppedTime = fallen.elapsed;
    await advance(2);
    assert.equal((await state()).elapsed, stoppedTime, 'Failure must stop the simulation');
    await page.locator('#again').click();

    const organs = await page.evaluate(() => {
      const vocal=flowTest.obstacles.find(o=>o.kind==='gate'),c=flowTest.center(vocal.y);
      const closed=flowTest.vocalShapes(vocal,4.275),open=flowTest.vocalShapes(vocal,1.425);
      const nasal=flowTest.obstacles.filter(o=>o.material==='turbinate');
      const nosePassages=nasal.every(o=>{
        const [a,b]=flowTest.openings(o),x=(a+b)/2;
        return !flowTest.inSolid(x,o.y)&&!flowTest.inSolid(2*flowTest.center(o.y)-x,o.y);
      });
      flowTest.seedBody({x:c,y:vocal.y+50,vx:0,vy:-240});flowTest.input(true);flowTest.advance(.12);
      const vocalContact=flowTest.state.collisions>0&&flowTest.state.body.y>vocal.y;
      const y=3110,x=flowTest.bounds(y)[1]-flowTest.radius-3;
      flowTest.seedBody({x,y,vx:180,vy:100});
      let entered=false,valid=true;
      for(let i=0;i<200&&!flowTest.state.failed;i++) {
        flowTest.advance(.05);const b=flowTest.state.body;
        entered ||= b.x>flowTest.bounds(b.y)[1]&&flowTest.inEsophagus(b.x,b.y);
        valid &&= flowTest.inAirway(b.x,b.y);
      }
      return {folds:closed.length,closedGap:closed[1][3].x-closed[0][3].x,
        openGap:open[1][3].x-open[0][3].x,vocalContact,nosePassages,entered,valid,swallowed:flowTest.state,
        foodFlow:flowTest.velocityAt(580,3400,1,1)};
    });
    assert.equal(organs.folds,2, 'The larynx must have two collidable vocal folds');
    assert(organs.closedGap<32 && organs.openGap>100 && organs.vocalContact, 'Closed vocal folds must block while opening creates a traversable glottis');
    assert(organs.nosePassages, 'Both nasal passages must remain open beside the curled conchae');
    assert(organs.entered&&organs.valid, 'Momentum must carry an object from the main airway through the actual esophageal opening');
    assert(organs.swallowed.failed&&organs.swallowed.failureReason==='esophagus', 'Swallowing must fail after progressing down the esophageal branch');
    assert((await page.locator('#area').textContent()).includes('食道'), 'The esophageal branch must identify its own organ in the HUD');
    assert.deepEqual(organs.foodFlow,{x:0,y:0}, 'Respiratory flow must not drive the food passage');
    await page.locator('#again').click();
    assert.equal((await state()).failureReason,'', 'Retry must clear esophageal failure');
    assert.equal((await state()).failed, false, 'Retry must clear failure');

    const constantBlow = await page.evaluate(() => {
      flowTest.reset();flowTest.input(true);flowTest.advance(45);return flowTest.state;
    });
    assert(!constantBlow.won&&constantBlow.gasps>=4, 'Holding exhale continuously must force repeated gasps and cannot traverse the breath-timed valves');
    const pricks=await page.evaluate(()=>{
      flowTest.seedBody({x:320,y:5000});flowTest.prick();flowTest.prick();const cooldown=flowTest.state;
      flowTest.advance(.91);flowTest.prick();flowTest.advance(.91);flowTest.prick();
      return {cooldown,failed:flowTest.state};
    });
    assert.equal(pricks.cooldown.injuries,1,'Multiple fishbone contacts during cooldown must count once');
    assert(pricks.failed.failed&&pricks.failed.failureReason==='irritation'&&pricks.failed.injuries===3,'Three fishbone injuries must still fail');
    await page.locator('#again').click();

    const routes = await page.evaluate(() => {
      function run(safe) {
        flowTest.reset();
        let refill=false, valid=true, visited=new Set(), partitionValid=true, firstInjury=null,outlineValid=true,maxOmega=0;
        for(let i=0;i<3600&&!flowTest.state.won&&!flowTest.state.failed;i++) {
          const s=flowTest.state,o=flowTest.obstacles.find(o=>s.body.y>=o.y-80);
          if(s.air<.2)refill=true;if(s.air>.85)refill=false;
          let blow=!refill;
          if(o&&s.body.y<o.y+320&&!refill) {
            if(s.body.y<o.y-50)blow=true;
            else if(o.kind==='gate')blow=flowTest.gateGap()>60||s.body.y>o.y+160;
            else if(o.kind==='valve') {
              if(s.elapsed<o.openUntil)blow=true;
              else if(!s.held&&s.inhaleTime>=(o.window[0]+o.window[1])/2)blow=true;
              else blow=s.held?s.body.y>o.y+100:false;
            } else if(o.material==='fishbone'&&safe)blow=(i%10)<8;
          }
          flowTest.input(blow);flowTest.advance(.05);
          const after=flowTest.state,[l,r]=flowTest.bounds(after.body.y);
          valid &&= Number.isFinite(after.body.x) && after.body.x>l && after.body.x<r;
          maxOmega=Math.max(maxOmega,Math.abs(after.body.omega));
          const shape=flowTest.bodyPoints();
          for(let j=0;j<shape.length;j++) {
            const a=shape[j],b=shape[(j+1)%shape.length];
            for(const t of [0,.25,.5,.75])if(flowTest.inSolid(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t))outlineValid=false;
          }
          visited.add(after.region);
          for(const structure of flowTest.structures) {
            const points=structure.points;let inside=false;
            for(let j=0,k=points.length-1;j<points.length;k=j++) {
              const a=points[k],b=points[j];
              if((a.y>after.body.y)!==(b.y>after.body.y)&&after.body.x<(b.x-a.x)*(after.body.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
            }
            if(inside)partitionValid=false;
          }
          if(!firstInjury&&after.injuries) {
            firstInjury={injuries:after.injuries,irritation:after.irritation};
            flowTest.advance(.08);
            firstInjury.afterCooldownStep=flowTest.state.injuries;
          }
        }
        return {state:flowTest.state,valid,partitionValid,outlineValid,maxOmega,visited:[...visited],firstInjury};
      }
      const aggressive=run(false), safe=run(true);
      return {aggressive,safe,count:flowTest.obstacles.length,height:flowTest.height,view:flowTest.view};
    });
    assert(routes.aggressive.state.won||routes.aggressive.state.failed,'A faster route must still resolve to a playable outcome');
    assert.equal(routes.aggressive.firstInjury.injuries, routes.aggressive.firstInjury.afterCooldownStep, 'A single contact must not damage every physics frame');
    const victory=routes.safe.state;
    assert(victory.won&&!victory.failed, `A careful breathing route must win: ${JSON.stringify(victory)}`);
    assert(victory.irritation<100 && victory.cleared.length===routes.count, 'Victory must cross every obstacle while surviving');
    assert(routes.safe.valid && routes.safe.partitionValid, 'The object must remain inside airways and outside organ partitions');
    assert(routes.safe.outlineValid&&routes.safe.maxOmega>1,'The full rotating outline must remain outside walls, fishbones and organ solids throughout the route');
    assert.deepEqual(routes.safe.visited,[0,1,2,3]);
    assert(routes.height>routes.view*7);
    assert.equal(victory.region,3);
    assert(victory.camera<10);
    assert.equal(await page.locator('#win').isVisible(), true);
    assert.equal(await page.locator('#progress').textContent(), '100');
    await page.locator('#again').click();
    assert.equal((await state()).won, false);
    assert.equal((await state()).failed, false);
    assert.equal((await state()).irritation, 0);
    assert.equal((await state()).running, false);

    await page.locator('#breath').hover();
    await page.mouse.down();
    assert.equal((await state()).held, true);
    await page.mouse.move(10, 10);
    await page.mouse.up();
    assert.equal((await state()).held, false, 'Release outside the button must end exhale');
    await page.keyboard.down('Space');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal((await state()).held, false, 'Window blur must release held input');
    await page.keyboard.up('Space');
    await page.locator('#reset').click();
    assert.equal((await state()).body.y, 6600);

    const cornerRebound=await page.evaluate(()=>{
      const plane=[{x:200,y:4900},{x:440,y:4900},{x:440,y:4990},{x:200,y:4990}];
      flowTest.seedBody({x:320,y:4995,vy:-180,angle:-.8,omega:0});
      const before=flowTest.state.body;
      flowTest.collidePolygon(plane,.3,.22);
      const after=flowTest.state.body,energy=b=>(b.vx**2+b.vy**2+flowTest.inertia*b.omega**2)/2;
      return {before,after,energyBefore:energy(before),energyAfter:energy(after)};
    });
    assert(cornerRebound.after.reboundTime>0&&cornerRebound.after.vy<10&&Math.abs(cornerRebound.after.omega)>1&&cornerRebound.energyAfter<=cornerRebound.energyBefore+1e-6,`A strong off-center roof impact must arm the rebound interval even when energy becomes rotation instead of center-of-mass retreat: ${JSON.stringify(cornerRebound)}`);

    const valveCorner=await page.evaluate(()=>{
      flowTest.seedDuo([{x:333.1339263107636,y:3172.7271530083053,angle:30.582442249391917,size:.62,mass:.25},{x:320,y:5000}]);
      const rect={x:148.72997517430548,y:3140,w:173.78412012171088,h:40};
      let hit=false;for(let i=0;i<5;i++)hit=flowTest.collideRect(rect)||hit;
      const clear=flowTest.bodyPoints(flowTest.state.bodies[0]).every(p=>p.x<rect.x||p.x>rect.x+rect.w||p.y<rect.y||p.y>rect.y+rect.h);
      return {hit,clear};
    });
    assert(valveCorner.hit&&valveCorner.clear,'The small rotated outline must resolve an actual membrane corner overlap');
    const separatedCamera=await page.evaluate(()=>{
      flowTest.startDuo();const lower=flowTest.state.bodies[0];
      flowTest.seedDuo([lower,{x:flowTest.center(3000),y:3000}]);flowTest.advance(2);
      const s=flowTest.state;
      return {failed:s.failed,camera:s.camera,view:s.viewHeight,bodies:s.bodies,visible:s.bodies.every(b=>flowTest.bodyPoints(b).every(p=>p.y>s.camera&&p.y<s.camera+s.viewHeight))};
    });
    assert(!separatedCamera.failed&&separatedCamera.visible,`The camera must contain both full outlines when they are widely separated: ${JSON.stringify(separatedCamera)}`);
    const sharedContact=await page.evaluate(()=>{
      const neck=flowTest.obstacles.find(o=>o.id==='neck'),x=flowTest.center(neck.y)-12;
      flowTest.seedDuo([{x,y:neck.y+104},{x,y:neck.y+140}]);flowTest.input(true);
      let clear=true;
      for(let i=0;i<240;i++){flowTest.advance(1/120);for(const b of flowTest.state.bodies)for(const p of flowTest.bodyPoints(b))if(flowTest.inSolid(p.x,p.y))clear=false;}
      return {contacts:flowTest.state.pairContacts,clear,failed:flowTest.state.failed};
    });
    assert(sharedContact.contacts>0&&sharedContact.clear&&!sharedContact.failed,'The full-map neck must produce actual mutual contacts without tissue penetration');
    const falling=await page.evaluate(()=>[ [1,1],[.62,.25] ].map(([size,mass])=>{
      const b={x:320,y:5000,vx:0,vy:0,angle:.4,omega:0,size,mass};
      for(let i=0;i<240;i++)flowTest.integrateBody(b,{x:0,y:0},1/120);
      return b;
    }));
    assert(falling.every(b=>b.y>5130&&b.vy>120&&b.angle===.4),'Zero airflow must accelerate both sizes into a noticeable fall without an orientation force');
    const duoChecks=await page.evaluate(()=>{
      const input=value=>window.dispatchEvent(new KeyboardEvent(value?'keydown':'keyup',{code:'Space'}));
      flowTest.startDuo();input(true);flowTest.advance(60);const heldLong=flowTest.state;
      flowTest.startDuo();let refill=false,clearance=true,maxOverlap=0,firstEscape=null,visible=true,firstBad=null,firstContact=null,firstTurn=null,turnEffect=null,contactView=null;
      const visited=[new Set(),new Set()],crossed=[new Set(),new Set()];
      for(let i=0;i<6000&&!flowTest.state.won&&!flowTest.state.failed;i++) {
        const s=flowTest.state,lead=s.bodies.filter(b=>!b.escaped).sort((a,b)=>a.y-b.y)[0]||s.body;
        const o=flowTest.obstacles.find(o=>lead.y>=o.y-80);
        if(s.air<.2)refill=true;if(s.air>.85)refill=false;
        let blow=!refill;
        if(o&&lead.y<o.y+320&&!refill) {
          if(lead.y<o.y-50)blow=true;
          else if(o.kind==='gate')blow=flowTest.gateGap()>60||lead.y>o.y+160;
          else if(o.kind==='valve')blow=s.elapsed<o.openUntil||(!s.held&&s.inhaleTime>=(o.window[0]+o.window[1])/2)||(s.held&&lead.y>o.y+100);
          else if(o.material==='fishbone')blow=(i%10)<4;
        }
        input(blow);flowTest.advance(.05);const after=flowTest.state;
        if(after.pairContacts>0&&firstContact===null)firstContact=after.elapsed;
        if(after.pairTurns>0&&firstTurn===null){firstTurn=after.elapsed;turnEffect=after.pairImpact;contactView=after.viewHeight;}
        for(const [index,b] of after.bodies.entries()) {
          visited[index].add(flowTest.regions.findIndex(r=>b.y>=r.top));
          for(const o of flowTest.obstacles)if(b.y<o.y-(o.kind==='neck'?145:80))crossed[index].add(o.id);
          if(b.escaped)continue;
          visible=visible&&b.y>after.camera&&b.y<after.camera+after.viewHeight;
          const pts=flowTest.bodyPoints(b);
          for(let j=0;j<pts.length;j++){const a=pts[j],b=pts[(j+1)%pts.length];for(const t of [0,.25,.5,.75])if(flowTest.inSolid(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t)){clearance=false;if(!firstBad)firstBad={elapsed:after.elapsed,index,body:after.bodies[index],phase:after.breathPhase,inhaleTime:after.inhaleTime,rects:flowTest.blocks(flowTest.obstacles.find(o=>o.id==='membrane')),point:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}};}}
        }
        if(!after.bodies.some(b=>b.escaped))maxOverlap=Math.max(maxOverlap,flowTest.pairManifold(...after.bodies)?.depth||0);
        if(after.bodies.filter(b=>b.escaped).length===1&&!firstEscape)firstEscape=after;
      }
      const victory=flowTest.state;
      const a={x:300,y:600,vx:120,vy:20,omega:.4,angle:.35,size:1,mass:1};
      const b={x:330,y:607,vx:-50,vy:-10,omega:-.2,angle:-.4,size:.62,mass:.25};
      const energy=()=>[a,b].reduce((sum,b)=>sum+b.mass*(b.vx**2+b.vy**2+flowTest.bodyInertia(b)*b.omega**2)/2,0);
      const momentum=()=>[a.vx*a.mass+b.vx*b.mass,a.vy*a.mass+b.vy*b.mass];
      const before={energy:energy(),momentum:momentum()},hit=flowTest.collidePair(a,b),after={energy:energy(),momentum:momentum()};
      return {heldLong,victory,clearance,maxOverlap,firstEscape,visible,firstBad,firstContact,firstTurn,turnEffect,contactView,visited:visited.map(v=>[...v].sort()),crossed:crossed.map(v=>[...v]),hit,before,after,a,b};
    });
    assert(!duoChecks.heldLong.won,'Constant exhale must not bypass the restored breath-timed valves');
    assert(duoChecks.victory.won&&!duoChecks.victory.failed&&duoChecks.victory.bodies.every(b=>b.escaped),'A keyboard-only breathing route must free both bodies through the full map');
    assert(duoChecks.clearance&&duoChecks.maxOverlap<.05,`Both outlines must clear the organ solids and one another: ${JSON.stringify({clear:duoChecks.clearance,overlap:duoChecks.maxOverlap,firstBad:duoChecks.firstBad})}`);
    assert(duoChecks.firstContact!==null&&duoChecks.firstTurn!==null&&duoChecks.firstContact<10&&duoChecks.firstTurn<15,'Natural keyboard play must produce an early mutual contact and collision torque before the trachea');
    assert(duoChecks.contactView<760,'The camera must show nearby colliding bodies at a readable scale');
    assert(duoChecks.turnEffect?.turning&&duoChecks.turnEffect.turns.some(t=>Math.abs(t.spin)>.5),'Turning feedback must correspond to an actual collision impulse changing angular velocity');
    assert.equal(await page.locator('#progress').textContent(),'2 / 2');
    assert(duoChecks.visible,'The following camera must keep both active bodies in view');
    assert(duoChecks.crossed.every(ids=>ids.length===12)&&duoChecks.visited.every(v=>JSON.stringify(v)==='[0,1,2,3]'),'Both bodies must traverse four organs and twelve obstacles');
    assert(duoChecks.firstEscape&&!duoChecks.firstEscape.won,'One escaped object must not finish the level');
    const escapedIndex=duoChecks.firstEscape.bodies.findIndex(b=>b.escaped);
    assert.deepEqual(duoChecks.victory.bodies[escapedIndex],duoChecks.firstEscape.bodies[escapedIndex],'An escaped body must stay fixed while its partner continues');
    assert(duoChecks.hit&&duoChecks.after.energy<=duoChecks.before.energy+1e-6,'Mass-aware contact must dissipate energy');
    for(let i=0;i<2;i++)assert(Math.abs(duoChecks.before.momentum[i]-duoChecks.after.momentum[i])<1e-7,'Body contacts must conserve linear momentum');
    assert(Math.abs(duoChecks.a.omega-.4)>.1&&Math.abs(duoChecks.b.omega+.2)>.1,'An off-center mutual contact must rotate the bodies');
    await page.locator('#again').click();
    assert((await state()).duoMode&&(await state()).bodies.length===2&&!(await state()).running,'Retry must preserve both bodies and the full map');
    const quietContact=await page.evaluate(()=>{
      flowTest.startDuo();
      const a={x:300,y:600,vx:0,vy:0,omega:0,angle:0,size:1,mass:1},b={x:330,y:600,vx:0,vy:0,omega:0,angle:0,size:.62,mass:.25};
      const hit=flowTest.collidePair(a,b);return {hit,a,b,effect:flowTest.state.pairImpact,turns:flowTest.state.pairTurns};
    });
    assert(quietContact.hit&&!quietContact.effect&&quietContact.turns===0&&quietContact.a.omega===0&&quietContact.b.omega===0,'A stationary overlap must separate without invented torque or impact feedback');
    const restored=await page.evaluate(()=>{
      const results=[];
      for(const index of [0,1]) {
        const states=[{x:320,y:5000},{x:320,y:5100}];states[index]={x:600,y:3490,vy:180};
        flowTest.seedDuo(states);flowTest.advance(.8);results.push(flowTest.state.failureReason);
      }
      const valve=flowTest.obstacles.find(o=>o.id==='membrane');
      flowTest.seedDuo([{x:flowTest.center(valve.y),y:valve.y+100},{x:320,y:5000}]);
      flowTest.input(true);flowTest.advance(.05);flowTest.input(false);flowTest.advance(.45);flowTest.input(true);flowTest.advance(.05);
      const opened=valve.openUntil>flowTest.state.elapsed;
      flowTest.seedDuo([{x:200,y:6884},{x:440,y:6500}]);flowTest.advance(4);
      return {food:results,opened,floor:flowTest.state};
    });
    assert(restored.food.every(r=>r==='esophagus'),'Either body entering the real esophagus must fail the pair');
    assert(restored.opened,'The leading body must open the restored membrane even if its partner is far below');
    assert(restored.floor.failed&&restored.floor.failureReason==='fell','Either body falling into the real lung floor must fail the pair');
    await page.locator('#duo').click();
    if(process.env.FLOW_SCREENSHOT)await page.screenshot({path:process.env.FLOW_SCREENSHOT.replace(/\.png$/,'-duo.png'),fullPage:true});
    await page.locator('#reset').click();
    assert(!(await state()).duoMode&&(await state()).body.y===6600,'Return to the single-body journey must clear the pair');

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const touch = await mobile.newPage();
    touch.on('pageerror', error => errors.push(error.message));
    await touch.goto(url);
    assert(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile must not overflow horizontally');
    const button = await touch.locator('#breath').boundingBox();
    assert(button.y + button.height <= 844, 'Mobile breath button must be visible');
    const cdp = await mobile.newCDPSession(touch);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: button.x + 40, y: button.y + 25 }] });
    assert(await touch.evaluate(() => flowTest.state.held), 'Real touch must start exhale');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await touch.evaluate(() => flowTest.state.held), false, 'Touch release must end exhale');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: button.x + 40, y: button.y + 25 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert.equal(await touch.evaluate(() => flowTest.state.held), false, 'Cancelled touch must release input');
    await touch.evaluate(()=>flowTest.seedBody({x:320,y:5000},.001));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: button.x + 40, y: button.y + 25 }] });
    await touch.evaluate(()=>flowTest.advance(.1));
    assert((await touch.locator('#button-label').textContent()).includes('強制深吸氣'),'Touch depletion must show forced inhalation');
    const forcedHint=await touch.locator('#hint').boundingBox(),forcedButton=await touch.locator('#breath').boundingBox();
    assert(forcedHint.y+forcedHint.height<=forcedButton.y&&forcedButton.y+forcedButton.height<=844,'The full forced-breath hint and touch button must stay visible');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await touch.evaluate(()=>flowTest.advance(.2));
    assert(await touch.evaluate(()=>!flowTest.state.held&&flowTest.state.breathPhase==='gasp'),'Cancelling touch must release input while preserving the compulsory breath');
    await touch.locator('#duo').click();
    assert((await touch.evaluate(()=>flowTest.state)).duoMode,'Mobile mode control must enter the two-body level');
    const duoButton=await touch.locator('#breath').boundingBox();
    assert(duoButton.y+duoButton.height<=844&&await touch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Two-body HUD and breath control must fit mobile');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:duoButton.x+40,y:duoButton.y+25}]});
    await touch.evaluate(()=>flowTest.advance(.5));
    assert(await touch.evaluate(()=>flowTest.state.bodies.every((b,i)=>b.y<(i===0?6600:6700))),'Touch exhale must drive both objects through the shared field');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    assert.equal(await touch.evaluate(()=>flowTest.state.held),false);
    await touch.locator('#duo').click();
    if(process.env.FLOW_SCREENSHOT)await touch.screenshot({path:process.env.FLOW_SCREENSHOT.replace(/\.png$/,'-duo-mobile.png'),fullPage:true});
    await touch.locator('#reset').click();
    await page.keyboard.down('Space');
    await page.waitForTimeout(450);
    await page.keyboard.up('Space');
    const traces=await page.evaluate(()=>flowTest.particleStats());
    assert(traces.filter(p=>p.trail>5).length>30, 'Particles must retain advected curved trails');
    assert(await page.evaluate(()=>flowTest.particleStats().every(p=>!flowTest.inSolid(p.x,p.y))), 'Particles must stay outside solid tissue and obstacles');
    await page.locator('#reset').click();
    assert.deepEqual(errors, [], 'No browser runtime errors');
    if (process.env.FLOW_SCREENSHOT) {
      await page.screenshot({ path: process.env.FLOW_SCREENSHOT, fullPage: true });
      await touch.screenshot({ path: process.env.FLOW_SCREENSHOT.replace(/\.png$/, '-mobile.png'), fullPage: true });
    }
    console.log(`PASS: off-center roof rebound grace and small-body membrane corner separation; faster zero-flow falling for both masses; full-map two-body keyboard victory (${duoChecks.victory.elapsed.toFixed(1)}s), four organs/twelve obstacles for both, early natural mutual contact/turning feedback, following camera, restored esophagus/membrane/floor hazards, contact mass/momentum/energy/torque, independent escape retention and mobile controls; constant-exhale neck wedging, inhale retreat/ramp torque/real slot clearance, practice victory/retry/full-level return, free-flight orientation/no inhale unlock, nonlinear refill/airflow, uninterruptible empty-air gasp/full recovery, gentle automatic breathing, forced keyboard/touch HUD and reset, irregular outline/angle-dependent clearance, contact torque/friction/energy bounds, elastic curved walls/low-speed settling, fast fishbone contact, paired vocal folds, bilateral concha passages, esophageal failure/retry, release inertia, flow/reversal/recirculation, pulmonary and three-prick failure/cooldown, four-organ victory (${victory.elapsed.toFixed(1)}s, ${victory.injuries} pricks / ${routes.count} obstacles) with full-outline clearance, particle trails/solids, keyboard/pointer/blur, mobile touch/cancel; no runtime errors.`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
