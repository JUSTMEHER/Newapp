const app = document.getElementById("app");
const navLinks = document.querySelectorAll(".nav-link");

function renderHome() {
  app.innerHTML = `
    <section class="video-grid">
      ${[
        "dQw4w9WgXcQ",
        "3JZ_D3ELwOQ",
        "kXYiU_JCYtU",
        "9bZkp7q19f0"
      ].map(
        (id) => `
        <div class="video-card">
          <iframe src="https://www.youtube.com/embed/${id}" 
            frameborder="0" allowfullscreen></iframe>
          <div class="info">
            <h4>Video ${id}</h4>
            <p>Suggested Video</p>
          </div>
        </div>
      `
      ).join("")}
    </section>
  `;
}

function renderMusic() {
  app.innerHTML = `
    <section class="music-container">
      <h2>🎵 StreamHub Music</h2>
      <div class="music-player">
        <audio id="audio-player" controls autoplay>
          <source src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" type="audio/mp3">
        </audio>
      </div>
      <div class="music-list">
        <div class="music-item" onclick="playMusic('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3')">SoundHelix 1</div>
        <div class="music-item" onclick="playMusic('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3')">SoundHelix 2</div>
        <div class="music-item" onclick="playMusic('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3')">SoundHelix 3</div>
      </div>
    </section>
  `;
}

function playMusic(src) {
  const audio = document.getElementById("audio-player");
  audio.src = src;
  audio.play();
}

function renderChat() {
  const messages = JSON.parse(localStorage.getItem("chatMessages") || "[]");
  app.innerHTML = `
    <section class="chat-container">
      <div class="chat-box" id="chat-box">
        ${messages.map(msg => `<div class="chat-message"><span>${msg.user}:</span> ${msg.text}</div>`).join("")}
      </div>
      <div class="chat-input">
        <input type="text" id="chatInput" placeholder="Type a message...">
        <button onclick="sendMessage()">Send</button>
      </div>
    </section>
  `;
}

function sendMessage() {
  const input = document.getElementById("chatInput");
  if (!input.value.trim()) return;
  const messages = JSON.parse(localStorage.getItem("chatMessages") || "[]");
  messages.push({ user: "You", text: input.value });
  localStorage.setItem("chatMessages", JSON.stringify(messages));
  renderChat();
}

function setActiveLink(hash) {
  navLinks.forEach(link => {
    link.classList.toggle("active", link.getAttribute("href") === hash);
  });
}

function router() {
  const hash = window.location.hash || "#home";
  setActiveLink(hash);
  if (hash === "#home") renderHome();
  else if (hash === "#music") renderMusic();
  else if (hash === "#chat") renderChat();
}

window.addEventListener("hashchange", router);
window.addEventListener("load", router);
