# API Documentation

WebSocket API reference for PyFileTransfer signaling server.

## Overview

PyFileTransfer uses WebSocket for real-time signaling between peers. The server acts as a message relay to establish WebRTC connections.

## Base URL

```
ws://localhost:8080/ws/{room_id}
wss://your-domain.com/ws/{room_id}
```

Use `wss://` for secure connections in production.

## Connection Flow

```
1. Client connects to WebSocket endpoint
2. Server accepts connection and adds to room
3. Client sends/receives signaling messages
4. WebRTC connection established (P2P)
5. Client disconnects when transfer complete
```

## WebSocket Endpoint

### Connect to Room

**Endpoint**: `GET /ws/{room_id}`

**Parameters**:
- `room_id` (path): Unique room identifier (16-byte token)

**Example**:
```javascript
const ws = new WebSocket('ws://localhost:8080/ws/xh3kJ9mP2nQ8rT4vW6yZ');

ws.onopen = () => {
    console.log('Connected');
};

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log('Received:', message);
};

ws.onerror = (error) => {
    console.error('Error:', error);
};

ws.onclose = () => {
    console.log('Disconnected');
};
```

**Connection Lifecycle**:
1. Client opens WebSocket connection
2. Server adds client to room
3. Server broadcasts `peer-joined` to other peers
4. Clients exchange signaling messages
5. On disconnect, server removes client and broadcasts `peer-disconnected`

## Message Types

All messages are JSON-formatted strings.

### Client → Server Messages

#### 1. Offer (SDP)

Sender creates and sends SDP offer to establish connection.

**Format**:
```json
{
  "type": "offer",
  "sdp": "v=0\r\no=- 1234567890 2 IN IP4 127.0.0.1\r\n..."
}
```

**Fields**:
- `type` (string): Must be "offer"
- `sdp` (string): Session Description Protocol offer

**Example**:
```javascript
const offer = await peerConnection.createOffer();
await peerConnection.setLocalDescription(offer);

ws.send(JSON.stringify({
    type: 'offer',
    sdp: offer.sdp
}));
```

#### 2. Answer (SDP)

Receiver responds with SDP answer.

**Format**:
```json
{
  "type": "answer",
  "sdp": "v=0\r\no=- 9876543210 2 IN IP4 127.0.0.1\r\n..."
}
```

**Fields**:
- `type` (string): Must be "answer"
- `sdp` (string): Session Description Protocol answer

**Example**:
```javascript
const answer = await peerConnection.createAnswer();
await peerConnection.setLocalDescription(answer);

ws.send(JSON.stringify({
    type: 'answer',
    sdp: answer.sdp
}));
```

#### 3. ICE Candidate

Exchange ICE candidates for NAT traversal.

**Format**:
```json
{
  "type": "ice-candidate",
  "candidate": {
    "candidate": "candidate:1 1 UDP 2130706431 192.168.1.100 54321 typ host",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

**Fields**:
- `type` (string): Must be "ice-candidate"
- `candidate` (object): ICE candidate object

**Example**:
```javascript
peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
        ws.send(JSON.stringify({
            type: 'ice-candidate',
            candidate: event.candidate
        }));
    }
};
```

#### 4. Metadata

Sender shares file information (not through WebSocket in current implementation, but via data channel).

**Format**:
```json
{
  "type": "metadata",
  "files": [
    {
      "name": "document.pdf",
      "size": 1048576,
      "type": "application/pdf"
    }
  ]
}
```

**Fields**:
- `type` (string): Must be "metadata"
- `files` (array): List of file objects
  - `name` (string): File name
  - `size` (number): File size in bytes
  - `type` (string): MIME type

#### 5. Peer Joined

Notify server that peer has joined (receiver only).

**Format**:
```json
{
  "type": "peer-joined"
}
```

**Fields**:
- `type` (string): Must be "peer-joined"

**Example**:
```javascript
ws.onopen = () => {
    ws.send(JSON.stringify({
        type: 'peer-joined'
    }));
};
```

#### 6. Ping

Keep connection alive.

**Format**:
```json
{
  "type": "ping"
}
```

**Response**:
```json
{
  "type": "pong"
}
```

**Example**:
```javascript
setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
    }
}, 30000); // Every 30 seconds
```

### Server → Client Messages

#### 1. Offer (Relayed)

Server forwards offer from sender to receiver.

**Format**:
```json
{
  "type": "offer",
  "sdp": "v=0\r\no=- 1234567890 2 IN IP4 127.0.0.1\r\n..."
}
```

**Handling**:
```javascript
if (message.type === 'offer') {
    await peerConnection.setRemoteDescription(
        new RTCSessionDescription({
            type: 'offer',
            sdp: message.sdp
        })
    );
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    ws.send(JSON.stringify({
        type: 'answer',
        sdp: answer.sdp
    }));
}
```

#### 2. Answer (Relayed)

Server forwards answer from receiver to sender.

**Format**:
```json
{
  "type": "answer",
  "sdp": "v=0\r\no=- 9876543210 2 IN IP4 127.0.0.1\r\n..."
}
```

**Handling**:
```javascript
if (message.type === 'answer') {
    await peerConnection.setRemoteDescription(
        new RTCSessionDescription({
            type: 'answer',
            sdp: message.sdp
        })
    );
}
```

#### 3. ICE Candidate (Relayed)

Server forwards ICE candidates between peers.

**Format**:
```json
{
  "type": "ice-candidate",
  "candidate": {
    "candidate": "...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

**Handling**:
```javascript
if (message.type === 'ice-candidate' && message.candidate) {
    await peerConnection.addIceCandidate(
        new RTCIceCandidate(message.candidate)
    );
}
```

#### 4. Peer Joined

Notifies sender that receiver has joined.

**Format**:
```json
{
  "type": "peer-joined"
}
```

**Handling**:
```javascript
if (message.type === 'peer-joined') {
    // Create and send offer
    await createPeerConnection();
    await createOffer();
}
```

#### 5. Peer Disconnected

Notifies when other peer disconnects.

**Format**:
```json
{
  "type": "peer-disconnected"
}
```

**Handling**:
```javascript
if (message.type === 'peer-disconnected') {
    console.log('Peer disconnected');
    // Clean up connection
    peerConnection.close();
}
```

#### 6. Pong

Response to ping message.

**Format**:
```json
{
  "type": "pong"
}
```

## HTTP Endpoints

### Get Room Information

**Endpoint**: `GET /api/room/{room_id}/info`

**Response**:
```json
{
  "exists": true,
  "info": {
    "created_at": "2024-02-09T10:30:00",
    "peer_count": 2
  }
}
```

**Example**:
```javascript
const response = await fetch('/api/room/xh3kJ9mP2nQ8rT4vW6yZ/info');
const data = await response.json();

if (data.exists) {
    console.log('Room exists with', data.info.peer_count, 'peers');
}
```

### Health Check

**Endpoint**: `GET /health`

**Response**:
```json
{
  "status": "healthy",
  "active_rooms": 5,
  "timestamp": "2024-02-09T10:30:00"
}
```

**Example**:
```javascript
const response = await fetch('/health');
const health = await response.json();

if (health.status === 'healthy') {
    console.log('Server is healthy');
}
```

## Complete Example

### Sender Implementation

```javascript
class FileSender {
    constructor(roomId) {
        this.roomId = roomId;
        this.ws = null;
        this.peerConnection = null;
        this.dataChannel = null;
    }
    
    connect() {
        const wsUrl = `ws://localhost:8080/ws/${this.roomId}`;
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
        };
        
        this.ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            await this.handleMessage(message);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }
    
    async handleMessage(message) {
        switch (message.type) {
            case 'peer-joined':
                await this.createOffer();
                break;
                
            case 'answer':
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription({
                        type: 'answer',
                        sdp: message.sdp
                    })
                );
                break;
                
            case 'ice-candidate':
                if (message.candidate) {
                    await this.peerConnection.addIceCandidate(
                        new RTCIceCandidate(message.candidate)
                    );
                }
                break;
        }
    }
    
    async createOffer() {
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        };
        
        this.peerConnection = new RTCPeerConnection(config);
        
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    candidate: event.candidate
                }));
            }
        };
        
        this.dataChannel = this.peerConnection.createDataChannel('fileTransfer');
        
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        
        this.ws.send(JSON.stringify({
            type: 'offer',
            sdp: offer.sdp
        }));
    }
}
```

### Receiver Implementation

```javascript
class FileReceiver {
    constructor(roomId) {
        this.roomId = roomId;
        this.ws = null;
        this.peerConnection = null;
    }
    
    connect() {
        const wsUrl = `ws://localhost:8080/ws/${this.roomId}`;
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.ws.send(JSON.stringify({
                type: 'peer-joined'
            }));
        };
        
        this.ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            await this.handleMessage(message);
        };
    }
    
    async handleMessage(message) {
        switch (message.type) {
            case 'offer':
                await this.createAnswer(message.sdp);
                break;
                
            case 'ice-candidate':
                if (message.candidate && this.peerConnection) {
                    await this.peerConnection.addIceCandidate(
                        new RTCIceCandidate(message.candidate)
                    );
                }
                break;
        }
    }
    
    async createAnswer(sdp) {
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        };
        
        this.peerConnection = new RTCPeerConnection(config);
        
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    candidate: event.candidate
                }));
            }
        };
        
        this.peerConnection.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            // Setup data channel handlers
        };
        
        await this.peerConnection.setRemoteDescription(
            new RTCSessionDescription({
                type: 'offer',
                sdp: sdp
            })
        );
        
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        
        this.ws.send(JSON.stringify({
            type: 'answer',
            sdp: answer.sdp
        }));
    }
}
```

## Error Handling

### Connection Errors

```javascript
ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    // Retry logic
    setTimeout(() => {
        this.connect();
    }, 1000);
};

ws.onclose = (event) => {
    if (!event.wasClean) {
        console.error('Connection died');
        // Handle unexpected disconnection
    }
};
```

### WebRTC Errors

```javascript
peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    console.log('Connection state:', state);
    
    if (state === 'failed') {
        // Connection failed, handle error
        console.error('WebRTC connection failed');
    }
};
```

## Rate Limiting

Currently no built-in rate limiting. For production, consider implementing:

- Connection rate limits per IP
- Message rate limits per connection
- Room creation limits

## Security Considerations

1. **Use WSS**: Always use secure WebSocket (wss://) in production
2. **Validate Messages**: Validate all incoming messages
3. **Room ID Security**: Use cryptographically secure random IDs
4. **CORS**: Configure appropriate CORS policies
5. **Authentication**: Consider adding authentication for sensitive deployments

## Testing

### Test WebSocket Connection

```bash
# Install wscat
npm install -g wscat

# Connect to room
wscat -c ws://localhost:8080/ws/test-room

# Send message
> {"type":"ping"}

# Receive response
< {"type":"pong"}
```

### Test with Browser Console

```javascript
const ws = new WebSocket('ws://localhost:8080/ws/test-room');
ws.onopen = () => console.log('Connected');
ws.onmessage = (e) => console.log('Message:', e.data);
ws.send(JSON.stringify({type: 'ping'}));
```

## Additional Resources

- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection)
- [RTCDataChannel](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel)
