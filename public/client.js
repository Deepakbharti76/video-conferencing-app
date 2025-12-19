// client.js
const socket = io();
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('room');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

let localStream = null;
let peerConnections = {}; // key: socketId, value: RTCPeerConnection
const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' } // public STUN
  ]
};

async function startLocalStream() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
}

joinBtn.onclick = async () => {
  if (!localStream) await startLocalStream();
  const roomId = roomInput.value.trim();
  if (!roomId) return alert('Enter room name');

  socket.emit('join-room', roomId);
  joinBtn.disabled = true;
};

// when another peer already in room notifies you
socket.on('new-peer', async (peerId) => {
  console.log('New peer in room:', peerId);
  await createOffer(peerId);
});

// when someone sends a signal (offer/answer/ice)
socket.on('signal', async ({ from, data }) => {
  let pc = peerConnections[from];
  if (!pc) {
    pc = createPeerConnection(from);
  }

  if (data.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { to: from, data: pc.localDescription });
  } else if (data.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
  } else if (data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.warn('Error adding ICE candidate', e);
    }
  }
});

socket.on('peer-disconnected', (peerId) => {
  console.log('Peer disconnected:', peerId);
  const pc = peerConnections[peerId];
  if (pc) {
    pc.close();
    delete peerConnections[peerId];
  }
  remoteVideo.srcObject = null;
});

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(config);
  peerConnections[peerId] = pc;

  // add local tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { to: peerId, data: { candidate: event.candidate } });
    }
  };

  pc.ontrack = (event) => {
    // when remote stream arrives, show it (for simple demo we assume one remote stream)
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onconnectionstatechange = () => {
    console.log('Connection state:', pc.connectionState);
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      pc.close();
      delete peerConnections[peerId];
    }
  };

  return pc;
}

async function createOffer(peerId) {
  const pc = createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('signal', { to: peerId, data: pc.localDescription });
}
