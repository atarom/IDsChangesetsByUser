'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'js/db-worker.js'), 'utf8');
const offset = value => Math.round((Date.parse(value + 'T00:00:00Z') - Date.UTC(2005,3,17)) / 86400000);
function workerHarness(rows = []) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  db.exec("INSERT INTO metadata VALUES ('sequenceNumber','1'),('dateEpoch','2005-04-17')");
  db.exec('CREATE TABLE whosthat(user_id INTEGER NOT NULL,user_name TEXT NOT NULL,date_first INTEGER NOT NULL,date_span INTEGER NOT NULL,PRIMARY KEY(user_id,user_name)) WITHOUT ROWID');
  const insert = db.prepare('INSERT INTO whosthat VALUES(?,?,?,?)');
  for (const [uid,name,first,last] of rows) insert.run(uid,name,offset(first),offset(last)-offset(first));
  const ctx = {TextEncoder,self:{},postMessage() {},console,Date,Map,Blob};
  vm.createContext(ctx);
  vm.runInContext(workerSource,ctx);
  const adapter = {prepare(sql) {const stmt=db.prepare(sql);let entries=[],index=0;return {bind(params){entries=stmt.all(...params).map(Object.values);index=0;},step(){return index < entries.length;},get(){return entries[index++];},free(){}};},exec(sql,params=[]){const stmt=db.prepare(sql);const rows=stmt.all(...params).map(Object.values);return rows.length?[{values:rows}]:[];}};
  ctx.adapter=adapter;
  vm.runInContext('localDB = adapter',ctx);
  const explore = options => {ctx.query=options;return JSON.parse(JSON.stringify(vm.runInContext('historyExplore(query)',ctx)));};
  const action = async options => {ctx.query=options;return JSON.parse(JSON.stringify(await vm.runInContext('handle(query)',ctx)));};
  const evalJs=expression=>vm.runInContext(expression,ctx);
  return {db,ctx,explore,action,evalJs};
}
const BASE = [[1,'Alba','2005-04-17','2005-04-18'],[1,'Alba2','2026-01-01','2026-04-01'],[2,'Jose','2024-02-29','2024-03-01'],[3,'Alba','2026-02-01','2026-06-01'],[3,'Alberto','2026-06-02','2026-06-05'],[4,'Ñandú 🧭','2026-07-01','2026-07-04']];
test('La fecha base corresponde al 17/04/2005',()=>{const h=workerHarness();assert.equal(h.evalJs('dateText(0)'),'2005-04-17');assert.equal(h.evalJs("dayOffset('2005-04-17')"),0);h.db.close();});
test('Las fechas bisiestas se convierten sin pérdida',()=>{const h=workerHarness();assert.equal(h.evalJs(`dateText(${offset('2024-02-29')})`),'2024-02-29');h.db.close();});
test('Fechas inválidas son rechazadas',()=>{const h=workerHarness();for(const d of ['2026-02-30','2026-13-10','hoy']){h.ctx.day=d;assert.throws(()=>h.evalJs('dayOffset(day)'),/Fecha incorrecta/);}h.db.close();});
test('Nombres históricos reconstruyen primera y última observación',()=>{const h=workerHarness(BASE);const rows=h.explore({mode:'user',uid:1}).rows;assert.deepEqual(rows,[{name:'Alba',first:'2005-04-17',last:'2005-04-18'},{name:'Alba2',first:'2026-01-01',last:'2026-04-01'}]);h.db.close();});
test('La búsqueda exacta ignora diferencias de mayúsculas',()=>{const h=workerHarness(BASE);assert.equal(h.explore({mode:'names',match:'exact',name:'ALBA'}).rows.length,2);h.db.close();});
test('La búsqueda por prefijo devuelve todos los nombres',()=>{const h=workerHarness(BASE);assert.equal(h.explore({mode:'names',match:'starts',name:'Alb'}).rows.length,4);h.db.close();});
test('La búsqueda de fragmentos permite Unicode',()=>{const h=workerHarness(BASE);assert.equal(h.explore({mode:'names',match:'contains',name:'🧭'}).rows.length,1);h.db.close();});
test('Filtrar nombres por UID conserva la identidad',()=>{const h=workerHarness(BASE);assert.deepEqual(h.explore({mode:'names',match:'starts',name:'Alb',uid:3}).rows.map(x=>x.uid),[3,3]);h.db.close();});
test('Regex con UID usa las fechas reconstruidas',()=>{const h=workerHarness(BASE);const rows=h.explore({mode:'names',match:'regex',name:'^Alba',uid:1}).rows;assert.equal(rows[1].last,'2026-04-01');h.db.close();});
test('Regex recorre una tabla WITHOUT ROWID por páginas sin repeticiones',()=>{const rows=Array.from({length:253},(_,i)=>[i+1,'Nombre  '+(i+1),'2026-01-01','2026-10-01']);const h=workerHarness(rows);let cursor=0,all=[],page=0;while(true){const result=h.explore({mode:'names',match:'regex',name:'^Nombre  +[0-9]+$',cursor});all.push(...result.rows);page++;if(!result.more)break;cursor=result.nextCursor;assert.ok(page<10);}assert.equal(all.length,253);assert.equal(new Set(all.map(x=>x.uid+x.name)).size,253);assert.equal(page,3);h.db.close();});
test('La paginación normal no duplica registros',()=>{const rows=Array.from({length:205},(_,i)=>[i+1,'Nombre','2026-01-01','2026-10-01']);const h=workerHarness(rows);const a=h.explore({mode:'names',match:'exact',name:'Nombre',page:0});const b=h.explore({mode:'names',match:'exact',name:'Nombre',page:1});const c=h.explore({mode:'names',match:'exact',name:'Nombre',page:2});assert.equal(a.rows.length,100);assert.equal(b.rows.length,100);assert.equal(c.rows.length,5);assert.equal(a.more,true);assert.equal(c.more,false);h.db.close();});
test('Consulta por primera observación utiliza desplazamientos',()=>{const h=workerHarness(BASE);const rows=h.explore({mode:'dates',dateMode:'first',from:'2026-01-01',to:'2026-01-01'}).rows;assert.equal(rows.length,1);assert.equal(rows[0].name,'Alba2');h.db.close();});
test('Consulta por última observación utiliza inicio más duración',()=>{const h=workerHarness(BASE);const rows=h.explore({mode:'dates',dateMode:'last',from:'2026-04-01',to:'2026-04-01'}).rows;assert.equal(rows.length,1);assert.equal(rows[0].name,'Alba2');h.db.close();});
test('Consulta por intervalo solapado conserva extremos',()=>{const h=workerHarness(BASE);assert.equal(h.explore({mode:'dates',dateMode:'overlap',from:'2026-03-30',to:'2026-04-01'}).rows.length,2);h.db.close();});
test('Ranking devuelve última fecha real',()=>{const h=workerHarness(BASE);const rows=h.explore({mode:'ranking',min:2}).rows;assert.equal(rows.length,2);assert.equal(rows[0].uid,1);assert.equal(rows[0].last,'2026-04-01');assert.equal(rows[1].uid,3);assert.equal(rows[1].last,'2026-06-05');h.db.close();});
test('Localizar posición respeta el desempate por UID',()=>{const h=workerHarness(BASE);assert.equal(h.explore({mode:'position',uid:1,min:2}).position,1);assert.equal(h.explore({mode:'position',uid:3,min:2}).position,2);h.db.close();});
test('Ranking con mínimo mayor no inventa resultados',()=>{const h=workerHarness(BASE);assert.equal(h.explore({mode:'ranking',min:3}).rows.length,0);h.db.close();});
test('El UID incorrecto es rechazado',()=>{const h=workerHarness(BASE);assert.throws(()=>h.explore({mode:'user',uid:0}),/UID incorrecto/);h.db.close();});
test('El rango de fechas invertido es rechazado',()=>{const h=workerHarness(BASE);assert.throws(()=>h.explore({mode:'dates',dateMode:'first',from:'2026-04-01',to:'2026-01-01'}),/posterior/);h.db.close();});
test('Un patrón regex incorrecto es rechazado',()=>{const h=workerHarness(BASE);assert.throws(()=>h.explore({mode:'names',match:'regex',name:'['}),/Regex no válida/);h.db.close();});
test('El manifiesto con época de fechas incorrecta se rechaza',()=>{const h=workerHarness(BASE);h.ctx.manifest={format:'WTHDB01',dateEpoch:'2005-04-18',sha256:'a'.repeat(64),sequenceNumber:1,records:6,sqliteBytes:10,encryptedBytes:20};assert.throws(()=>h.evalJs('checkManifest(manifest)'),/formato exclusivo/);h.db.close();});
test('El manifiesto del formato actual se acepta',()=>{const h=workerHarness(BASE);h.ctx.manifest={format:'WTHDB01',dateEpoch:'2005-04-17',sha256:'a'.repeat(64),sequenceNumber:1,records:6,sqliteBytes:10,encryptedBytes:20};assert.equal(h.evalJs('checkManifest(manifest).dateEpoch'),'2005-04-17');h.db.close();});
test('Lookup devuelve fechas de la nueva estructura',async()=>{const h=workerHarness(BASE);assert.equal((await h.action({action:'lookup',uid:2}))[0].first,'2024-02-29');h.db.close();});
test('Lookup rechaza UID inválido',async()=>{const h=workerHarness(BASE);await assert.rejects(h.action({action:'lookup',uid:-1}),/UID incorrecto/);h.db.close();});
test('Acciones desconocidas son rechazadas',async()=>{const h=workerHarness(BASE);await assert.rejects(h.action({action:'unknown'}),/Acción desconocida/);h.db.close();});
test('Resultados con nombres vacíos se excluyen de exploración',()=>{const h=workerHarness([[10,'','2026-01-01','2026-01-01'],...BASE]);assert.equal(h.explore({mode:'ranking',min:1}).rows.length,4);h.db.close();});
test('La base conserva distinción entre nombres con distinto uso de mayúsculas',()=>{const h=workerHarness([[9,'case','2026-01-01','2026-01-01'],[9,'CASE','2026-01-02','2026-01-02']]);assert.equal(h.explore({mode:'user',uid:9}).rows.length,2);h.db.close();});
test('La búsqueda por UID filtra correctamente sin nombre',()=>{const h=workerHarness(BASE);assert.equal(h.explore({mode:'names',uid:1}).rows.length,2);h.db.close();});
const appFile = path.join(root,'js/app.js');
const appSource = fs.existsSync(appFile) ? fs.readFileSync(appFile,'utf8') : null;
const extract = name => {const line=appSource.split('\n').find(value=>value.startsWith('const '+name+' = '));assert.ok(line,'Falta '+name);return line;};
const attributes = text => {const result={};for(const match of text.matchAll(/([a-z_]+)="([^"]*)"/g))result[match[1]]=match[2];return result;};
class FakeElement {
  constructor(attrs,children={}){this.attrs=attrs;this.children=children;}
  getAttribute(name){return this.attrs[name]??null;}
  getElementsByTagName(name){return this.children[name]||[];}
}
class FakeParser {
  parseFromString(text){
    if(!/^<osm(?:\s[^>]*)?>[\s\S]*<\/osm>$/.test(text))return {documentElement:{tagName:'parsererror'},getElementsByTagName:name=>name==='parsererror'?[{}]:[]};
    const changesets=[...text.matchAll(/<changeset\s([^>]*?)\s*\/>/g)].map(match=>new FakeElement(attributes(match[1])));
    const found=/<user\s([^>]+)>/.exec(text);
    const user=found?[new FakeElement(attributes(found[1]),{changesets:[new FakeElement({count:'500'})],traces:[new FakeElement({count:'0'})],blocks:[new FakeElement({},{received:[new FakeElement({count:'0',active:'0'})]})]})]:[];
    const errors=[...text.matchAll(/<error(?:\s[^>]*)?>([\s\S]*?)<\/error>|<error(?:\s[^>]*)?\s*\/>/g)].map(match=>({textContent:match[1]||''}));
    return {documentElement:{tagName:'osm'},getElementsByTagName:name=>name==='changeset'?changesets:name==='user'?user:name==='error'?errors:[]};
  }
}
const changeset=(id,options={})=>{const uid=options.uid===undefined?'8278438':options.uid,count=options.count===undefined?'1':options.count,date=options.date===undefined?'2026-11-05T12:00:00Z':options.date;const attributes=[`id="${id}"`,uid===null?'':`uid="${uid}"`,count===null?'':`changes_count="${count}"`,date===null?'':`created_at="${date}"`,'user="Jordi MF"'];if(options.bbox!==false)attributes.push('min_lat="41" min_lon="2" max_lat="42" max_lon="3"');return '<changeset '+attributes.filter(Boolean).join(' ')+'/>';};
const osm=elements=>'<osm version="0.6">'+elements.join('')+'</osm>';
const userXml=uid=>'<osm><user id="'+uid+'" display_name="Jordi MF"><changesets count="500"/></user></osm>';
const response=(text,status=200)=>({ok:status===200,status,text:async()=>text});
function appHarness(pages,options={}) {
  const dom=new Map();
  const $=id=>{if(!dom.has(id))dom.set(id,{value:'',textContent:'',hidden:false,style:{color:''},classList:{add(){},remove(){},toggle(){}},onclick:null});return dom.get(id);};
  const ctx={$,AbortController,DOMParser:FakeParser,encodeURIComponent,Date,Number,Map,Set,Error,RegExp,console,setTimeout:cb=>setTimeout(cb,0),clearTimeout,window:{WhoDB:{ready:false}},activeRun:0,loadController:null,resultsReady:false,order:[],records:new Map(),pending:[],errs:[],unlocatedIds:[],worldExtent:[Infinity,Infinity,-Infinity,-Infinity],sel:new Set(),closed:false,lassoBounds:null,exported:0,currentUserUid:null,lastError:'',doneText:'',ov:{hidden:true},frozen:false};
  ctx.ol={Feature:class{constructor(value){this.geometry=value.geometry;}set(){}},geom:{Point:class{},Polygon:class{}},proj:{fromLonLat:point=>point,transformExtent:box=>box},extent:{extend:(extent,box)=>{extent[0]=Math.min(extent[0],box[0]);extent[1]=Math.min(extent[1],box[1]);extent[2]=Math.max(extent[2],box[2]);extent[3]=Math.max(extent[3],box[3]);}}};
  ctx.clear=()=>{ctx.activeRun++;ctx.loadController?.abort();ctx.loadController=null;ctx.order=[];ctx.records.clear();ctx.pending=[];ctx.unlocatedIds=[];ctx.errs=[];ctx.$('ids').value='';ctx.$('selectedIds').value='';ctx.$('errorLog').value='';ctx.$('finishMessage').textContent='';ctx.$('finishMessage').hidden=true;ctx.ov.hidden=true;};
  ctx.openOv=()=>{ctx.ov.hidden=false;};
  ctx.msg=()=>{};
  ctx.err=text=>{ctx.lastError=text;ctx.ov.hidden=false;ctx.frozen=true;};
  ctx.flushMap=()=>{ctx.pending=[];};
  ctx.renderList=()=>{};
  ctx.summary=()=>{};
  ctx.syncMapSelection=()=>{};
  ctx.publishIds=()=>{ctx.$('ids').value=ctx.order.join(',');ctx.exported=ctx.order.length;};
  ctx.done=text=>{ctx.doneText=text;ctx.publishIds();ctx.$('finishMessage').textContent=text;ctx.$('finishMessage').hidden=false;};
  ctx.alert=text=>{throw Error(text);};
  let index=0;
  ctx.fetch=async(url,settings)=>{
    if(url.includes('/api/0.6/user/'))return response(options.userBody||userXml(options.userUid||'8278438'));
    if(url.includes('display_name='))return response(options.nameBody||osm([changeset('400')]));
    const item=pages[index++];
    if(item==='pending')return new Promise((resolve,reject)=>{settings.signal.addEventListener('abort',()=>reject(Error('Cancelada')),{once:true});});
    if(item==='http503')return response('Servidor no disponible',503);
    return response(item===undefined?osm([]):item);
  };
  vm.createContext(ctx);
  for(const name of ['xml','validOSMId','verifyUID','verifyChangesetBatch','req','addCS','user','loadCS','failLoad','startLoad'])vm.runInContext(extract(name),ctx);
  vm.runInContext(appSource.split('\n').find(line=>line.startsWith("$('ovX').onclick =")),ctx);
  $('userUID').value=options.uid||'8278438';
  $('maxChangesets').value=String(options.limit||200);
  return {ctx,$,load:()=>vm.runInContext('startLoad()',ctx),calls:()=>index};
}
test('Los IDs no son exportables antes de completar la carga',{skip:!appSource},()=>{const dom={ids:{value:''},selectedIds:{value:''}},ctx={$:id=>dom[id],order:['101','102'],exported:0,resultsReady:false,sel:new Set(['101']),selectionTextTimer:null,clearTimeout,String};vm.createContext(ctx);for(const name of ['publishIds','writeSelected'])vm.runInContext(extract(name),ctx);vm.runInContext('publishIds();writeSelected()',ctx);assert.equal(dom.ids.value,'');assert.equal(dom.selectedIds.value,'');ctx.resultsReady=true;vm.runInContext('publishIds();writeSelected()',ctx);assert.equal(dom.ids.value,'101,102');assert.equal(dom.selectedIds.value,'101');});
test('Un lote válido incorpora changesets con geometría y sin bbox',{skip:!appSource},async()=>{const h=appHarness([osm([changeset('101'),changeset('102',{bbox:false}),changeset('103',{count:0,bbox:false})])]);await h.load();assert.deepEqual(Array.from(h.ctx.order),['101','102']);assert.deepEqual(Array.from(h.ctx.unlocatedIds),['102']);assert.match(h.$('ids').value,/101,102/);});
test('XML malformado después de un lote válido descarta todos los IDs',{skip:!appSource},async()=>{const h=appHarness([osm(Array.from({length:100},(_,i)=>changeset(i+100))),'<osm><changeset'],{limit:200});await h.load();assert.equal(h.ctx.order.length,0);assert.equal(h.$('ids').value,'');});
test('El error XML del segundo lote descarta los cambios completos',{skip:!appSource},async()=>{const h=appHarness([osm(Array.from({length:100},(_,i)=>changeset(i+100))),osm(['<error>Timeout OSM</error>'])],{limit:200});await h.load();assert.equal(h.ctx.order.length,0);assert.match(h.$('errorLog').value,/Timeout OSM/);});
test('El error XML vacío también se rechaza',{skip:!appSource},async()=>{const h=appHarness([osm(['<error/>'])]);await h.load();assert.equal(h.ctx.order.length,0);assert.match(h.$('errorLog').value,/error de OSM/i);});
test('El error en la ficha de usuario detiene la carga',{skip:!appSource},async()=>{const h=appHarness([osm([changeset('101')])],{userBody:osm(['<error>Ficha no disponible</error>'])});await h.load();assert.equal(h.ctx.order.length,0);assert.match(h.$('errorLog').value,/Ficha no disponible/);});
test('El error al resolver un nombre detiene la carga',{skip:!appSource},async()=>{const h=appHarness([osm([changeset('101')])],{nameBody:osm(['<error>Usuario no disponible</error>'])});h.$('userUID').value='';h.$('userName').value='Jordi MF';await h.load();assert.equal(h.ctx.order.length,0);assert.match(h.$('errorLog').value,/Usuario no disponible/);});
test('Error HTTP después de un lote válido no deja selección',{skip:!appSource},async()=>{const h=appHarness([osm(Array.from({length:100},(_,i)=>changeset(i+100))),'http503']);await h.load();assert.equal(h.ctx.order.length,0);assert.equal(h.$('ids').value,'');});
test('Paginación bloqueada no entrega resultados parciales',{skip:!appSource},async()=>{const batch=osm(Array.from({length:100},(_,i)=>changeset(i+100)));const h=appHarness([batch,batch]);await h.load();assert.equal(h.ctx.order.length,0);assert.equal(h.$('ids').value,'');});
test('Integridad de UID incorrecta descarta la carga',{skip:!appSource},async()=>{const h=appHarness([osm(Array.from({length:100},(_,i)=>changeset(i+100))),osm([changeset('200',{uid:'99'})])]);await h.load();assert.equal(h.ctx.order.length,0);assert.match(h.$('errorLog').value,/UID recibido 99/);});
test('Fecha y recuento incorrectos descartan la carga',{skip:!appSource},async()=>{for(const options of [{date:null},{count:null},{date:'falsa'},{count:'-1'}]){const h=appHarness([osm([changeset('101',options)])]);await h.load();assert.equal(h.ctx.order.length,0);assert.match(h.$('errorLog').value,/ALERTA DE INTEGRIDAD/);}});
test('Resolver por nombre conserva el UID verificado',{skip:!appSource},async()=>{const h=appHarness([osm([changeset('101')])]);h.$('userUID').value='';h.$('userName').value='Jordi MF';await h.load();assert.equal(h.$('userUID').value,'8278438');assert.deepEqual(Array.from(h.ctx.order),['101']);});
test('Un UID discordante en la ficha bloquea la consulta',{skip:!appSource},async()=>{const h=appHarness([osm([changeset('101')])],{userUid:'9'});await h.load();assert.equal(h.ctx.order.length,0);assert.match(h.$('errorLog').value,/Ficha del usuario/);});
