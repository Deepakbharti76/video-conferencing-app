// client.js
const socket = io();

const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("room");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

// Chat elements
const chatBox = document.getElementById("chatBox");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

let localStream = null;
let peerConnections = {}; // key: socketId, value: RTCPeerConnection

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// -------------------- MEDIA --------------------
async function startLocalStream() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  localVideo.srcObject = localStream;
}

// -------------------- JOIN ROOM --------------------
joinBtn.onclick = async () => {
  const roomId = roomInput.value.trim();
  if (!roomId) {
    alert("Enter room name");
    return;
  }

  if (!localStream) {
    await startLocalStream();
  }

  socket.emit("join-room", roomId);
  joinBtn.disabled = true;
};

// -------------------- SOCKET EVENTS --------------------
socket.on("new-peer", async (peerId) => {
  await createOffer(peerId);
});

socket.on("signal", async ({ from, data }) => {
  let pc = peerConnections[from];
  if (!pc) pc = createPeerConnection(from);

  if (data.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal", { to: from, data: pc.localDescription });
  } else if (data.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
  } else if (data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.log(e);
    }
  }
});

socket.on("peer-disconnected", (peerId) => {
  if (peerConnections[peerId]) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
  }
  remoteVideo.srcObject = null;
});

// -------------------- CHAT --------------------
sendBtn.onclick = () => {
  const msg = chatInput.value.trim();
  if (!msg) return;

  socket.emit("chat-message", msg);
  addMessage("You", msg);
  chatInput.value = "";
};

socket.on("chat-message", (msg) => {
  addMessage("Peer", msg);
});

function addMessage(sender, message) {
  const p = document.createElement("p");
  p.innerHTML = `<b>${sender}:</b> ${message}`;
  chatBox.appendChild(p);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// -------------------- WEBRTC HELPERS --------------------
function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(config);
  peerConnections[peerId] = pc;

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", {
        to: peerId,
        data: { candidate: event.candidate },
      });
    }
  };

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  return pc;
}

async function createOffer(peerId) {
  const pc = createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { to: peerId, data: pc.localDescription });
}

// -------------------- SCREEN SHARE --------------------

shareScreenBtn.onclick = async () => {
  if (Object.keys(peerConnections).length === 0) {
    alert("No peer connected. Join from another device first.");
    return;
  }

  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });

    const screenTrack = screenStream.getVideoTracks()[0];

    Object.values(peerConnections).forEach((pc) => {
      const sender = pc
        .getSenders()
        .find((s) => s.track && s.track.kind === "video");
      if (sender) sender.replaceTrack(screenTrack);
    });

    screenTrack.onended = () => {
      const cameraTrack = localStream.getVideoTracks()[0];
      Object.values(peerConnections).forEach((pc) => {
        const sender = pc
          .getSenders()
          .find((s) => s.track && s.track.kind === "video");
        if (sender) sender.replaceTrack(cameraTrack);
      });
    };
  } catch (err) {
    console.error(err);
    alert("Screen share failed: permission or browser issue");
  }
};

// MUTE / UNMUTE
console.log("Mute button:", muteBtn);


const muteBtn = document.getElementById("muteBtn");
let isMuted = false;

muteBtn.onclick = () => {
  if (!localStream) {
    alert("Join the call first");
    return;
  }

  const audioTrack = localStream.getAudioTracks()[0];
  isMuted = !isMuted;
  audioTrack.enabled = !isMuted;

  muteBtn.innerText = isMuted ? "Unmute" : "Mute";
};





// ❌ END CALL

console.log("EndCall button:", endCallBtn);

const endCallBtn = document.getElementById("endCallBtn");

endCallBtn.onclick = () => {
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  socket.disconnect();
  alert("Call ended");
  location.reload();
};
