/* script.js — Funtura full client app
   - Local IndexedDB for users, plays, favorites, playlists, messages
   - Username+password auth (password hashed via Web Crypto SHA-256)
   - One-time admin creation workflow
   - YouTube embedding for video playback; optional YT Data API for search
   - Playlist import by pasting exported list (CSV/JSON/Text/YT urls)
   - Sticky live player with animations
   - NOTE: This is client-side only (IndexedDB). Not secure for production.
*/

/* =========================
   CONFIG
   ========================= */
const CONFIG = {
  YOUTUBE_API_KEY: "", // optional: your YouTube Data API v3 key to enable live search
  ADMIN_DEFAULT_USERNAME: "admin", // admin default username when created via UI
  // If you want to provision an admin via a token in the hash, set a token here and visit /#admin-create?token=XXX once
  ADMIN_CREATION_TOKEN: "tuyVha", // optional
};

/* =========================
   Sample Data (local seeds)
   ========================= */
const LOCAL_VIDEOS = [
  { id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", channel: "Rick Astley", tags:["pop","80s"] },
  { id: "3JZ_D3ELwOQ", title: "Charlie Puth - Attention", channel: "Charlie Puth", tags:["pop","2017"] },
  { id: "kXYiU_JCYtU", title: "Linkin Park - Numb", channel: "Linkin Park", tags:["rock"] },
  { id: "9bZkp7q19f0", title: "PSY - GANGNAM STYLE", channel: "officialpsy", tags:["kpop"] }
];
const LOCAL_SONGS = [
  { id: "song1", title: "SoundHelix 1", artist: "SoundHelix", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", art: "" },
  { id: "song2", title: "SoundHelix 2", artist: "SoundHelix", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", art: "" },
  { id: "song3", title: "LoFi Study Beats", artist: "Funtura Curated", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", art: "" }
];

/* =========================
   IndexedDB wrapper
   ========================= */
const DB_NAME = "funtura_db_v2";
const DB_VER = 1;
let db;
async function openDB(){
  return new Promise((res,rej)=>{
    const rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = e=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains("users")) d.createObjectStore("users", { keyPath:"username" });
      if(!d.objectStoreNames.contains("plays")) d.createObjectStore("plays", { keyPath:"id", autoIncrement:true });
      if(!d.objectStoreNames.contains("favorites")) d.createObjectStore("favorites", { keyPath:"id", autoIncrement:true });
      if(!d.objectStoreNames.contains("messages")) d.createObjectStore("messages", { keyPath:"id", autoIncrement:true });
      if(!d.objectStoreNames.contains("playlists")) d.createObjectStore("playlists", { keyPath:"id", autoIncrement:true });
    };
    rq.onsuccess = ()=>{ db = rq.result; res(db); };
    rq.onerror = ()=>rej(rq.error);
  });
}
function tx(store, mode="readonly"){ return db.transaction(store, mode).objectStore(store); }
function put(store, value){ return new Promise((res,rej)=>{ const r = tx(store,"readwrite").put(value); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function get(store, key){ return new Promise((res,rej)=>{ const r = tx(store,"readonly").get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function getAll(store){ return new Promise((res,rej)=>{ const r = tx(store,"readonly").getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function del(store, key){ return new Promise((res,rej)=>{ const r = tx(store,"readwrite").delete(key); r.onsuccess=()=>res(true); r.onerror=()=>rej(r.error); }); }

/* =========================
   Crypto utils — SHA-256 hashing for passwords
   ========================= */
async function sha256Hex(str){
  const enc = new TextEncoder();
  const data = enc.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hashBuffer);
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* =========================
   App State
   ========================= */
const state = {
  user: null,
  autoplay: false,
  currentVideo: null,
  currentTrack: null,
  queue: [],
  lastSearch: ""
};

/* =========================
   AUTH / ADMIN FLOW
   ========================= */
async function createUser({ username, password, displayName="", email="", isAdmin=false }){
  username = String(username).trim();
  const exists = await get("users", username);
  if (exists) throw new Error("User already exists");
  const hash = await sha256Hex(password || "");
  const user = { username, passwordHash: hash, displayName: displayName || username, email, isAdmin: !!isAdmin, created: Date.now() };
  await put("users", user);
  return user;
}
async function validateUser(username, password){
  const u = await get("users", username);
  if (!u) return false;
  const hash = await sha256Hex(password||"");
  return u.passwordHash === hash ? u : false;
}
async function getAdmin(){
  const users = await getAll("users");
  return users.find(u => u.isAdmin);
}
async function ensureAdminCreationFromToken(hash){
  // hash example: #admin-create?token=XXX
  if (!CONFIG.ADMIN_CREATION_TOKEN) return false;
  const [path, qs] = (hash||"").split("?");
  if (!path || !path.startsWith("#admin-create")) return false;
  if (!qs) return false;
  const params = new URLSearchParams(qs);
  const token = params.get("token");
  if (token !== CONFIG.ADMIN_CREATION_TOKEN) { alert("Admin token mismatch"); return false; }
  if (await getAdmin()) { alert("Admin already exists"); return true; }
  await createUser({ username: CONFIG.ADMIN_DEFAULT_USERNAME, password: token, displayName:"Administrator", isAdmin:true });
  alert("Admin created (username: " + CONFIG.ADMIN_DEFAULT_USERNAME + "). Use same token as initial password and change it in profile.");
  localStorage.setItem("funtura_admin_created","1");
  return true;
}

/* =========================
   Search & Suggestion (local + optional YT)
   ========================= */
function tokenize(text){ return String(text||"").toLowerCase().split(/[\s,._\-]+/).filter(Boolean); }
async function scoreItem(query, item){
  const q = tokenize(query);
  if (!q.length) return 0;
  const fields = [(item.title||""), (item.channel||item.artist||"")].join(" ");
  let score = 0;
  for (const tok of q){
    if ((fields||"").toLowerCase().includes(tok)) score += 1;
  }
  // personalization: small boost for plays by current user
  if (state.user){
    const plays = await getAll("plays");
    const count = plays.filter(p => p.username === state.user.username && p.itemId === (item.id)).length;
    score += Math.min(count,4) * 0.5;
  }
  return score;
}
async function performSearch(q){
  state.lastSearch = q;
  if (!q.trim()){
    return getSuggestions();
  }
  const vScores = await Promise.all(LOCAL_VIDEOS.map(async v => ({ item:v, score: await scoreItem(q, v) })));
  const sScores = await Promise.all(LOCAL_SONGS.map(async s => ({ item:s, score: await scoreItem(q, s) })));
  let videos = vScores.filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.item);
  let songs = sScores.filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.item);

  // optional YT API search merge
  if (CONFIG.YOUTUBE_API_KEY){
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=6&key=${CONFIG.YOUTUBE_API_KEY}`);
      if (res.ok){
        const data = await res.json();
        const mapped = (data.items||[]).map(i=>({ id: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle }));
        // merge avoiding duplicates
        const ids = new Set(videos.map(v=>v.id));
        for (const m of mapped) if (!ids.has(m.id)) videos.push(m);
      }
    } catch(e){ console.warn("YT API search failed", e); }
  }
  return { videos, songs };
}
async function getSuggestions(limit=8){
  const plays = await getAll("plays");
  const counts = {};
  for (const p of plays) counts[p.itemId] = (counts[p.itemId]||0) + 1;
  const videoList = LOCAL_VIDEOS.map(v => ({ item:v, score: (counts[v.id]||0) + Math.random()*0.4 }));
  const songList = LOCAL_SONGS.map(s => ({ item:s, score: (counts[s.id]||0) + Math.random()*0.4 }));
  return {
    videos: videoList.sort((a,b)=>b.score-a.score).map(x=>x.item).slice(0,limit),
    songs: songList.sort((a,b)=>b.score-a.score).map(x=>x.item).slice(0,limit)
  };
}

/* =========================
   Player logic (video + audio) and live player UI
   ========================= */
function showLivePlayer(){ document.getElementById("livePlayer").classList.remove("hidden"); }
function hideLivePlayer(){ document.getElementById("livePlayer").classList.add("hidden"); }
function updateLivePlayerMeta(track){
  const artEl = document.getElementById("lpArt");
  const titleEl = document.getElementById("lpTitle");
  const artistEl = document.getElementById("lpArtist");
  if (!track) { artEl.style.backgroundImage=""; titleEl.textContent="No track"; artistEl.textContent=""; hideLivePlayer(); return; }
  artEl.style.backgroundImage = track.art ? `url(${track.art})` : `linear-gradient(135deg,#222,#111)`;
  titleEl.textContent = track.title || "Track";
  artistEl.textContent = track.artist || track.channel || "";
  document.getElementById("audioPlayer").src = track.src || ""; // if playing audio
  // animate artwork when playing
  if (!document.getElementById("audioPlayer").paused) artEl.classList.add("spin"); else artEl.classList.remove("spin");
  showLivePlayer();
}
function playTrack(track){
  state.currentTrack = track;
  // save play for personalization
  if (state.user) put("plays", { username: state.user.username, itemId: track.id, ts: Date.now() }).catch(()=>{});
  updateLivePlayerMeta(track);
  const audio = document.getElementById("audioPlayer");
  if (track.src){
    audio.src = track.src;
    audio.play().catch(()=>{});
  } else {
    audio.pause();
  }
}
function togglePlayPause(){
  const audio = document.getElementById("audioPlayer");
  const btn = document.getElementById("playPauseBtn");
  if (audio.paused){
    audio.play().catch(()=>{});
    btn.textContent = "⏸";
    document.getElementById("lpArt").classList.add("spin");
  } else {
    audio.pause();
    btn.textContent = "▶";
    document.getElementById("lpArt").classList.remove("spin");
  }
}

/* =========================
   Playlist import (Spotify/Apple)
   - Approach: client-side paste of playlist text/CSV/JSON or list of YT urls
   - I provide a flexible parser that attempts to extract track title + artist + YT id or source URL
   ========================= */
function parsePlaylistText(txt){
  // basic heuristics:
  // - If JSON: try parse for common keys (tracks, items)
  // - If CSV-ish: split lines and extract "artist - title" or "title - artist"
  // - If youtube urls found, extract id
  const out = [];
  try {
    const j = JSON.parse(txt);
    // attempt Spotify export shape or generic {tracks:[]}
    const items = j.tracks || j.items || j;
    if (Array.isArray(items)){
      for (const it of items){
        // flexible extraction
        const title = it.name || it.title || it.track?.name || (it.snippet && it.snippet.title) || "";
        const artist = (it.artists && it.artists.map(a=>a.name).join(", ")) || it.artist || it.track?.artists?.map(a=>a.name).join(", ") || "";
        const src = it.preview_url || it.src || ""; // spotify preview maybe
        out.push({ title, artist, src, id: it.id || undefined });
      }
      return out;
    }
  } catch(e){
    // not JSON
  }

  // find youtube ids in text
  const YT_RE = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/g;
  let m;
  while ((m = YT_RE.exec(txt)) !== null){
    out.push({ title: "YouTube track", artist: "", src: "", ytId: m[1], id: m[1] });
  }
  // fallback: line-by-line
  const lines = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  for (const ln of lines){
    // try "Artist - Title" or "Title - Artist"
    const parts = ln.split(" - ");
    if (parts.length >= 2){
      out.push({ artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() });
    } else {
      out.push({ title: ln, artist: "" });
    }
  }
  return out;
}

/* =========================
   UI Rendering (Home / Music / Chat / Library)
   ========================= */
const app = document.getElementById("app");
function setUserBadge(){ const ui = document.getElementById("userInfo"); if (state.user) ui.textContent = `${state.user.displayName||state.user.username}${state.user.isAdmin? " (admin)" : ""}`; else ui.textContent = ""; }
async function renderHome(){
  const suggestions = await getSuggestions(8);
  app.innerHTML = `
    <div class="grid">
      <div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="margin:0">Recommended</h3>
            <div class="muted small">Autoplay: ${state.autoplay?"On":"Off"}</div>
          </div>
        </div>

        <div style="margin-top:12px">
          ${suggestions.videos.map(v=>`
            <div class="video-tile card" data-id="${v.id}">
              <div class="thumb"><iframe src="https://www.youtube.com/embed/${v.id}?rel=0" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe></div>
              <div class="info">
                <h4>${escapeHtml(v.title)}</h4>
                <p class="muted">${escapeHtml(v.channel||"")}</p>
                <div style="margin-top:8px"><button class="btn play-video" data-id="${v.id}">Play</button></div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <aside>
        <div class="card">
          <h4>Your Music</h4>
          <div class="muted small">Playlists & imports</div>
          <div id="sidebarPlaylists" style="margin-top:10px"></div>
          <div style="margin-top:10px">
            <button id="openImport" class="btn">Import playlist</button>
            <button id="openMusic" class="btn">Go to Music</button>
          </div>
        </div>
      </aside>
    </div>
  `;

  // attach events
  document.querySelectorAll(".play-video").forEach(b=>b.addEventListener("click", e=>{
    const id = b.getAttribute("data-id");
    const item = LOCAL_VIDEOS.find(v=>v.id===id) || { id, title: "Video", channel: "" };
    playVideo(item);
  }));
  document.getElementById("openImport").addEventListener("click", ()=>renderImport());
  document.getElementById("openMusic").addEventListener("click", ()=>renderMusic());
  renderSidebarPlaylists();
}

function escapeHtml(s){ return String(s||"").replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function renderMusic(){
  app.innerHTML = `
    <div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">Music</h3>
          <div class="muted small">Live player at bottom</div>
        </div>
      </div>

      <div style="margin-top:12px">
        <div class="card">
          <h4>Tracks</h4>
          <div class="music-list" id="musicList">
            ${LOCAL_SONGS.map(s=>`
              <div class="track" data-id="${s.id}">
                <div class="left">
                  <img src="${s.art||''}" alt="" />
                  <div class="meta"><div class="title">${escapeHtml(s.title)}</div><div class="muted">${escapeHtml(s.artist)}</div></div>
                </div>
                <div><button class="btn primary play-track" data-id="${s.id}">Play</button></div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    </div>
  `;
  document.querySelectorAll(".play-track").forEach(b=>b.addEventListener("click", async ()=>{
    const id = b.getAttribute("data-id");
    const track = LOCAL_SONGS.find(s=>s.id===id);
    if (track) playTrack(track);
  }));
}

async function renderImport(){
  app.innerHTML = `
    <div class="card">
      <h3>Import Playlist</h3>
      <div class="muted small">Paste a Spotify/Apple Music export, a list of YouTube links, or plain text (one track per line).</div>
      <textarea id="importTxt" placeholder="Paste playlist JSON, CSV or list of YouTube URLs here" style="width:100%;height:180px;margin-top:12px"></textarea>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button id="doImport" class="btn primary">Import</button>
        <button id="cancelImport" class="btn">Cancel</button>
      </div>
      <div id="importMsg" class="muted small" style="margin-top:8px"></div>
    </div>
  `;
  document.getElementById("cancelImport").addEventListener("click", ()=>renderHome());
  document.getElementById("doImport").addEventListener("click", async ()=>{
    const txt = document.getElementById("importTxt").value.trim();
    if (!txt) return document.getElementById("importMsg").textContent = "Paste something to import.";
    const parsed = parsePlaylistText(txt);
    // save playlist as a new playlist object
    const playlist = { title: "Imported playlist " + (new Date()).toLocaleString(), items: parsed, createdBy: state.user.username, createdAt: Date.now() };
    const id = await put("playlists", playlist);
    document.getElementById("importMsg").textContent = `Imported ${parsed.length} items to playlist id ${id}.`;
    renderSidebarPlaylists();
  });
}

/* helper to show saved playlists in sidebar */
async function renderSidebarPlaylists(){
  const container = document.getElementById("sidebarPlaylists");
  if (!container) return;
  const pls = await getAll("playlists");
  container.innerHTML = pls.length ? pls.map(p=>`<div style="margin-bottom:8px"><strong>${escapeHtml(p.title)}</strong><div class="muted small">By ${escapeHtml(p.createdBy)}</div><div style="margin-top:6px"><button class="btn small open-pl" data-id="${p.id}">Open</button></div></div>`).join("") : `<div class="muted small">No playlists</div>`;
  document.querySelectorAll(".open-pl").forEach(b=>b.addEventListener("click", async ()=>{
    const id = Number(b.getAttribute("data-id"));
    const pl = (await getAll("playlists")).find(x=>x.id===id);
    if (!pl) return alert("Playlist not found");
    // show playlist view
    app.innerHTML = `
      <div class="card">
        <h3>${escapeHtml(pl.title)}</h3>
        <div class="muted small">Imported ${pl.items.length} items</div>
        <div style="margin-top:12px">${pl.items.map((it, idx)=>`<div class="track card" data-idx="${idx}" style="margin-bottom:8px"><div class="left"><div style="width:48px;height:48px;background:#000;border-radius:8px"></div><div class="meta"><div class="title">${escapeHtml(it.title||it.name||it.ytId||"Untitled")}</div><div class="muted">${escapeHtml(it.artist||"")}</div></div></div><div><button class="btn play-from-pl" data-idx="${idx}">Play</button></div></div>`).join("")}</div>
        <div style="margin-top:10px"><button class="btn" id="backToHome">Back</button></div>
      </div>
    `;
    document.getElementById("backToHome").addEventListener("click", ()=>renderHome());
    document.querySelectorAll(".play-from-pl").forEach(b=>b.addEventListener("click", async ()=>{
      const idx = Number(b.getAttribute("data-idx"));
      const item = pl.items[idx];
      if (item.ytId) { playVideo({ id: item.ytId, title: item.title||"YouTube video", channel:"" }); return; }
      if (item.src) { playTrack(item); return; }
      // otherwise, try to search by title
      const res = await performSearch(item.title || "");
      if (res.songs && res.songs.length) playTrack(res.songs[0]);
      else if (res.videos && res.videos.length) playVideo(res.videos[0]);
      else alert("Couldn't find playable item for: " + (item.title||""));
    }));
  }));
}

/* play a video (embed in right column) */
function playVideo(item){
  state.currentVideo = item;
  // record play
  if (state.user) put("plays", { username: state.user.username, itemId: item.id, ts: Date.now() }).catch(()=>{});
  // render a video-focused player area
  app.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:12px">
        <div style="flex:1">
          <div class="thumb" style="height:480px;"><iframe src="https://www.youtube.com/embed/${item.id}?autoplay=${state.autoplay?1:0}&rel=0" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe></div>
          <h2 style="margin-top:12px">${escapeHtml(item.title)}</h2>
          <div class="muted">${escapeHtml(item.channel||"")}</div>
        </div>
        <aside style="width:320px">
          <div class="card">
            <h4>Up next</h4>
            <div id="upNext" style="margin-top:10px"></div>
          </div>
        </aside>
      </div>
    </div>
  `;
  // fill upNext with suggestions
  (async ()=>{
    const sug = await getSuggestions(6);
    document.getElementById("upNext").innerHTML = sug.videos.map(v=>`<div style="display:flex;gap:8px;margin-bottom:8px"><div style="width:110px;height:62px;background:#000;border-radius:6px"><img src="https://img.youtube.com/vi/${v.id}/mqdefault.jpg" style="width:100%;height:100%;object-fit:cover;border-radius:6px" /></div><div style="flex:1"><div style="font-weight:600">${escapeHtml(v.title)}</div><div class="muted small">${escapeHtml(v.channel)}</div></div><div><button class="btn play-up" data-id="${v.id}">Play</button></div></div>`).join("");
    document.querySelectorAll(".play-up").forEach(b=>b.addEventListener("click", ()=>{
      const id = b.getAttribute("data-id");
      const it = LOCAL_VIDEOS.find(x=>x.id===id) || { id, title:"Video" };
      playVideo(it);
    }));
  })();
}

/* =========================
   UI Wiring: auth modal, login/register, admin create
   ========================= */
async function showAuthModal(){
  document.getElementById("authModal").style.display = "flex";
}
async function hideAuthModal(){ document.getElementById("authModal").style.display = "none"; }

async function initAuth(){
  document.getElementById("btnSignIn").addEventListener("click", async ()=>{
    const username = document.getElementById("inUsername").value.trim();
    const password = document.getElementById("inPassword").value;
    if (!username || !password) return showAuthMsg("Enter username & password.");
    const u = await validateUser(username, password);
    if (!u) return showAuthMsg("Invalid credentials.");
    state.user = u;
    localStorage.setItem("funtura_current_user", username);
    hideAuthModal();
    setUserBadge();
    renderHome();
  });

  document.getElementById("btnRegister").addEventListener("click", async ()=>{
    const username = document.getElementById("inUsername").value.trim();
    const password = document.getElementById("inPassword").value;
    if (!username || !password) return showAuthMsg("Enter username & password to register.");
    try {
      await createUser({ username, password, displayName: username });
      showAuthMsg("Account created. You can now sign in.");
    } catch(e){
      showAuthMsg("User exists — choose another username.");
    }
  });

  document.getElementById("btnAdminCreate").addEventListener("click", async ()=>{
    // one-time admin creation UI: prompt for a password
    if (await getAdmin()) return showAuthMsg("Admin already exists.");
    const pw = prompt("Set admin password (one-time). Keep it safe.");
    if (!pw) return showAuthMsg("Admin creation cancelled.");
    await createUser({ username: CONFIG.ADMIN_DEFAULT_USERNAME, password: pw, displayName: "Administrator", isAdmin:true });
    localStorage.setItem("funtura_admin_created","1");
    showAuthMsg("Admin created. Please sign in as admin.");
  });

  // try auto-login if stored
  const cur = localStorage.getItem("funtura_current_user");
  if (cur){
    const u = await get("users", cur);
    if (u){ state.user = u; hideAuthModal(); setUserBadge(); renderHome(); return; }
    else localStorage.removeItem("funtura_current_user");
  }

  // else require login
  showAuthModal();
}

/* small helper */
function showAuthMsg(txt){ document.getElementById("authMsg").textContent = txt; setTimeout(()=>document.getElementById("authMsg").textContent="",4000); }

/* =========================
   Wire other UI: header buttons, player controls
   ========================= */
function wireHeader(){
  document.getElementById("searchBtn").addEventListener("click", async ()=>{
    const q = document.getElementById("globalSearch").value.trim();
    if (!q) return alert("Type search text");
    const res = await performSearch(q);
    app.innerHTML = `<div class="card"><h3>Search results for "${escapeHtml(q)}"</h3><div style="margin-top:12px">${res.videos.length? `<h4>Videos</h4>` + res.videos.map(v=>`<div class="video-tile card"><div class="thumb"><iframe src="https://www.youtube.com/embed/${v.id}?rel=0" frameborder="0" allowfullscreen></iframe></div><div class="info"><h4>${escapeHtml(v.title)}</h4><p class="muted">${escapeHtml(v.channel)}</p><div style="margin-top:8px"><button class="btn play-video" data-id="${v.id}">Play</button></div></div></div>`).join("") : "<div class='muted'>No videos</div>"} ${res.songs.length? `<h4>Songs</h4>` + res.songs.map(s=>`<div class="track card"><div class="left"><div style="width:48px;height:48px;background:#000;border-radius:8px"></div><div class="meta"><div class="title">${escapeHtml(s.title)}</div><div class="muted">${escapeHtml(s.artist||"")}</div></div></div><div><button class="btn play-track" data-id="${s.id}">Play</button></div></div>`).join("") : "<div class='muted'>No songs</div>"}</div></div>`;
    document.querySelectorAll(".play-video").forEach(b=>b.addEventListener("click", e=>playVideo({ id:b.getAttribute("data-id"), title:"Video" })));
    document.querySelectorAll(".play-track").forEach(b=>b.addEventListener("click", async e=>{
      const tid = b.getAttribute("data-id");
      const tr = LOCAL_SONGS.find(x=>x.id===tid);
      if (tr) playTrack(tr);
    }));
  });

  document.getElementById("logoutBtn").addEventListener("click", ()=>{
    state.user = null; localStorage.removeItem("funtura_current_user"); showAuthModal(); setUserBadge();
  });

  // live player controls
  document.getElementById("playPauseBtn").addEventListener("click", togglePlayPause);
  document.getElementById("prevBtn").addEventListener("click", ()=>{ /* not implemented: play previous in queue */ alert("Previous (not implemented)"); });
  document.getElementById("nextBtn").addEventListener("click", ()=>{ /* not implemented: play next */ alert("Next (not implemented)"); });
  document.getElementById("audioPlayer").addEventListener("play", ()=>{ document.getElementById("playPauseBtn").textContent="⏸"; document.getElementById("lpArt").classList.add("spin"); });
  document.getElementById("audioPlayer").addEventListener("pause", ()=>{ document.getElementById("playPauseBtn").textContent="▶"; document.getElementById("lpArt").classList.remove("spin"); });

  // autoplay toggle
  document.getElementById("autoplayToggle").addEventListener("change", (e)=>{ state.autoplay = e.target.checked; localStorage.setItem("funtura_autoplay", state.autoplay?"1":"0"); });
  if (localStorage.getItem("funtura_autoplay")==="1"){ state.autoplay=true; document.getElementById("autoplayToggle").checked = true; }
}

/* =========================
   Boot sequence
   ========================= */
window.addEventListener("load", async ()=>{
  document.getElementById("year").textContent = new Date().getFullYear();
  await openDB();

  // ensure admin creation from hash if token present
  await ensureAdminCreationFromToken(window.location.hash || "");
  // wire UI
  wireHeader();
  await initAuth();

  // ensure live player hidden initially
  hideLivePlayer();

  // default home
  if (state.user) renderHome();
});

/* =========================
   Extra helpers
   ========================= */
function parsePlaylistText(txt){
  // small wrapper to the earlier implementation for re-use
  // try JSON:
  try {
    const j = JSON.parse(txt);
    if (Array.isArray(j)) return j.map(x=>({ title: x.name||x.title||x.track?.name||"", artist: (x.artists && x.artists.map(a=>a.name).join(", ")) || x.artist || "" , src: x.preview_url || x.src || "", id: x.id }));
    if (j.tracks) return j.tracks.map(t => ({ title: t.name||"", artist: (t.artists && t.artists.map(a=>a.name).join(", ")) || "" , src: t.preview_url||"" , id: t.id }));
  } catch(e){}
  // youtube ids
  const YT_RE = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/g;
  const out = [];
  let m;
  while ((m = YT_RE.exec(txt)) !== null) out.push({ title: m[1], ytId: m[1], id: m[1] });
  if (out.length) return out;
  // plain lines
  const lines = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  for (const l of lines){
    const parts = l.split(" - ");
    if (parts.length >= 2) out.push({ artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() });
    else out.push({ title: l });
  }
  return out;
}
