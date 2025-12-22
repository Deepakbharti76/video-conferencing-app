// ================= GLOBAL =================
let currentRoom = null;
let myName = "Guest";

const socket = io();

const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("room");
const passwordInput = document.getElementById("roomPassword");
const usernameInput = document.getElementById("username");

const localVideo = document.getElementById("localVideo");
const videoContainer = document.getElementById("videoContainer");

const chatBox = document.getElementById("chatBox");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

const shareScreenBtn = document.getElementById("shareScreenBtn");
const muteBtn = document.getElementById("muteBtn");
const endCallBtn = document.getElementById("endCallBtn");

const cameraBtn = document.getElementById("cameraBtn");
const clearChatBtn = document.getElementById("clearChatBtn");
const copyRoomBtn = document.getElementById("copyRoomBtn");
const countEl = document.getElementById("count");

let localStream = null;
let peerConnections = {};
let connectedPeers = new Set();

let isMuted = false;
let cameraOff = false;
let usingFrontCamera = true;

// ================= ICE (mobile friendly) =================
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
};

// ================= MEDIA =================
async function startLocalStream() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: true,
  });

  localVideo.srcObject = localStream;
  localVideo.muted = true; // local always muted
  localVideo.playsInline = true;
  await localVideo.play().catch(() => {});
}

// ================= JOIN =================
joinBtn.onclick = () => {
  const roomId = roomInput.value.trim();
  const password = passwordInput.value;
  const username = usernameInput.value || "Guest";

  if (!roomId || !password) {
    alert("Room name & password required");
    return;
  }

  currentRoom = roomId;
  myName = username;

  // ❌ camera yahan start nahi hoga
  socket.emit("join-room", { roomId, password, username });
};

// ================= SOCKET =================
socket.on("join-success", async ({ users, count }) => {
  // camera start
  if (!localStream) {
    await startLocalStream();
    startActiveSpeakerDetection();
  }

  // participants count
  if (countEl) countEl.innerText = "Participants: " + count;

  // 🔥 VERY IMPORTANT FIX
  // new user must call existing users
  if (Array.isArray(users)) {
    users.forEach((u) => {
      createOffer(u.id);
    });
  }
});

socket.on("join-error", (msg) => alert(msg));

socket.on("participants", (c) => {
  if (countEl) countEl.innerText = "Participants: " + c;
});

// ================= NEW PEER =================
socket.on("new-peer", ({ id }) => {
  if (connectedPeers.has(id)) return;
  connectedPeers.add(id);
  createOffer(id);
});

// ================= SIGNAL =================
socket.on("signal", async ({ from, data }) => {
  let pc = peerConnections[from];
  if (!pc) pc = createPeerConnection(from);

  if (data.type === "offer") {
    await pc.setRemoteDescription(data);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal", { to: from, data: pc.localDescription });
  } else if (data.type === "answer") {
    await pc.setRemoteDescription(data);
  } else if (data.candidate) {
    await pc.addIceCandidate(data.candidate);
  }
});

// ================= PEER DISCONNECT =================
socket.on("peer-disconnected", (peerId) => {
  connectedPeers.delete(peerId);

  if (peerConnections[peerId]) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
  }

  const video = document.getElementById(`video-${peerId}`);
  if (video) video.remove();
});

// ================= CHAT =================
sendBtn.onclick = () => {
  const msg = chatInput.value.trim();
  if (!msg || !currentRoom) return;

  socket.emit("chat-message", {
    roomId: currentRoom,
    sender: myName,
    message: msg,
  });

  addMessage("You", msg);
  chatInput.value = "";
};

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.click();
});

socket.on("chat-message", ({ sender, message }) => {
  addMessage(sender, message);
});

function addMessage(sender, msg) {
  const p = document.createElement("p");
  p.innerHTML = `<b>${sender}:</b> ${msg}`;
  chatBox.appendChild(p);
  chatBox.scrollTop = chatBox.scrollHeight;
}

if (clearChatBtn) {
  clearChatBtn.onclick = () => (chatBox.innerHTML = "");
}

// ================= WEBRTC =================
function createPeerConnection(peerId) {
  if (peerConnections[peerId]) return peerConnections[peerId];

  const pc = new RTCPeerConnection(config);
  peerConnections[peerId] = pc;

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.ontrack = (e) => {
    let video = document.getElementById(`video-${peerId}`);
    if (!video) {
      video = document.createElement("video");
      video.id = `video-${peerId}`;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = false; // remote audio ON
      videoContainer.appendChild(video);
    }

    if (video.srcObject !== e.streams[0]) {
      video.srcObject = e.streams[0];
      video.play().catch(() => {});
    }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("signal", {
        to: peerId,
        data: { candidate: e.candidate },
      });
    }
  };

  return pc;
}

async function createOffer(peerId) {
  const pc = createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { to: peerId, data: pc.localDescription });
}

// ================= CAMERA SWITCH (MOBILE) =================
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

if (cameraBtn && isMobile) {
  cameraBtn.onclick = async () => {
    usingFrontCamera = !usingFrontCamera;

    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: usingFrontCamera ? "user" : "environment" },
      audio: true,
    });

    const newVideoTrack = newStream.getVideoTracks()[0];

    Object.values(peerConnections).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track.kind === "video");
      if (sender) sender.replaceTrack(newVideoTrack);
    });

    localStream.getTracks().forEach((t) => t.stop());
    localStream = newStream;
    localVideo.srcObject = newStream;
    localVideo.play().catch(() => {});
  };
}

// ================= MIC =================
muteBtn.onclick = () => {
  const track = localStream.getAudioTracks()[0];
  isMuted = !isMuted;
  track.enabled = !isMuted;
  muteBtn.innerText = isMuted ? "Mic Off" : "Mic On";
};

// ================= COPY ROOM =================
if (copyRoomBtn) {
  copyRoomBtn.onclick = () => {
    navigator.clipboard.writeText(currentRoom);
    alert("Room ID copied");
  };
}

// ================= END CALL =================
endCallBtn.onclick = () => {
  Object.values(peerConnections).forEach((pc) => pc.close());
  socket.disconnect();
  location.reload();
};

// ================= ACTIVE SPEAKER =================
function startActiveSpeakerDetection() {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  const src = ctx.createMediaStreamSource(localStream);
  src.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);

  const detect = () => {
    analyser.getByteFrequencyData(data);
    const vol = data.reduce((a, b) => a + b) / data.length;
    localVideo.classList.toggle("active-speaker", vol > 25);
    requestAnimationFrame(detect);
  };
  detect();
}

// ================= MOBILE SCREEN SHARE DISABLE =================
if (isMobile && shareScreenBtn) {
  shareScreenBtn.disabled = true;
  shareScreenBtn.innerText = "Screen Share (PC only)";
}
