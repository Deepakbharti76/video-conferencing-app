// client.js
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

// 👉 NEW buttons (HTML me hone chahiye)
const cameraBtn = document.getElementById("cameraBtn");
const clearChatBtn = document.getElementById("clearChatBtn");
const copyRoomBtn = document.getElementById("copyRoomBtn");
const countEl = document.getElementById("count");

let localStream = null;
let peerConnections = {};
let isMuted = false;
let cameraOff = false;

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// ---------------- MEDIA ----------------
async function startLocalStream() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  localVideo.srcObject = localStream;
}

// ---------------- JOIN ----------------
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

  socket.emit("join-room", { roomId, password, username });
};

// ---------------- SOCKET EVENTS ----------------
socket.on("join-success", async () => {
  if (!localStream) {
    await startLocalStream();
    startActiveSpeakerDetection();
  }
});

socket.on("join-error", (msg) => {
  alert(msg);
});

// participants count
socket.on("participants", (c) => {
  if (countEl) countEl.innerText = "Participants: " + c;
});

// new peer
socket.on("new-peer", ({ id }) => {
  createOffer(id);
});

// signaling
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

// peer disconnected
socket.on("peer-disconnected", (peerId) => {
  if (peerConnections[peerId]) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
  }
  const video = document.getElementById(`video-${peerId}`);
  if (video) video.remove();
});

// ---------------- CHAT ----------------
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

// Enter key support
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

// Clear chat
if (clearChatBtn) {
  clearChatBtn.onclick = () => {
    chatBox.innerHTML = "";
  };
}

// ---------------- WEBRTC ----------------
function createPeerConnection(peerId) {
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
      videoContainer.appendChild(video);
    }
    video.srcObject = e.streams[0];
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

// ---------------- SCREEN SHARE ----------------
shareScreenBtn.onclick = async () => {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const track = stream.getVideoTracks()[0];

  Object.values(peerConnections).forEach((pc) => {
    const sender = pc.getSenders().find((s) => s.track.kind === "video");
    sender.replaceTrack(track);
  });

  track.onended = () => {
    const camTrack = localStream.getVideoTracks()[0];
    Object.values(peerConnections).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track.kind === "video");
      sender.replaceTrack(camTrack);
    });
  };
};

// ---------------- CAMERA ON / OFF ----------------
if (cameraBtn) {
  cameraBtn.onclick = () => {
    const track = localStream.getVideoTracks()[0];
    cameraOff = !cameraOff;
    track.enabled = !cameraOff;
    cameraBtn.innerText = cameraOff ? "Camera On" : "Camera Off";
  };
}

// ---------------- MUTE ----------------
muteBtn.onclick = () => {
  const track = localStream.getAudioTracks()[0];
  isMuted = !isMuted;
  track.enabled = !isMuted;
  muteBtn.innerText = isMuted ? "Mic Off" : "Mic On";
};

// ---------------- COPY ROOM ID ----------------
if (copyRoomBtn) {
  copyRoomBtn.onclick = () => {
    navigator.clipboard.writeText(currentRoom);
    alert("Room ID copied");
  };
}

// ---------------- END CALL ----------------
endCallBtn.onclick = () => {
  Object.values(peerConnections).forEach((pc) => pc.close());
  socket.disconnect();
  location.reload();
};

// ---------------- ACTIVE SPEAKER ----------------
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

// ================= FEEDBACK =================

// HTML me ye elements hone chahiye:
// <textarea id="feedbackText"></textarea>
// <button id="sendFeedbackBtn">Send Feedback</button>

const feedbackText = document.getElementById("feedbackText");
const sendFeedbackBtn = document.getElementById("sendFeedbackBtn");

if (sendFeedbackBtn) {
  sendFeedbackBtn.onclick = () => {
    const feedback = feedbackText.value.trim();

    if (!feedback) {
      alert("Please write feedback");
      return;
    }

    socket.emit("send-feedback", {
      roomId: currentRoom,
      user: myName,
      feedback,
    });

    feedbackText.value = "";
    alert("Thanks for your feedback 🙏");
  };
}
