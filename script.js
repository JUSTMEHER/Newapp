/* script.js — Funtura complete app (login gate + admin one-time creation)
   NOTES:
   - Client-side only. IndexedDB stores users, plays, favorites, messages.
   - Set ADMIN_CREATION_URL to fetch admin details from a link (CORS required).
   - Or set ADMIN_CREATION_TOKEN and use URL hash: #admin-create?token=THE_TOKEN
   - Admin creation is one-time: once created the app sets localStorage flag 'funtura_admin_created'
*/

/* ------------------------------
   CONFIG (edit here)
   ------------------------------ */
// Optional: endpoint that returns JSON for admin creation { username, displayName, email, isAdmin:true }
// If set, the app will try to fetch it once on first load and create the admin.
const ADMIN_CREATION_URL = ""; // e.g. "https://mysite.com/funtura-admin-provision"

// Or a one-time token approach (you create a token here, then open link https://.../#admin-create?token=TOKEN)
const ADMIN_CREATION_TOKEN = "34qad7"; // e.g. "MY_SECRET_ONETIME_TOKEN"

/* Existing config from previous version */
const YOUTUBE_API_KEY = ""; // optional
const YOUTUBE_MAX_RESULTS = 6;

/* ------------------------------
   Sample local dataset (videos and songs).
   You can extend this list.
   ------------------------------ */
const LOCAL_VIDEOS = [
  { id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", channel: "Rick Astley", tags: ["pop","80s","classic"], type: "youtube" },
  { id: "3JZ_D3ELwOQ", title: "Charlie Puth - Attention", channel: "Charlie Puth", tags: ["pop","2017","official"], type: "youtube" },
  { id: "9bZkp7q19f0", title: "PSY - GANGNAM STYLE", channel: "officialpsy", tags: ["kpop","viral"], type: "youtube" },
  { id: "kXYiU_JCYtU", title: "Linkin Park - Numb", channel: "LinkinPark", tags: ["rock","2003"], type: "youtube" }
];

const LOCAL_SONGS = [
  { id: "song1", title: "SoundHelix 1", artist: "SoundHelix", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", tags: ["instrumental","demo"] },
  { id: "song2", title: "SoundHelix 2", artist: "SoundHelix", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", tags: ["instrumental","demo"] },
  { id: "song3", title: "LoFi Study Beats", artist: "Funtura Curated", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", tags: ["lofi","study"] }
];

/* ------------------------------
   IndexedDB wrapper
   ------------------------------ */
const DB_NAME = "funtura_db_v1";
const DB_VERSION = 1;
let db;

function openDB() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("users")) d.createObjectStore("users", { keyPath: "username" });
      if (!d.objectStoreNames.contains("plays")) d.createObjectStore("plays", { keyPath: "id", autoIncrement: true });
      if (!d.objectStoreNames.contains("favorites")) d.createObjectStore("favorites", { keyPath: "id", autoIncrement: true });
      if (!d.objectStoreNames.contains("messages")) d.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
    };
    rq.onsuccess = () => { db = rq.result; res(db); };
    rq.onerror = (err) => rej(err);
  });
}
function put(storeName, val) {
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, "readwrite");
    const s = tx.objectStore(storeName);
    const rq = s.put(val);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
function get(storeName, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, "readonly");
    const s = tx.objectStore(storeName);
    const rq = s.get(key);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
function getAll(storeName) {
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, "readonly");
    const s = tx.objectStore(storeName);
    const rq = s.getAll();
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

/* ------------------------------
   Small helpers
   ------------------------------ */
const el = id => document.getElementById(id);
function escapeHtml(s){ return String(s||"").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function qs(selector, root=document) { return root.querySelector(selector); }
function qsa(selector, root=document) { return Array.from(root.querySelectorAll(selector)); }
function parseHashParams(hash) {
  // e.g. #admin-create?token=abc
  const [path, query] = hash.split("?");
  const params = {};
  if (query) {
    new URLSearchParams(query).forEach((v,k)=>params[k]=v);
  }
  return { path: path || "", params };
}

/* ------------------------------
   App state
   ------------------------------ */
let state = {
  user: null,
  autoplay: false,
  currentVideo: null,
  currentSong: null,
  playlist: [],
  lastSearch: ""
};

/* ------------------------------
   AUTH / LOGIN / ADMIN creation
   ------------------------------ */
async function createUser(username, { displayName="", email="", isAdmin=false }={}) {
  const user = { username, displayName: displayName || username, email: email || "", isAdmin: !!isAdmin, createdAt: Date.now() };
  await put("users", user);
  return user;
}

async function findAdminUser() {
  const users = await getAll("users");
  return users.find(u => u.isAdmin);
}

async function tryAutoCreateAdminFromUrl() {
  // 1) If ADMIN_CREATION_URL is set, attempt fetch once on first run
  const adminFlag = localStorage.getItem("funtura_admin_created");
  if (adminFlag) return; // already created or attempted

  if (ADMIN_CREATION_URL) {
    try {
      const r = await fetch(ADMIN_CREATION_URL, { method: "GET" });
      if (r.ok) {
        const json = await r.json();
        if (json && json.username) {
          // create admin
          await createUser(json.username, { displayName: json.displayName || json.username, email: json.email || "", isAdmin: true });
          localStorage.setItem("funtura_admin_created", "1");
          console.log("Admin created from ADMIN_CREATION_URL");
          return;
        }
      } else {
        console.warn("Admin creation URL returned non-ok status", r.status);
      }
    } catch (e) {
      console.warn("Admin creation fetch failed:", e);
    }
  }
  // 2) If not created, leave option for token creation (handled when hash parsed)
}

async function tryCreateAdminFromToken(hash) {
  // parse hash for admin-create token
  const { path, params } = parseHashParams(hash);
  if (!path.startsWith("#admin-create")) return false;
  if (!ADMIN_CREATION_TOKEN) return false; // not configured
  if (localStorage.getItem("funtura_admin_created")) return false;

  const token = params.token || "";
  if (token !== ADMIN_CREATION_TOKEN) {
    // token mismatch
    alert("Admin token invalid.");
    return false;
  }
  // create a default admin account (username from token or default)
  const username = "admin";
  const displayName = "Administrator";
  await createUser(username, { displayName, isAdmin: true });
  localStorage.setItem("funtura_admin_created", "1");
  alert("Admin account created: username='admin'. Please sign in.");
  return true;
}

/* login UI actions */
async function loginWithUsername(username) {
  if (!username || !username.trim()) return showLoginMsg("Please type a username.");
  username = username.trim();
  let u = await get("users", username);
  if (!u) {
    // create automatically
    u = await createUser(username, { displayName: username, isAdmin: false });
  }
  state.user = u;
  localStorage.setItem("funtura_current_user", username);
  updateUIAfterLogin();
  hideLoginGate();
}
function logout() {
  state.user = null;
  localStorage.removeItem("funtura_current_user");
  // show login gate
  showLoginGate();
}

/* show/hide login gate overlay */
function showLoginGate() {
  el("loginGate").style.display = "flex";
}
function hideLoginGate() {
  el("loginGate").style.display = "none";
}

/* UI update after login */
function updateUIAfterLogin() {
  // top-right badge
  const badge = el("userBadge");
  if (state.user) {
    badge.textContent = (state.user.displayName||state.user.username).slice(0,2).toUpperCase();
    badge.title = `${state.user.displayName || state.user.username} ${state.user.isAdmin ? "(admin)" : ""}`;
  } else {
    badge.textContent = "";
    badge.title = "";
  }
}

/* ------------------------------
   Search + suggestion + player logic
   (kept minimal here; you already have earlier version)
   ------------------------------ */
function tokenize(text) {
  return String(text || "").toLowerCase().split(/[\s,._-]+/).filter(Boolean);
}

async function scoreItem(query, item, isSong = false) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return 0;
  const fields = [
    { value: item.title || "", weight: 3 },
    { value: item.channel || item.artist || "", weight: 2 },
  ];
  if (item.tags) fields.push({ value: item.tags.join(" "), weight: 1.5 });

  let score = 0;
  for (const f of fields) {
    const fTokens = tokenize(f.value);
    for (const qt of qTokens) {
      if (fTokens.includes(qt)) score += f.weight * 1.2;
      else {
        if (f.value.toLowerCase().includes(qt)) score += f.weight * 0.6;
      }
    }
  }

  // personalize: boost if user played this before
  if (state.user) {
    const plays = await getAll("plays");
    const same = plays.filter(p => p.username === state.user.username && (p.itemId === (item.id || item.videoId)));
    score += Math.min(same.length, 6) * 0.8;
  }
  return score;
}

async function performSearch(query) {
  state.lastSearch = query;
  const q = query.trim();
  if (!q) {
    return getSuggestions();
  }
  const videoScores = await Promise.all(LOCAL_VIDEOS.map(async v => ({ item: v, score: await scoreItem(q, v, false) })));
  const songScores = await Promise.all(LOCAL_SONGS.map(async s => ({ item: s, score: await scoreItem(q, s, true) })));

  let videos = videoScores.filter(v => v.score > 0).sort((a,b)=>b.score-a.score).map(x=>x.item);
  let songs = songScores.filter(s => s.score > 0).sort((a,b)=>b.score-a.score).map(x=>x.item);

  // optional YT API omitted here for brevity (you can put earlier YT code)
  return { videos, songs };
}

async function getSuggestions(limit = 8) {
  const plays = await getAll("plays");
  const counts = {};
  for (const p of plays) counts[p.itemId] = (counts[p.itemId]||0) + 1;

  const vlist = LOCAL_VIDEOS.map(v => ({ item:v, score: (counts[v.id] || 0) + Math.random()*0.4 }));
  const slist = LOCAL_SONGS.map(s => ({ item:s, score: (counts[s.id] || 0) + Math.random()*0.4 }));

  const videos = vlist.sort((a,b)=>b.score-a.score).map(x=>x.item).slice(0,limit);
  const songs = slist.sort((a,b)=>b.score-a.score).map(x=>x.item).slice(0,limit);

  return { videos, songs };
}

/* play actions (video & song) */
function playVideo(item) {
  state.currentVideo = item;
  // save play
  if (state.user) put("plays", { username: state.user.username, itemId: item.id, ts: Date.now() }).catch(()=>{});
  renderHome(); // re-render to show player on right side
}
function playSong(item) {
  state.currentSong = item;
  if (state.user) put("plays", { username: state.user.username, itemId: item.id, ts: Date.now() }).catch(()=>{});
  renderMusic(); // re-render music view to show current song
}

/* ------------------------------
   Rendering: home, music, chat, library
   ------------------------------ */
const app = el("app");

function setActiveNav(route) {
  qsa(".navlink").forEach(a => a.classList.toggle("active", a.getAttribute("data-route") === route));
}

async function renderHome() {
  setActiveNav("#home");
  const suggestions = await getSuggestions(8);
  app.innerHTML = `
    <div class="grid">
      <div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="margin:0">Recommended for you</h3>
            <div class="muted small">Autoplay: ${state.autoplay ? "On" : "Off"}</div>
          </div>
        </div>

        <div style="margin-top:1rem" id="videoList">
          ${suggestions.videos.map(v => `
            <div class="video-tile card" data-id="${v.id}">
              <div class="thumb"><iframe src="https://www.youtube.com/embed/${v.id}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe></div>
              <div class="info">
                <h4>${escapeHtml(v.title)}</h4>
                <p class="muted">${escapeHtml(v.channel)}</p>
                <div style="margin-top:6px"><button data-play="${v.id}" class="btn">Play</button></div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div id="rightColumn">
        <!-- video player or suggestions (filled by renderVideoPlayer) -->
        ${state.currentVideo ? '' : `<div class="card"><div class="empty">No video selected — select one to play</div></div>`}
      </div>
    </div>
  `;

  // attach play handlers
  qsa("[data-play]").forEach(btn => btn.addEventListener("click", (e) => {
    const id = btn.getAttribute("data-play");
    const item = LOCAL_VIDEOS.find(v => v.id === id);
    if (item) playVideo(item);
  }));

  if (state.currentVideo) renderVideoPlayer(state.currentVideo);
}

function renderVideoPlayer(item) {
  const rightColumn = el("rightColumn");
  if (!rightColumn) return;
  const iframeHtml = item.type === "youtube"
    ? `<iframe id="videoFrame" src="https://www.youtube.com/embed/${item.id}?autoplay=${state.autoplay?1:0}&rel=0" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`
    : `<div class="thumb card"><img src="${item.thumbnail||''}" alt=""></div>`;

  rightColumn.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:12px">
        <div class="thumb" style="width:52%;height:320px;overflow:hidden;border-radius:10px">${iframeHtml}</div>
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
          <h2 style="margin:0">${escapeHtml(item.title)}</h2>
          <div style="color:var(--muted)">${escapeHtml(item.channel || item.artist || "")}</div>
          <div style="margin-top:auto">
            <button id="favVideoBtn" style="background:var(--accent);border:none;padding:8px;border-radius:8px;color:white;cursor:pointer">★ Favorite</button>
          </div>
        </div>
      </div>
    </div>
  `;

  el("favVideoBtn").addEventListener("click", async () => {
    await put("favorites", { username: state.user?.username || "guest", itemId: item.id, ts: Date.now() });
    alert("Added to favorites (local).");
  });
}

function renderMusic() {
  setActiveNav("#music");
  app.innerHTML = `
    <div>
      <div class="card">
        <h3 style="margin:0">Funtura Music</h3>
        <div class="muted small">Click a track to play</div>
      </div>

      <div style="margin-top:1rem" id="musicList" class="music-list">
        ${LOCAL_SONGS.map(s => `
          <div class="track card" data-song="${s.id}">
            <div class="meta">
              <div style="width:48px;height:48px;border-radius:8px;background:#000"></div>
              <div>
                <div class="title">${escapeHtml(s.title)}</div>
                <small class="muted">${escapeHtml(s.artist)}</small>
              </div>
            </div>
            <div>
              <button class="btn play-song">Play</button>
            </div>
          </div>
        `).join("")}
      </div>

      <div style="margin-top:1rem" id="musicPlayer">
        ${state.currentSong ? `
          <div class="card">
            <div style="display:flex;gap:12px;align-items:center">
              <div style="flex:1">
                <strong>${escapeHtml(state.currentSong.title)}</strong><br>
                <small class="muted">${escapeHtml(state.currentSong.artist)}</small>
              </div>
              <div>
                <audio id="audioPlayer" controls autoplay src="${state.currentSong.src}"></audio>
              </div>
            </div>
          </div>
        ` : `<div class="card"><div class="empty">No song selected</div></div>`}
      </div>
    </div>
  `;

  qsa("[data-song]").forEach(elm => elm.addEventListener("click", () => {
    const id = elm.getAttribute("data-song");
    const item = LOCAL_SONGS.find(s => s.id === id);
    if (item) playSong(item);
  }));
}

async function renderChat() {
  setActiveNav("#chat");
  const messages = await getAll("messages");
  app.innerHTML = `
    <div class="card">
      <h3>Chat</h3>
      <div class="chat-box" id="chatBox">
        ${messages.map(m => `<div class="msg ${m.username === state.user?.username ? 'you' : 'other'}"><strong>${escapeHtml(m.username)}:</strong> ${escapeHtml(m.text)}</div>`).join("")}
      </div>
      <div class="chat-input">
        <input id="chatInput" placeholder="Type a message..." />
        <button id="sendMsgBtn">Send</button>
      </div>
    </div>
  `;
  el("sendMsgBtn").addEventListener("click", async () => {
    const text = el("chatInput").value.trim();
    if (!text) return;
    await put("messages", { username: state.user?.username || "guest", text, ts: Date.now() });
    el("chatInput").value = "";
    renderChat();
  });
}

async function renderLibrary() {
  setActiveNav("#library");
  const favorites = await getAll("favorites");
  const userFavorites = favorites.filter(f => f.username === state.user?.username);
  app.innerHTML = `
    <div class="card">
      <h3>Your Library</h3>
      <div class="muted small">Favorites (local)</div>
      <div class="library-list" style="margin-top:12px">
        ${userFavorites.length ? userFavorites.map(f => `<div class="card">${escapeHtml(f.itemId)}</div>`).join("") : `<div class="empty">No favorites yet.</div>`}
      </div>
    </div>
  `;
}

/* router */
async function router() {
  // ensure login
  const current = localStorage.getItem("funtura_current_user");
  if (current && !state.user) {
    // attempt to load user
    const u = await get("users", current);
    if (u) { state.user = u; }
    else { localStorage.removeItem("funtura_current_user"); }
  }

  // check hash for admin creation token or admin-create
  await tryCreateAdminFromToken(window.location.hash || "");

  // If admin auto-URL configured, try once
  await tryAutoCreateAdminFromUrl();

  const adminExists = !!(await findAdminUser());

  if (!state.user) {
    // show login gate overlay
    showLoginGate();
  } else {
    hideLoginGate();
  }

  // Now route to page
  const hash = window.location.hash || "#home";
  if (!state.user) {
    // still show a minimal home under the overlay — render home beneath
    await renderHome();
    updateUIAfterLogin();
    return;
  }

  if (hash.startsWith("#home")) await renderHome();
  else if (hash.startsWith("#music")) renderMusic();
  else if (hash.startsWith("#chat")) renderChat();
  else if (hash.startsWith("#library")) renderLibrary();
  else renderHome();
}

/* ------------------------------
   UI wiring on load
   ------------------------------ */
window.addEventListener("load", async () => {
  el("year").textContent = new Date().getFullYear();
  await openDB();
  // wire login overlay buttons
  el("lgBtn").addEventListener("click", () => loginWithUsername(el("lgUsername").value));
  el("loginBtn").addEventListener("click", () => loginWithUsername(el("loginInput").value));
  el("loginInput").addEventListener("keydown", (e) => { if (e.key === "Enter") loginWithUsername(el("loginInput").value); });
  el("lgUsername").addEventListener("keydown", (e) => { if (e.key === "Enter") loginWithUsername(el("lgUsername").value); });

  // admin create from UI (manual one-time)
  el("createAdminBtn").addEventListener("click", async () => {
    if (localStorage.getItem("funtura_admin_created")) {
      return alert("Admin already created.");
    }
    const confirmCreate = confirm("Create admin account? This is one-time and will create username 'admin'. Proceed?");
    if (!confirmCreate) return;
    await createUser("admin", { displayName: "Administrator", email: "", isAdmin: true });
    localStorage.setItem("funtura_admin_created", "1");
    alert("Admin created (username: admin). Please sign in.");
  });

  // search
  el("searchBtn").addEventListener("click", async () => {
    const q = el("globalSearch").value.trim();
    if (!q) { alert("Type search text"); return; }
    const { videos, songs } = await performSearch(q);
    // simple display: redirect to music if songs only; else render home with filtered results
    if (videos.length && !songs.length) {
      // show results as suggested videos
      app.innerHTML = `<div class="card"><h3>Video results for "${escapeHtml(q)}"</h3>
        <div style="margin-top:12px">${videos.map(v => `<div class="video-tile card"><div class="thumb"><iframe src="https://www.youtube.com/embed/${v.id}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe></div><div class="info"><h4>${escapeHtml(v.title)}</h4><p class="muted">${escapeHtml(v.channel)}</p></div></div>`).join("")}</div></div>`;
    } else {
      // combine
      app.innerHTML = `<div class="card"><h3>Search results: ${escapeHtml(q)}</h3>
        <div style="margin-top:12px">
          ${videos.length ? `<h4>Videos</h4>${videos.map(v=>`<div class="video-tile card"><div class="thumb"><iframe src="https://www.youtube.com/embed/${v.id}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe></div><div class="info"><h4>${escapeHtml(v.title)}</h4><p class="muted">${escapeHtml(v.channel)}</p></div></div>`).join("")}` : ''}
          ${songs.length ? `<h4>Songs</h4>${songs.map(s=>`<div class="track card"><div class="meta"><div style="width:48px;height:48px;background:#000;border-radius:8px"></div><div><div class="title">${escapeHtml(s.title)}</div><small class="muted">${escapeHtml(s.artist)}</small></div></div></div>`).join("")}` : ''}
        </div>
      </div>`;
    }
  });

  // autoplay toggle
  el("autoplayToggle").addEventListener("change", (e) => {
    state.autoplay = e.target.checked;
    localStorage.setItem("funtura_autoplay", state.autoplay ? "1" : "0");
  });
  const ap = localStorage.getItem("funtura_autoplay");
  if (ap === "1") { state.autoplay = true; el("autoplayToggle").checked = true; }

  // nav links
  qsa(".navlink").forEach(a => a.addEventListener("click", (e) => {
    // allow full router to run on hashchange
  }));

  // load current user from localStorage if present
  const cur = localStorage.getItem("funtura_current_user");
  if (cur) {
    const u = await get("users", cur);
    if (u) state.user = u;
  }

  updateUIAfterLogin();

  // initial router run
  await router();
});

// re-run router on hashchange
window.addEventListener("hashchange", router);

/* ------------------------------
   Small utility: message for login overlay
   ------------------------------ */
function showLoginMsg(text) { el("loginMsg").textContent = text; setTimeout(()=>el("loginMsg").textContent="", 4000); }
