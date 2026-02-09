"""
PyFileTransfer - P2P File Transfer using WebRTC
Main FastAPI application with WebRTC signaling server
"""
import asyncio
import logging
from typing import Dict, Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import uvicorn
import json
from datetime import datetime
import secrets

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="PyFileTransfer", version="1.0.0")

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Store active rooms and connections
class ConnectionManager:
    def __init__(self):
        self.active_rooms: Dict[str, Set[WebSocket]] = {}
        self.room_metadata: Dict[str, dict] = {}
    
    async def connect(self, room_id: str, websocket: WebSocket):
        """Add a new connection to a room"""
        await websocket.accept()
        
        if room_id not in self.active_rooms:
            self.active_rooms[room_id] = set()
            self.room_metadata[room_id] = {
                "created_at": datetime.now().isoformat(),
                "peer_count": 0
            }
        
        self.active_rooms[room_id].add(websocket)
        self.room_metadata[room_id]["peer_count"] = len(self.active_rooms[room_id])
        logger.info(f"New connection to room {room_id}. Total peers: {self.room_metadata[room_id]['peer_count']}")
    
    def disconnect(self, room_id: str, websocket: WebSocket):
        """Remove a connection from a room"""
        if room_id in self.active_rooms:
            self.active_rooms[room_id].discard(websocket)
            
            if len(self.active_rooms[room_id]) == 0:
                # Clean up empty room
                del self.active_rooms[room_id]
                del self.room_metadata[room_id]
                logger.info(f"Room {room_id} closed (no peers)")
            else:
                self.room_metadata[room_id]["peer_count"] = len(self.active_rooms[room_id])
                logger.info(f"Peer disconnected from room {room_id}. Remaining peers: {self.room_metadata[room_id]['peer_count']}")
    
    async def broadcast(self, room_id: str, message: dict, sender: WebSocket = None):
        """Broadcast message to all peers in a room except sender"""
        if room_id not in self.active_rooms:
            return
        
        for connection in self.active_rooms[room_id]:
            if connection != sender:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error broadcasting to peer: {e}")
    
    async def send_to_peer(self, websocket: WebSocket, message: dict):
        """Send message to specific peer"""
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"Error sending to peer: {e}")
    
    def get_room_info(self, room_id: str) -> dict:
        """Get room metadata"""
        if room_id in self.room_metadata:
            return self.room_metadata[room_id]
        return None

manager = ConnectionManager()


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Render home page"""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/send", response_class=HTMLResponse)
async def send_page(request: Request):
    """Render sender page"""
    room_id = secrets.token_urlsafe(16)
    return templates.TemplateResponse("send.html", {
        "request": request,
        "room_id": room_id
    })


@app.get("/receive/{room_id}", response_class=HTMLResponse)
async def receive_page(request: Request, room_id: str):
    """Render receiver page"""
    return templates.TemplateResponse("receive.html", {
        "request": request,
        "room_id": room_id
    })


@app.get("/api/room/{room_id}/info")
async def room_info(room_id: str):
    """Get room information"""
    info = manager.get_room_info(room_id)
    if info:
        return {"exists": True, "info": info}
    return {"exists": False}


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    """
    WebSocket endpoint for WebRTC signaling
    Handles SDP offers/answers and ICE candidates
    """
    await manager.connect(room_id, websocket)
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            message_type = message.get("type")
            logger.info(f"Received {message_type} in room {room_id}")
            
            if message_type == "offer":
                # Forward offer to other peer
                await manager.broadcast(room_id, {
                    "type": "offer",
                    "sdp": message.get("sdp")
                }, sender=websocket)
            
            elif message_type == "answer":
                # Forward answer to other peer
                await manager.broadcast(room_id, {
                    "type": "answer",
                    "sdp": message.get("sdp")
                }, sender=websocket)
            
            elif message_type == "ice-candidate":
                # Forward ICE candidate to other peer
                await manager.broadcast(room_id, {
                    "type": "ice-candidate",
                    "candidate": message.get("candidate")
                }, sender=websocket)
            
            elif message_type == "metadata":
                # Forward file metadata to receiver
                await manager.broadcast(room_id, {
                    "type": "metadata",
                    "files": message.get("files")
                }, sender=websocket)
            
            elif message_type == "peer-joined":
                # Notify sender that receiver has joined
                await manager.broadcast(room_id, {
                    "type": "peer-joined"
                }, sender=websocket)
            
            elif message_type == "ping":
                # Respond to ping to keep connection alive
                await manager.send_to_peer(websocket, {"type": "pong"})
    
    except WebSocketDisconnect:
        manager.disconnect(room_id, websocket)
        # Notify other peers about disconnection
        await manager.broadcast(room_id, {"type": "peer-disconnected"})
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(room_id, websocket)


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "active_rooms": len(manager.active_rooms),
        "timestamp": datetime.now().isoformat()
    }


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
        log_level="info"
    )
