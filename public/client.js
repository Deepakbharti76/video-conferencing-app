// ================= GLOBAL VARIABLES =================
let currentRoom = null;
let myName = "Guest";
let mySocketId = null;

const socket = io();

// DOM Elements
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
const participantCount = document.getElementById("participantCount");
const participantsList = document.getElementById("participantsList");

const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");
const sidebar = document.getElementById("sidebar");

let localStream = null;
let screenStream = null;
let peerConnections = {};
let participants = {};
let isMuted = false;
let cameraOff = false;
let isScreenSharing = false;

// Meeting timer
let meetingStartTime = null;
let timerInterval = null;

// ================= ICE CONFIG =================
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
};

// ================= TAB SWITCHING =================
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const targetTab = button.getAttribute("data-tab");

    // Remove active from all
    tabButtons.forEach((btn) => btn.classList.remove("active"));
    tabContents.forEach((content) => content.classList.remove("active"));

    // Add active to clicked
    button.classList.add("active");
    document.getElementById(targetTab + "Tab").classList.add("active");
  });
});

// ================= SIDEBAR TOGGLE =================
if (toggleSidebarBtn) {
  toggleSidebarBtn.addEventListener("click", () => {
    sidebar.classList.toggle("hidden");
  });
}

// ================= MEDIA =================
async function startLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: true,
    });

    localVideo.srcObject = localStream;
    localVideo.muted = true;
    localVideo.playsInline = true;

    await localVideo.play().catch(() => {});

    // Start meeting timer
    if (!meetingStartTime) {
      meetingStartTime = Date.now();
      startMeetingTimer();
    }
  } catch (err) {
    alert("Camera / Mic permission required");
    console.error(err);
  }
}

// ================= MEETING TIMER =================
function startMeetingTimer() {
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - meetingStartTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    const timerEl = document.getElementById("meetingTimer");
    if (timerEl) {
      timerEl.textContent = `${String(minutes).padStart(2, "0")}:${String(
        seconds
      ).padStart(2, "0")}`;
    }
  }, 1000);
}

// ================= JOIN ROOM =================
joinBtn.onclick = () => {
  const roomId = roomInput.value.trim();
  const password = passwordInput.value;
  const username = usernameInput.value.trim() || "Guest";

  if (!roomId || !password) {
    alert("Room name & password required");
    return;
  }

  currentRoom = roomId;
  myName = username;

  // Disable inputs
  roomInput.disabled = true;
  passwordInput.disabled = true;
  usernameInput.disabled = true;
  joinBtn.disabled = true;

  socket.emit("join-room", { roomId, password, username });
};

// ================= SOCKET EVENTS =================
socket.on("connect", () => {
  mySocketId = socket.id;
  console.log("Connected:", mySocketId);
});

socket.on("join-success", async ({ users, count }) => {
  console.log("Join success! Existing users:", users);

  // Start camera
  if (!localStream) {
    await startLocalStream();
    startActiveSpeakerDetection();
  }

  // Update UI
  updateParticipantCount(count);

  // Add yourself to participants
  participants[mySocketId] = {
    id: mySocketId,
    name: myName,
    muted: false,
    videoOff: false,
  };
  updateParticipantsList();

  // Create connections with existing users
  if (users && users.length > 0) {
    users.forEach(({ id, name }) => {
      participants[id] = {
        id,
        name,
        muted: false,
        videoOff: false,
      };
    });
    updateParticipantsList();

    setTimeout(() => {
      users.forEach(({ id }) => {
        console.log("Creating offer for existing user:", id);
        createOffer(id);
      });
    }, 1000);
  }
});

socket.on("join-error", (msg) => {
  alert(msg);

  // Re-enable inputs
  roomInput.disabled = false;
  passwordInput.disabled = false;
  usernameInput.disabled = false;
  joinBtn.disabled = false;
});

socket.on("participants", (c) => {
  updateParticipantCount(c);
});

socket.on("new-peer", async ({ id, name }) => {
  console.log("New peer joined:", id, name);

  participants[id] = {
    id,
    name,
    muted: false,
    videoOff: false,
  };
  updateParticipantsList();

  if (!localStream) {
    await startLocalStream();
  }
});

socket.on("signal", async ({ from, data }) => {
  console.log("Signal from", from, "type:", data.type || "candidate");

  let pc = peerConnections[from];

  if (data.type === "offer") {
    if (!pc) {
      pc = createPeerConnection(from);
    }

    await pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("signal", { to: from, data: pc.localDescription });
  } else if (data.type === "answer") {
    if (!pc) {
      console.error("No peer connection for answer");
      return;
    }
    await pc.setRemoteDescription(new RTCSessionDescription(data));
  } else if (data.candidate) {
    if (!pc) {
      console.error("No peer connection for ICE candidate");
      return;
    }
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

socket.on("peer-disconnected", (peerId) => {
  console.log("Peer disconnected:", peerId);

  if (peerConnections[peerId]) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
  }

  delete participants[peerId];
  updateParticipantsList();

  const videoWrapper = document.getElementById(`video-${peerId}`);
  if (videoWrapper) videoWrapper.remove();
});

// ================= CHAT =================
sendBtn.onclick = sendMessage;

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

function sendMessage() {
  const msg = chatInput.value.trim();
  if (!msg || !currentRoom) return;

  socket.emit("chat-message", {
    roomId: currentRoom,
    sender: myName,
    message: msg,
  });

  addMessage("You", msg);
  chatInput.value = "";
}

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
  console.log("Creating peer connection with:", peerId);

  const pc = new RTCPeerConnection(config);
  peerConnections[peerId] = pc;

  const streamToShare = isScreenSharing ? screenStream : localStream;
  if (streamToShare) {
    streamToShare.getTracks().forEach((track) => {
      pc.addTrack(track, streamToShare);
    });
  }

  pc.ontrack = (e) => {
    console.log("Received track from:", peerId);

    let videoWrapper = document.getElementById(`video-${peerId}`);
    if (!videoWrapper) {
      videoWrapper = document.createElement("div");
      videoWrapper.id = `video-${peerId}`;
      videoWrapper.className = "video-wrapper";

      const video = document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      video.muted = false;

      const overlay = document.createElement("div");
      overlay.className = "video-overlay";

      const participantName = participants[peerId]?.name || "Unknown";
      overlay.innerHTML = `
        <div class="video-name">${participantName}</div>
        <div class="video-status">
          <span class="status-icon mic-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2h2v2a5 5 0 0010 0v-2h2z"/>
            </svg>
          </span>
        </div>
      `;

      videoWrapper.appendChild(video);
      videoWrapper.appendChild(overlay);
      videoContainer.appendChild(videoWrapper);
    }

    const video = videoWrapper.querySelector("video");
    if (!video.srcObject) {
      video.srcObject = e.streams[0];
    }

    video.play().catch(() => {});
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("signal", {
        to: peerId,
        data: { candidate: e.candidate },
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log("Connection state:", pc.connectionState);
    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "disconnected"
    ) {
      const videoWrapper = document.getElementById(`video-${peerId}`);
      if (videoWrapper) videoWrapper.remove();
    }
  };

  return pc;
}

async function createOffer(peerId) {
  const pc = createPeerConnection(peerId);

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { to: peerId, data: pc.localDescription });
  } catch (err) {
    console.error("Error creating offer:", err);
  }
}

// ================= SCREEN SHARE =================
async function replaceTracksForAllPeers(newStream) {
  const videoTrack = newStream.getVideoTracks()[0];

  for (const peerId in peerConnections) {
    const pc = peerConnections[peerId];
    const senders = pc.getSenders();
    const videoSender = senders.find(
      (s) => s.track && s.track.kind === "video"
    );

    if (videoSender) {
      try {
        await videoSender.replaceTrack(videoTrack);
      } catch (err) {
        console.error("Error replacing track:", err);
      }
    }
  }
}

if (shareScreenBtn) {
  shareScreenBtn.onclick = async () => {
    if (!isScreenSharing) {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: "always" },
          audio: false,
        });

        localVideo.srcObject = screenStream;
        localVideo.style.transform = "scaleX(1)";

        await replaceTracksForAllPeers(screenStream);

        isScreenSharing = true;
        shareScreenBtn.classList.add("active");

        screenStream.getVideoTracks()[0].onended = () => {
          stopScreenShare();
        };
      } catch (err) {
        console.error("Screen share error:", err);
      }
    } else {
      stopScreenShare();
    }
  };
}

async function stopScreenShare() {
  if (!isScreenSharing) return;

  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
  }

  localVideo.srcObject = localStream;
  localVideo.style.transform = "scaleX(-1)";

  if (localStream) {
    await replaceTracksForAllPeers(localStream);
  }

  isScreenSharing = false;
  shareScreenBtn.classList.remove("active");
}

// ================= CAMERA / MIC =================
if (cameraBtn) {
  cameraBtn.onclick = () => {
    if (!localStream) return;

    const track = localStream.getVideoTracks()[0];
    cameraOff = !cameraOff;
    track.enabled = !cameraOff;

    cameraBtn.classList.toggle("active", cameraOff);

    if (participants[mySocketId]) {
      participants[mySocketId].videoOff = cameraOff;
      updateParticipantsList();
    }
  };
}

muteBtn.onclick = () => {
  if (!localStream) return;

  const track = localStream.getAudioTracks()[0];
  isMuted = !isMuted;
  track.enabled = !isMuted;

  muteBtn.classList.toggle("active", isMuted);

  const localMicStatus = document.getElementById("localMicStatus");
  if (localMicStatus) {
    localMicStatus.classList.toggle("muted", isMuted);
  }

  if (participants[mySocketId]) {
    participants[mySocketId].muted = isMuted;
    updateParticipantsList();
  }
};

// ================= END CALL =================
endCallBtn.onclick = () => {
  if (confirm("Are you sure you want to leave the meeting?")) {
    Object.values(peerConnections).forEach((pc) => pc.close());
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
    }
    if (timerInterval) {
      clearInterval(timerInterval);
    }
    socket.disconnect();
    location.reload();
  }
};

// ================= ACTIVE SPEAKER =================
function startActiveSpeakerDetection() {
  if (!localStream) return;

  try {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    const src = ctx.createMediaStreamSource(localStream);
    src.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);

    const detect = () => {
      analyser.getByteFrequencyData(data);
      const vol = data.reduce((a, b) => a + b) / data.length;

      const mainVideo = document.querySelector(".main-video");
      if (mainVideo) {
        mainVideo.classList.toggle("active-speaker", vol > 25);
      }

      requestAnimationFrame(detect);
    };

    detect();
  } catch (err) {
    console.log("Audio context error:", err);
  }
}

// ================= COPY ROOM ID =================
if (copyRoomBtn) {
  copyRoomBtn.onclick = () => {
    const roomId = roomInput.value.trim();
    if (roomId) {
      navigator.clipboard.writeText(roomId).then(() => {
        alert("Room ID copied to clipboard!");
      });
    }
  };
}

// ================= PARTICIPANTS LIST =================
function updateParticipantCount(count) {
  if (countEl) countEl.textContent = `Participants: ${count}`;
  if (participantCount) participantCount.textContent = count;
}

function updateParticipantsList() {
  if (!participantsList) return;

  participantsList.innerHTML = "";

  Object.values(participants).forEach((participant) => {
    const item = document.createElement("div");
    item.className = "participant-item";

    const initials = participant.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

    item.innerHTML = `
      <div class="participant-avatar">${initials}</div>
      <div class="participant-info">
        <div class="participant-name">${participant.name}${
      participant.id === mySocketId ? " (You)" : ""
    }</div>
        <div class="participant-status">Active</div>
      </div>
      <div class="participant-icons">
        <div class="status-badge ${participant.muted ? "muted" : "unmuted"}">
          ${
            participant.muted
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2h2v2a5 5 0 0010 0v-2h2z"/><line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" stroke-width="2"/></svg>'
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2h2v2a5 5 0 0010 0v-2h2z"/></svg>'
          }
        </div>
      </div>
    `;

    participantsList.appendChild(item);
  });
}

// ================= FEEDBACK =================
const sendFeedbackBtn = document.getElementById("sendFeedbackBtn");
const feedbackText = document.getElementById("feedbackText");

if (sendFeedbackBtn && feedbackText) {
  sendFeedbackBtn.onclick = () => {
    const feedback = feedbackText.value.trim();

    if (!feedback) {
      alert("Please write some feedback first!");
      return;
    }

    if (!currentRoom || !myName) {
      alert("Please join a room first!");
      return;
    }

    socket.emit("send-feedback", {
      roomId: currentRoom,
      user: myName,
      feedback: feedback,
    });

    feedbackText.value = "";
    alert("Thank you! Your feedback has been submitted.");
  };
}

// ================= MOBILE CHECK =================
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if (isMobile && shareScreenBtn) {
  shareScreenBtn.disabled = true;
  shareScreenBtn.title = "Screen Share (Desktop only)";
  shareScreenBtn.style.opacity = "0.5";
}

console.log("VidChat Pro initialized!");
