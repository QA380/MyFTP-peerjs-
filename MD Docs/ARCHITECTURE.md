# Architecture Overview

This document describes the architecture, components, and design decisions of PyFileTransfer.

## Table of Contents

- [High-Level Architecture](#high-level-architecture)
- [Components](#components)
- [Data Flow](#data-flow)
- [WebRTC Connection Establishment](#webrtc-connection-establishment)
- [File Transfer Protocol](#file-transfer-protocol)
- [Security Model](#security-model)
- [Scalability Considerations](#scalability-considerations)

## High-Level Architecture

PyFileTransfer follows a signaling server + peer-to-peer architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                            │
│  ┌──────────────────┐                    ┌──────────────────┐   │
│  │  Sender Browser  │                    │ Receiver Browser │   │
│  │                  │                    │                  │   │
│  │  - File Input    │                    │  - File Preview  │   │
│  │  - WebRTC Client │                    │  - WebRTC Client │   │
│  │  - Progress UI   │                    │  - Download      │   │
│  └────────┬─────────┘                    └──────────┬───────┘   │
│           │                                         │           │
└───────────┼─────────────────────────────────────────┼───────────┘
            │                                         │
            │         Signaling (WebSocket)           │
            │                                         │
┌───────────┼─────────────────────────────────────────┼──────────┐
│           ▼                                         ▼          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              FastAPI Application Server                  │  │
│  │                                                          │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │           WebSocket Signaling Server               │  │  │
│  │  │  - Room Management                                 │  │  │
│  │  │  - SDP Exchange (Offer/Answer)                     │  │  │
│  │  │  - ICE Candidate Exchange                          │  │  │
│  │  │  - Connection State Management                     │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                          │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │              HTTP Server                           │  │  │
│  │  │  - Static File Serving                             │  │  │
│  │  │  - Template Rendering                              │  │  │
│  │  │  - Health Check Endpoint                           │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
            │                                         │
            │                                         │
            │      Peer-to-Peer (WebRTC Data Channel) │
            └─────────────────┬───────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   File Transfer    │
                    │   (Direct P2P)     │
                    │  - No Server       │
                    │  - Encrypted       │
                    │  - Chunked         │
                    └────────────────────┘
```

## Components

### 1. FastAPI Server (`src/main.py`)

**Purpose**: Provides web interface and WebRTC signaling coordination.

**Responsibilities**:
- Serve HTML/CSS/JS files
- Manage WebSocket connections
- Coordinate signaling between peers
- Track active rooms and connections
- Health monitoring

**Technology Stack**:
- FastAPI: Async web framework
- Uvicorn: ASGI server
- Jinja2: Template engine
- WebSockets: Real-time communication

**Key Features**:
- Async/await for concurrent connections
- Room-based connection management
- Automatic cleanup of inactive rooms
- Health check endpoint
- Structured logging

### 2. Connection Manager

**Purpose**: Manages WebSocket connections and room state.

**Data Structures**:
```python
active_rooms: Dict[str, Set[WebSocket]]
room_metadata: Dict[str, dict]
```

**Operations**:
- `connect(room_id, websocket)`: Add peer to room
- `disconnect(room_id, websocket)`: Remove peer from room
- `broadcast(room_id, message, sender)`: Send to all peers except sender
- `send_to_peer(websocket, message)`: Send to specific peer

### 3. WebRTC Client (JavaScript)

**Sender** (`static/js/sender.js`):
- File selection and validation
- WebRTC peer connection setup
- SDP offer creation
- File chunking and transmission
- Progress tracking
- QR code generation

**Receiver** (`static/js/receiver.js`):
- WebRTC peer connection setup
- SDP answer creation
- File metadata preview
- Chunk reception and reassembly
- Automatic file download
- Progress tracking

### 4. Web Interface

**Templates**:
- `index.html`: Landing page
- `send.html`: Sender interface
- `receive.html`: Receiver interface

**Static Assets**:
- `style.css`: Modern dark theme UI
- `qrcode.min.js`: QR code generation library

## Data Flow

### 1. Connection Establishment

```
Sender                     Server                    Receiver
  │                          │                          │
  │─────── GET /send ───────>│                          │
  │<───── HTML + Room ID ────│                          │
  │                          │                          │
  │─── WebSocket Connect ───>│                          │
  │<──── Connection OK ──────│                          │
  │                          │                          │
  │                          │<── GET /receive/:id ─────│
  │                          │──── HTML ───────────────>│
  │                          │                          │
  │                          │<─ WebSocket Connect ─────│
  │                          │──── Connection OK ──────>│
  │                          │                          │
  │<─── peer-joined ─────────│───── peer-joined ───────>│
  │                          │                          │
```

### 2. WebRTC Handshake

```
Sender                     Server                    Receiver
  │                          │                          │
  │─────── offer (SDP) ─────>│                          │
  │                          │───── offer (SDP) ───────>│
  │                          │                          │
  │                          │<──── answer (SDP) ───────│
  │<───── answer (SDP) ──────│                          │
  │                          │                          │
  │──── ICE candidate ──────>│                          │
  │                          │──── ICE candidate ──────>│
  │                          │                          │
  │                          │<──── ICE candidate ──────│
  │<──── ICE candidate ──────│                          │
  │                          │                          │
  │                                                     │
  └────────── Direct P2P Connection ───────────────────>│
                    (Data Channel)
```

### 3. File Transfer

```
Sender                                              Receiver
  │                                                    │
  │──────────── metadata (file info) ─────────────────>│
  │                                                    │
  │<────────────────── ready ──────────────────────────│
  │                                                    │
  │──────────── chunk header ─────────────────────────>│
  │──────────── chunk data ───────────────────────────>│
  │──────────── chunk header ─────────────────────────>│
  │──────────── chunk data ───────────────────────────>│
  │                     ...                            │
  │──────────── file-complete ────────────────────────>│
  │                                                    │
  │                                           [download file]
```

## WebRTC Connection Establishment

### STUN/TURN Server Role

1. **STUN** (Session Traversal Utilities for NAT):
   - Discovers public IP address
   - Determines NAT type
   - Enables direct P2P when possible

2. **TURN** (Traversal Using Relays around NAT):
   - Relays traffic when direct connection fails
   - Required for symmetric NAT
   - Fallback for restrictive firewalls

### ICE (Interactive Connectivity Establishment)

Process to find best connection path:

1. **Gather Candidates**:
   - Host candidates (local IP)
   - Server reflexive (public IP via STUN)
   - Relayed candidates (via TURN)

2. **Exchange Candidates**:
   - Via signaling server (WebSocket)
   - Both peers exchange all candidates

3. **Connectivity Checks**:
   - Test all candidate pairs
   - Select best working path
   - Prefer direct over relayed

4. **Connection Success**:
   - Establish data channel
   - Begin file transfer

### Connection States

```
new → checking → connected → completed
           ↓
        failed → closed
```

## File Transfer Protocol

### Message Types

#### 1. Control Messages (JSON)

**Metadata**:
```json
{
  "type": "metadata",
  "files": [
    {
      "name": "example.pdf",
      "size": 1048576,
      "type": "application/pdf"
    }
  ]
}
```

**Ready**:
```json
{
  "type": "ready"
}
```

**Chunk Header**:
```json
{
  "type": "chunk",
  "fileIndex": 0,
  "chunk": 42,
  "totalChunks": 100
}
```

**File Complete**:
```json
{
  "type": "file-complete",
  "fileIndex": 0
}
```

#### 2. Binary Data

- Chunk size: 16KB (configurable)
- Format: ArrayBuffer
- Order: Sequential per file

### Transfer Algorithm

**Sender**:
```
for each file:
    send metadata
    wait for ready
    
    while more chunks:
        send chunk header (JSON)
        send chunk data (binary)
        update progress
    
    send file-complete
```

**Receiver**:
```
receive metadata
display preview
user accepts
send ready

for each chunk:
    receive header
    receive data
    store in array
    update progress

on file-complete:
    reassemble chunks
    create blob
    trigger download
```

### Progress Tracking

**Speed Calculation**:
```javascript
bytesTransferred / elapsedSeconds = bytesPerSecond
```

**Time Remaining**:
```javascript
(totalBytes - bytesTransferred) / bytesPerSecond = secondsRemaining
```

## Security Model

### Threat Model

**Protected Against**:
- Man-in-the-middle attacks (WebRTC encryption)
- Server-side data exposure (no server storage)
- Unauthorized access (unique room IDs)
- Eavesdropping (DTLS encryption)

**Not Protected Against**:
- Room ID interception (share link securely)
- Malicious file content (scan files separately)
- DoS attacks on signaling server (rate limit needed)

### Encryption Layers

1. **Transport Layer**:
   - HTTPS for web interface (production)
   - WSS for WebSocket signaling (production)

2. **WebRTC Layer**:
   - DTLS (Datagram Transport Layer Security)
   - SRTP (Secure Real-time Transport Protocol)
   - Automatic encryption, no configuration needed

### Room ID Security

- 16-byte random token (128 bits entropy)
- URL-safe base64 encoding
- Unpredictable and non-enumerable
- Single-use (destroyed after transfer)

**Generation**:
```python
import secrets
room_id = secrets.token_urlsafe(16)
# Example: "xh3kJ9mP2nQ8rT4vW6yZ"
```

## Scalability Considerations

### Vertical Scaling

**Server Resources**:
- CPU: Minimal (signaling only)
- Memory: ~1MB per active room
- Network: Minimal (signaling messages only)
- Storage: None (files never stored)

**Bottlenecks**:
- WebSocket connections
- Concurrent rooms
- Signaling message rate

### Horizontal Scaling

For high traffic, use:

1. **Load Balancer**:
```
nginx → [Server 1, Server 2, Server 3]
```

2. **Sticky Sessions**:
   - Required for WebSocket connections
   - Based on room ID

3. **Shared State** (optional):
   - Redis for room metadata
   - Cross-server room discovery

### Performance Optimization

1. **WebSocket Tuning**:
```python
# In uvicorn
uvicorn main:app --ws-ping-interval 20 --ws-ping-timeout 20
```

2. **Connection Limits**:
```python
# Max connections per server
MAX_ROOMS = 1000
MAX_PEERS_PER_ROOM = 2
```

3. **Cleanup**:
- Automatic room cleanup on disconnect
- Periodic cleanup of stale rooms
- Connection timeout handling

### Monitoring Metrics

**Key Metrics**:
- Active WebSocket connections
- Active rooms
- Successful transfers
- Failed connections
- Average transfer speed
- Server CPU/Memory usage

**Health Check**:
```python
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "active_rooms": len(manager.active_rooms),
        "timestamp": datetime.now().isoformat()
    }
```

## Design Decisions

### Why FastAPI?

- **Async Support**: Native WebSocket support
- **Performance**: High throughput for signaling
- **Developer Experience**: Type hints, auto docs
- **Modern**: Active development, good ecosystem

### Why No Database?

- **Simplicity**: No persistence needed
- **Privacy**: No data storage
- **Scalability**: Stateless servers
- **Security**: No data breach risk

### Why 16KB Chunks?

- **Browser Compatibility**: Works across all browsers
- **Memory Efficiency**: Manageable memory usage
- **Progress Granularity**: Smooth progress updates
- **Network Efficiency**: Good packet size

### Why Room-Based Architecture?

- **Simplicity**: Easy to implement
- **Isolation**: Transfers don't interfere
- **Scalability**: Independent rooms
- **Security**: Natural access control

## Future Enhancements

Potential improvements:

1. **Multi-Peer Transfer**: One sender → multiple receivers
2. **Resume Capability**: Handle connection interruptions
3. **Compression**: Reduce transfer size
4. **Encryption**: Additional E2E encryption layer
5. **Batch Transfers**: Transfer job management
6. **API Access**: Programmatic file transfer
7. **Mobile Apps**: Native iOS/Android apps

## References

- [WebRTC Specification](https://www.w3.org/TR/webrtc/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [WebSocket Protocol](https://tools.ietf.org/html/rfc6455)
- [ICE Protocol](https://tools.ietf.org/html/rfc8445)
- [DTLS](https://tools.ietf.org/html/rfc6347)
