// Pinche Güey — optional cloud sync through Supabase. It's off until config.js has values.
//
// How it works: every piece of data is a "record" with a key and the time it last changed
// on a device (updated_ms):
//   e:2026-10-01  that day's log         m:2026-10-01  that day's mood check-ins
//   p:goals       goals                  p:settings    weigh-in schedule
//   f:2026-10-01  progress photo (the image itself goes in the "photos" storage bucket)
// A sync pulls every record from the server, applies any that are newer than this device's
// copy, then uploads anything the server is missing or has an older copy of. Deletions are
// remembered as "tombstones" so they spread to other devices too.
// app.js passes in a small bridge object (see "sync bridge" in app.js) so this file never
// touches the app's variables directly.
window.createSync=function(app){
  const cfg=window.PG_CONFIG||{};
  const enabled=!!(cfg.supabaseUrl&&cfg.supabaseAnonKey);
  const META_KEY='cutcoach.sync'; // {ts:{key:ms}, del:{key:ms}} for this device
  const meta={ts:{},del:{},...app.load(META_KEY,{})};
  let client=null, user=null, busy=false, again=false, timer=0, lastSync=null, state=enabled?'loading':'unconfigured', lastError='';
  const listeners=[];
  const saveMeta=()=>app.save(META_KEY,meta);
  const setState=(s,err)=>{state=s;lastError=err||'';listeners.forEach(f=>f());};
  const photoPath=date=>user.id+'/'+date+'.jpg';

  // Called by app.js whenever something changes locally.
  function touch(key){meta.ts[key]=Date.now();delete meta.del[key];saveMeta();schedule();}
  function remove(key){meta.del[key]=Date.now();delete meta.ts[key];saveMeta();schedule();}
  function schedule(ms=1500){if(!user)return;clearTimeout(timer);timer=setTimeout(syncNow,ms);}

  function loadLibrary(){
    if(window.supabase) return Promise.resolve();
    return new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload=res; s.onerror=()=>rej(new Error('Couldn\'t load the sync library. Check your connection.'));
      document.head.append(s);
    });
  }
  async function init(){
    if(!enabled) return;
    try{await loadLibrary();}catch(e){setState('error',e.message);return;}
    client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
    const {data}=await client.auth.getSession();
    user=data&&data.session?data.session.user:null;
    client.auth.onAuthStateChange((event,session)=>{
      user=session?session.user:null;
      if(event==='SIGNED_IN') syncNow();
      if(event==='SIGNED_OUT') setState('signedout'); else setState(state);
    });
    setState(user?'idle':'signedout');
    if(user) syncNow();
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(300);}); // back in the app
    setInterval(()=>{if(!document.hidden)schedule(0);},60000);                              // and every minute
  }

  async function syncNow(){
    if(!client||!user) return;
    if(busy){again=true;return;}
    busy=true; setState('syncing');
    let changed=false;
    try{
      // 1. Pull every record (in pages of 1000, the server's default limit).
      const remote={};
      for(let from=0;;from+=1000){
        const {data,error}=await client.from('records').select('key,data,updated_ms,deleted').range(from,from+999);
        if(error) throw error;
        for(const r of data) remote[r.key]=r;
        if(data.length<1000) break;
      }
      // 2. Apply server changes that are newer than this device's copy. Data from before
      //    sync was turned on has no timestamp; it counts as very old, so the server wins.
      const local=app.localRecords();
      for(const r of Object.values(remote)){
        const mine=meta.ts[r.key]??meta.del[r.key]??(r.key in local?1:0);
        if(r.updated_ms<=mine) continue;
        if(r.key.startsWith('f:')){
          const date=r.key.slice(2);
          if(r.deleted) await app.removePhoto(date);
          else{
            const {data:blob,error}=await client.storage.from('photos').download(photoPath(date));
            if(error) throw error;
            await app.putPhoto(date,blob,r.data||{});
          }
        } else app.apply(r.key,r.deleted?null:r.data);
        meta.ts[r.key]=r.updated_ms; delete meta.del[r.key]; changed=true;
      }
      // 3. Upload local records the server doesn't have, or has an older copy of.
      const rows=[];
      for(const [key,data] of Object.entries(app.localRecords())){
        const r=remote[key]; let ts=meta.ts[key];
        if(ts==null){ if(r) continue; ts=meta.ts[key]=Date.now(); } // never synced: upload it
        if(r&&r.updated_ms>=ts) continue;
        if(key.startsWith('f:')){
          const blob=await app.photoBlob(key.slice(2)); if(!blob) continue;
          const {error}=await client.storage.from('photos').upload(photoPath(key.slice(2)),blob,{upsert:true,contentType:'image/jpeg'});
          if(error) throw error;
        }
        rows.push({user_id:user.id,key,data,updated_ms:ts,deleted:false});
      }
      for(const [key,ts] of Object.entries(meta.del)){
        const r=remote[key];
        if(!r||r.deleted||r.updated_ms>=ts){delete meta.del[key];continue;} // nothing to delete on the server
        if(key.startsWith('f:')) await client.storage.from('photos').remove([photoPath(key.slice(2))]);
        rows.push({user_id:user.id,key,data:null,updated_ms:ts,deleted:true});
      }
      if(rows.length){
        const {error}=await client.from('records').upsert(rows,{onConflict:'user_id,key'});
        if(error) throw error;
        for(const row of rows) if(row.deleted){delete meta.del[row.key];meta.ts[row.key]=row.updated_ms;}
      }
      lastSync=new Date(); setState('idle');
    }catch(e){
      setState('error',(e&&e.message)||'Sync failed.');
    }finally{
      saveMeta(); busy=false;
      if(changed) app.refresh();
      if(again){again=false;schedule(0);}
    }
  }

  async function signIn(email,password){
    const {error}=await client.auth.signInWithPassword({email,password});
    return error?error.message:'';
  }
  async function signUp(email,password){
    const {data,error}=await client.auth.signUp({email,password});
    if(error) return error.message;
    return data&&data.session?'':'Account created. Check your email to confirm it, then sign in here.';
  }
  // Apple Health import key (see supabase/health-import.sql). The key itself is only ever
  // shown once; the server keeps just its SHA-256 hash.
  async function importKeyCreated(){
    const {data,error}=await client.from('ingest_keys').select('created_at').limit(1);
    if(error) throw error;
    return data&&data[0]?data[0].created_at:null;
  }
  async function newImportKey(){
    const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const key=hex(crypto.getRandomValues(new Uint8Array(24)));
    const hash=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));
    const {error}=await client.from('ingest_keys').upsert({user_id:user.id,key_hash:hash,created_at:new Date().toISOString()},{onConflict:'user_id'});
    if(error) throw error;
    return key;
  }
  async function signOut(){ await client.auth.signOut(); user=null; setState('signedout'); }

  return {enabled,init,touch,remove,syncNow:()=>syncNow(),signIn,signUp,signOut,importKeyCreated,newImportKey,
    config:{url:cfg.supabaseUrl,key:cfg.supabaseAnonKey},
    onChange:f=>listeners.push(f),
    status:()=>({state,error:lastError,email:user?user.email:'',lastSync})};
};
