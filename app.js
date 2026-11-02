/* テンシ ポータル。Supabase JS SDK は使わず fetch のみ（英単語サイトの sync.js と同じ方式）。
   端末ごとに匿名ログイン → ポータルのプロフィール（ニックネーム＋連携キー）を作る →
   各サイトに連携キーを貼って、記録とランキングをまとめる。 */
(function(){
'use strict';
const cfg=window.PORTAL_CONFIG||{};
const enabled=/^(https:\/\/|http:\/\/localhost)/.test(cfg.url||'')&&!!cfg.key;
const SITES=Array.isArray(cfg.sites)?cfg.sites:[];
const $=id=>document.getElementById(id);
const node=(t,text,cls)=>{const e=document.createElement(t);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e;};
const num=n=>Number(n||0).toLocaleString('ja-JP');

/* ========== 保存（localStorage。使えない環境ではメモリ） ========== */
const mem={};
const store={
  get(k){try{return localStorage.getItem(k);}catch(_){return mem[k]===undefined?null:mem[k];}},
  set(k,v){try{localStorage.setItem(k,v);}catch(_){mem[k]=v;}}
};

/* ========== 通信（匿名ログイン＋RPC） ========== */
const hdr=t=>({'apikey':cfg.key,'Authorization':'Bearer '+(t||cfg.key),'Content-Type':'application/json'});
const withLock=(name,opts,fn)=>navigator.locks?navigator.locks.request(name,opts,fn):fn(true);
function limit(ms){
  if(typeof AbortSignal!=='undefined'&&AbortSignal.timeout)return {signal:AbortSignal.timeout(ms),done(){}};
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  return {signal:c.signal,done(){clearTimeout(t);}};
}
async function http(path,body,token){
  const t=limit(20000);
  let r;
  try{r=await fetch(cfg.url+path,{method:'POST',headers:hdr(token),body:JSON.stringify(body),signal:t.signal});}
  catch(err){
    t.done();
    const e=new Error(err&&(err.name==='TimeoutError'||err.name==='AbortError')?'通信がタイムアウトしました。':'ネットワークに接続できません。');
    e.network=true;throw e;
  }
  let j=null;try{j=await r.json();}catch{}
  t.done();
  if(!r.ok){
    const e=new Error((j&&(j.message||j.msg||j.error_description))||'HTTP '+r.status);
    e.status=r.status;e.code=j&&(j.code||j.error_code)||'';throw e;
  }
  return j;
}
const pack=r=>({access_token:r.access_token,refresh_token:r.refresh_token,expires_at:r.expires_at||Math.floor(Date.now()/1000+(r.expires_in||3600)),user_id:r.user&&r.user.id});
const readSession=()=>{try{return JSON.parse(store.get('portal_session')||'null');}catch(_){return null;}};
const writeSession=s=>store.set('portal_session',JSON.stringify(s));
function session(force){
  return withLock('portal-session',{mode:'exclusive'},async()=>{
    let s=readSession();
    if(s&&!force&&s.expires_at-60>Date.now()/1000)return s;
    if(s&&s.refresh_token){
      try{s=pack(await http('/auth/v1/token?grant_type=refresh_token',{refresh_token:s.refresh_token}));writeSession(s);return s;}
      catch(e){if(e.network||!e.status||e.status>=500||e.status===429)throw e;} // 通信失敗なら新規作成しない
    }
    s=pack(await http('/auth/v1/signup',{data:{},gotrue_meta_security:{}}));
    writeSession(s);return s;
  });
}
async function rpc(name,body){
  for(let attempt=0;;attempt++){
    const s=await session(attempt>0);
    try{return await http('/rest/v1/rpc/'+name,body||{},s.access_token);}
    catch(e){if(e.status===401&&attempt===0)continue;throw e;}
  }
}

/* ========== 画面の部品 ========== */
const app=$('app');
let ri=0;                                   // 現れる順番（ふわっと表示の遅れ）
const rise=(el,i)=>{el.classList.add('rise');el.style.setProperty('--i',String(i===undefined?ri++:i));return el;};
const fadeIn=(el,i)=>{el.classList.add('fade');el.style.setProperty('--i',String(i===undefined?ri++:i));return el;};
const say=(t,bad)=>{const m=$('msg');m.textContent=t||'';m.classList.toggle('bad',!!bad);};
const statRow=(a,b)=>{const r=node('div',undefined,'stat');r.append(node('span',a),node('span',b));return r;};
function countUp(el,to,ms){
  const t0=performance.now(),dur=ms||1100;
  el.textContent='0';
  const step=t=>{const p=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-p,4);el.textContent=num(Math.round(to*e));if(p<1)requestAnimationFrame(step);};
  requestAnimationFrame(step);
}
function seg(items,cur,pick,label){
  const d=node('div',undefined,'seg');d.setAttribute('role','group');if(label)d.setAttribute('aria-label',label);
  items.forEach(([v,t])=>{
    const b=node('button',t);b.type='button';b.setAttribute('aria-pressed',String(v===cur));
    b.addEventListener('click',()=>{if(v!==cur)pick(v);});d.append(b);
  });
  return d;
}
function section(title,i){
  const s=node('section',undefined,'sec');s.style.setProperty('--i',String(i));
  const h=node('div',undefined,'sec-head rise');h.style.setProperty('--i',String(i));h.append(node('p',title,'label'));
  s.append(h);return s;
}
async function copyText(t){
  try{await navigator.clipboard.writeText(t);return true;}catch(_){}
  try{const a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';document.body.append(a);a.select();const ok=document.execCommand('copy');a.remove();return ok;}catch(_){return false;}
}
const siteConf=id=>SITES.find(s=>s.id===id)||{id,label:id,short:id,url:''};
const siteStat=id=>((S.me&&S.me.sites)||[]).find(x=>x.site===id)||{site:id,devices:0,answers:0,today:0};
const joined=id=>siteStat(id).answers>0;

/* ========== 状態 ========== */
const S={me:null,scope:'all',period:'allTime',rank:null,rankErr:null,editing:false};
let rankToken=0;

/* ========== 描画：全体 ========== */
function render(){
  app.replaceChildren();ri=0;
  if(!S.me){
    const d=node('div',undefined,'loading');d.append(node('p','読み込み中','label'));app.append(d);return;
  }
  if(!S.me.hasProfile)renderWelcome();else renderDash();
}

/* ---------- はじめて：ニックネームを決める／キーで引き継ぐ ---------- */
function renderWelcome(){
  const hero=node('div',undefined,'hero');
  hero.append(rise(node('p','WELCOME','label')),rise(node('h1','学習の記録を、ひとつに。','tagline')),
    rise(node('p','英単語や古文単語など、別々のサイトでの学習を、同じ人の記録としてまとめます。ニックネームを決めると、連携キーを発行します。','lead')));
  app.append(hero);

  const form=node('form');form.noValidate=true;
  const lab=node('label','ニックネーム');
  const inp=node('input',undefined,'typing');inp.type='text';inp.maxLength=20;inp.autocomplete='off';inp.required=true;inp.placeholder='1〜20文字';
  lab.append(inp);
  const go=node('button','はじめる','primary');go.type='submit';
  form.append(lab,node('p','ランキングに表示されます。あとから変えられます。','mini'),go);
  rise(form);app.append(form);
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const v=inp.value.trim();if(!v){say('ニックネームを入力してください。',true);return;}
    go.disabled=true;say('作成しています…');
    try{
      await rpc('portal_create_profile',{p_nickname:v});
      say('');await reload();
    }catch(err){say(err.message||'作成できませんでした。',true);go.disabled=false;}
  });
  app.append(recoverBlock(rise(node('div'))));
}
function recoverBlock(wrap){
  const d=node('details');d.append(node('summary','すでにキーを持っている'));
  const pane=node('div',undefined,'pane');
  const lab=node('label','連携キー');
  const inp=node('input',undefined,'typing keyin');inp.type='text';inp.autocomplete='off';inp.spellcheck=false;inp.placeholder='XXXX-XXXX-XXXX-…';inp.setAttribute('autocapitalize','characters');
  lab.append(inp);
  const btn=node('button','このキーで引き継ぐ','primary');btn.type='button';btn.style.marginTop='22px';
  pane.append(lab,btn,node('p','別の端末で作ったプロフィールを、この端末でも使えます。','mini'));
  d.append(pane);
  btn.addEventListener('click',async()=>{
    const v=inp.value.trim();if(!v){say('キーを貼り付けてください。',true);return;}
    btn.disabled=true;say('確認しています…');
    try{await rpc('redeem_link_key',{p_key:v,p_site:'portal'});say('');await reload();}
    catch(err){say(err.message||'引き継げませんでした。',true);btn.disabled=false;}
  });
  wrap.append(d);return wrap;
}

/* ---------- ダッシュボード ---------- */
function renderDash(){
  const p=S.me.profile;

  const hero=node('div',undefined,'hero');hero.id='heroBox';app.append(hero);
  renderHero(true);ri=4;

  if(p.banned){
    const w=node('div',undefined,'warn');w.setAttribute('role','alert');
    w.append(node('p','ニックネームが不適切と判断されたため、ランキングに表示されていません。'));
    if(p.banReason)w.append(node('p','理由：'+p.banReason,'why'));
    w.append(node('p','ニックネームを変更しても、運営の確認が済むまでは表示されません。','why'));
    app.append(rise(w));
  }

  const sites=section('SITES',ri++);sites.id='sitesSec';app.append(sites);
  const list=node('div');list.id='sitesBox';sites.append(list);renderSites(true);

  const rk=section('RANKING',ri++);const rb=node('div');rb.id='rankBox';rise(rb,ri);rk.append(rb);app.append(rk);
  renderRank();

  const ks=section('KEY',ri++);
  ks.append(rise(node('p','各サイトの「連携する」ボタンを押すと、このキーが自動で渡されます。手で貼り付けるときは、ここからコピーしてください。再発行すると古いキーは使えなくなりますが、連携済みの端末はそのままです。','lead'),ri));
  ks.lastChild.style.marginTop='0';
  const re=node('button','キーを再発行する','secondary');re.type='button';re.style.marginTop='18px';
  const slot=node('div');slot.id='keySlot';
  const showKey=k=>{slot.replaceChildren(k?keyBox(k,'連携キー'):node('p','キーがまだ保存されていません。下の「キーを再発行する」で発行してください。','mini'));};
  showKey(p.key);
  re.addEventListener('click',async()=>{
    if(!confirm('キーを再発行しますか？古いキーは使えなくなります。'))return;
    re.disabled=true;say('発行しています…');
    try{const r=await rpc('portal_regenerate_key');if(S.me&&S.me.profile)S.me.profile.key=r.key;say('');showKey(r.key);}
    catch(err){say(err.message||'再発行できませんでした。',true);}
    finally{re.disabled=false;}
  });
  ks.append(slot,re,recoverBlock(node('div')));
  app.append(ks);
}

function keyBox(key,title){
  const b=node('div',undefined,'keybox');b.append(node('p',title,'label'));
  const parts=key.split('-'),half=Math.ceil(parts.length/2);
  const k=node('span',undefined,'key');
  k.append(node('span',parts.slice(0,half).join('-')),document.createElement('br'),node('span',parts.slice(half).join('-')));
  b.append(k);
  const row=node('div',undefined,'row');
  const cp=node('button','コピー','linkbtn');cp.type='button';
  cp.addEventListener('click',async()=>{const ok=await copyText(key);cp.textContent=ok?'コピーしました':'コピーできませんでした';setTimeout(()=>{cp.textContent='コピー';},2200);});
  row.append(cp);
  b.append(row,node('p','各サイトの「連携する」ボタンを押すと、このキーが自動で使われます。他の人には見せないでください。','mini'));
  return b;
}

function renderHero(first){
  const hero=$('heroBox');if(!hero)return;hero.replaceChildren();
  const p=S.me.profile,n=SITES.filter(s=>joined(s.id)).length;
  const put=(el,i)=>first?rise(el,i):el;
  hero.append(put(node('p','YOU','label'),0));
  const nick=node('h1',p.nickname,'nick');hero.append(put(nick,1));
  const row=node('div');
  if(S.editing){
    const f=node('form',undefined,'nickform');f.noValidate=true;
    const lab=node('label','ニックネーム');
    const inp=node('input',undefined,'typing');inp.type='text';inp.maxLength=20;inp.value=p.nickname;inp.autocomplete='off';lab.append(inp);
    const save=node('button','保存','linkbtn');save.type='submit';
    const cancel=node('button','やめる','linkbtn');cancel.type='button';
    cancel.addEventListener('click',()=>{S.editing=false;renderHero(false);});
    f.append(lab,save,cancel);row.append(f);
    f.addEventListener('submit',async e=>{
      e.preventDefault();const v=inp.value.trim();if(!v){say('ニックネームを入力してください。',true);return;}
      save.disabled=true;say('保存しています…');
      try{await rpc('portal_set_nickname',{p_nickname:v});S.editing=false;say('');await reload(true);}
      catch(err){say(err.message||'保存できませんでした。',true);save.disabled=false;}
    });
    setTimeout(()=>inp.focus(),0);
  }else{
    const ed=node('button','ニックネームを変更','linkbtn');ed.type='button';
    ed.addEventListener('click',()=>{S.editing=true;renderHero(false);});
    row.append(ed);
  }
  hero.append(put(row,2),put(node('p','参加中 '+n+' / '+SITES.length+' サイト','mini'),3));
}

/* ---------- サイト別の参加状況 ---------- */
function renderSites(first){
  const box=$('sitesBox');if(!box)return;box.replaceChildren();
  SITES.forEach((c,idx)=>{
    const st=siteStat(c.id),on=st.answers>0;
    const row=node('div',undefined,'site'+(on?'':' is-out'));row.style.setProperty('--i',String(first?idx+ri:idx*.6));
    const top=node('div',undefined,'site-top');top.append(node('span',c.label||c.id,'site-name'));
    if(on){
      const n=node('span',undefined,'site-num'),v=node('span');n.append(v,node('small','問'));top.append(n);countUp(v,st.answers);
    }else top.append(node('span','未参加','out'));
    row.append(top);
    if(on)row.append(node('p','今日 '+num(st.today)+'問　／　連携した端末 '+st.devices+'台','site-meta'));
    else if(st.devices>0)row.append(node('p','連携済み。まだ回答がありません。','site-meta'));
    else row.append(node('p','サイトの「ポータル連携」欄にキーを貼ると参加できます。','site-meta'));
    const act=node('div',undefined,'site-actions');
    if(c.url){
      // 連携ボタン：サイトの連携画面（#portal-link）をそのまま開く。キーはURLに載せず、持っていればコピーする
      const lk=node('a',st.devices>0?'連携し直す':'連携する','linkbtn');
      const base=c.url.replace(/#.*$/,'');
      lk.href=base+'#portal-link';lk.target='_blank';lk.rel='noopener';
      lk.addEventListener('click',e=>{
        const key=S.me&&S.me.profile&&S.me.profile.key;
        if(!key){e.preventDefault();say('キーがまだ保存されていません。下の「キーを再発行する」で発行してください。',true);return;}
        lk.href=base+'#portal-link='+encodeURIComponent(key);   // クリックの直前に、最新のキーで作る
        say('開いたサイトで「連携する」を選んでください。');
      });
      act.append(lk);
      const a=node('a','サイトを開く','linkbtn');a.href=c.url;a.target='_blank';a.rel='noopener';act.append(a);
    }
    if(st.devices>0){
      const un=node('button','連携を解除','linkbtn');un.type='button';
      un.addEventListener('click',async()=>{
        if(!confirm((c.label||c.id)+' との連携をすべて解除しますか？このサイトの記録は、この人の順位に含まれなくなります。'))return;
        un.disabled=true;say('解除しています…');
        try{await rpc('portal_unlink_site',{p_site:c.id});say('');await reload(true);}
        catch(err){say(err.message||'解除できませんでした。',true);un.disabled=false;}
      });
      act.append(un);
    }
    if(act.children.length)row.append(act);
    box.append(row);
  });
  if(!SITES.length)box.append(node('p','サイトが登録されていません。','empty'));
}

/* ---------- ランキング ---------- */
function renderRank(){
  const box=$('rankBox');if(!box)return;box.replaceChildren();
  const scopes=[['all','合算'],...SITES.map(s=>[s.id,s.short||s.label||s.id])];
  const pick=(k,v)=>{S[k]=v;S.rank=null;S.rankErr=null;renderRank();loadRank();};
  box.append(seg(scopes,S.scope,v=>pick('scope',v),'対象'),seg([['daily','今日'],['allTime','通算']],S.period,v=>pick('period',v),'期間'));
  const body=node('div');box.append(body);
  const r=S.rank,banned=S.me&&S.me.profile&&S.me.profile.banned;
  if(S.rankErr){body.append(node('p',S.rankErr,'empty'));return;}
  if(!r){body.append(node('p','集計中…','empty'));return;}

  const me=node('div',undefined,'me-block');
  if(banned)me.append(node('p','いまランキングには表示されていません。','mini'));
  else if(!r.me){
    if(S.scope!=='all'&&!joined(S.scope))me.append(node('p','未参加','out'));
    else me.append(node('p',S.period==='daily'?'今日はまだ0問。':'まだ0問。サイトで1問解くと順位が出ます。','mini'));
  }else{
    me.append(statRow('順位',r.me.rank+'位 ／ '+num(r.participants)+'人中'),statRow('解いた問題数',num(r.me.answers)+'問'),
      statRow('1つ上との差',Number.isSafeInteger(r.me.gap)&&r.me.gap>0?'あと '+num(r.me.gap)+'問':(r.me.rank===1?'1位':'—')));
    if(r.me.tied>0)me.append(statRow('同順位',r.me.tied+'人'));
  }
  body.append(me);

  const top=Array.isArray(r.top)?r.top:[];
  if(!top.length){body.append(node('p','まだ一覧に載る人がいません。','empty'));}
  else{
    const ul=node('ol',undefined,'rank-list');
    top.forEach((t,idx)=>{
      const li=node('li',undefined,'rank-row'+(t.rank<=3?' top':'')+(t.me?' me':''));li.style.setProperty('--i',String(idx));
      li.append(node('span',String(t.rank),'rank-no'));
      const main=node('div',undefined,'rank-main'),nm=node('span',t.nickname,'rank-name');
      if(t.me)nm.append(node('span','あなた','chip-me'));
      main.append(nm);
      if(S.scope==='all'){
        const sub=SITES.map(c=>{const n=t.bySite?t.bySite[c.id]:null;return (c.short||c.label||c.id)+' '+(Number.isFinite(n)?num(n)+'問':'未参加');}).join('　');
        if(sub)main.append(node('span',sub,'rank-sub'));
      }
      const cnt=node('span',num(t.answers),'rank-n');cnt.append(node('small','問'));
      li.append(main,cnt);ul.append(li);
    });
    body.append(ul);
  }
  const rf=node('button','更新','linkbtn');rf.type='button';rf.style.marginTop='22px';
  rf.addEventListener('click',()=>reload(true));
  body.append(rf,node('p','順位は日本時間の0時で切り替わります。一覧に名前が出るのは、ポータルに登録した人だけです。','mini'));
}
async function loadRank(){
  if(!S.me||!S.me.hasProfile)return;
  const tok=++rankToken;
  try{
    const r=await rpc('portal_ranking',{p_scope:S.scope,p_period:S.period,p_limit:20});
    if(tok!==rankToken)return;S.rank=r;S.rankErr=null;
  }catch(e){if(tok!==rankToken)return;S.rank=null;S.rankErr=e.message||'順位を確認できませんでした。';}
  renderRank();
}

/* ========== 読み込み ========== */
function errorView(){
  app.replaceChildren();ri=0;
  const d=node('div',undefined,'hero');d.append(rise(node('p','ERROR','label')));
  const b=node('button','もう一度読み込む','primary');b.type='button';b.style.marginTop='28px';
  b.addEventListener('click',()=>reload());d.append(rise(b));app.append(d);
}
async function reload(partial){
  if(navigator.onLine===false){say('オフラインです。オンラインに戻ると表示します。',true);if(!S.me)errorView();return;}
  try{
    S.me=await rpc('portal_me');say('');
  }catch(e){
    say(e.message||'読み込めませんでした。',true);
    if(!S.me)errorView();
    return;
  }
  if(partial&&S.me.hasProfile&&$('heroBox')){renderHero(false);renderSites(false);renderRank();loadRank();return;}
  render();
  if(S.me.hasProfile)loadRank();
}

/* ========== 起動 ========== */
function applyTheme(t){
  const d=t==='dark';document.documentElement.dataset.theme=d?'dark':'light';
  const b=$('theme');b.textContent=d?'Light':'Dark';b.setAttribute('aria-label',d?'ホワイトモードに切り替え':'ダークモードに切り替え');
}
function net(){$('net').textContent=navigator.onLine===false?'オフライン':'';}
applyTheme(document.documentElement.dataset.theme==='dark'?'dark':'light');
$('theme').addEventListener('click',()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(t);store.set('portal_theme',t);});
$('brandName').textContent=cfg.brand||'テンシ ポータル';document.title=cfg.brand||'テンシ ポータル';
net();addEventListener('online',()=>{net();reload(!!(S.me&&S.me.hasProfile));});addEventListener('offline',net);

let lastView=Date.now();
document.addEventListener('visibilitychange',()=>{ // 画面に戻ったとき、1分以上たっていたら静かに更新
  if(document.visibilityState!=='visible')return;
  if(Date.now()-lastView>60000&&S.me&&S.me.hasProfile&&!S.editing)reload(true);
  lastView=Date.now();
});

if(!enabled){app.append(node('p','config.js に Supabase の URL とキーを設定してください。','empty'));}
else{render();reload();}
})();
