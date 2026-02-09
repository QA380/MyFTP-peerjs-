// Receiver WebRTC implementation
const CHUNK_SIZE = 16384; // 16KB chunks

class FileReceiver {
    constructor(roomId) {
        this.roomId = roomId;
        this.peerConnection = null;
        this.dataChannel = null;
        this.ws = null;
        this.fileMetadata = [];
        this.receivedChunks = [];
        this.currentFileIndex = -1;
        this.acceptedTransfer = false;
        
        this.setupWebSocket();
    }
    
    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/${this.roomId}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            // Notify sender that receiver has joined
            this.ws.send(JSON.stringify({ type: 'peer-joined' }));
        };
        
        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleSignaling(message);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.showError('Connection error. Please try again.');
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket closed');
        };
    }
    
    async handleSignaling(message) {
        console.log('Received signaling message:', message.type);
        
        if (message.type === 'offer') {
            // Received offer from sender
            await this.createPeerConnection();
            await this.peerConnection.setRemoteDescription(
                new RTCSessionDescription({ type: 'offer', sdp: message.sdp })
            );
            await this.createAnswer();
        } else if (message.type === 'ice-candidate' && message.candidate) {
            // Received ICE candidate
            if (this.peerConnection) {
                await this.peerConnection.addIceCandidate(
                    new RTCIceCandidate(message.candidate)
                );
            }
        } else if (message.type === 'peer-disconnected') {
            this.showError('Sender disconnected.');
        }
    }
    
    async createPeerConnection() {
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        this.peerConnection = new RTCPeerConnection(config);
        
        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    candidate: event.candidate
                }));
            }
        };
        
        // Handle data channel
        this.peerConnection.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            this.setupDataChannel();
        };
        
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            
            if (this.peerConnection.connectionState === 'connected') {
                console.log('Peer connection established');
                document.getElementById('connecting-section').classList.add('hidden');
            } else if (this.peerConnection.connectionState === 'failed') {
                this.showError('Connection failed. Please try again.');
            }
        };
    }
    
    setupDataChannel() {
        this.dataChannel.onopen = () => {
            console.log('Data channel opened');
        };
        
        this.dataChannel.onclose = () => {
            console.log('Data channel closed');
        };
        
        this.dataChannel.onerror = (error) => {
            console.error('Data channel error:', error);
            this.showError('Transfer error. Please try again.');
        };
        
        this.dataChannel.onmessage = (event) => {
            this.handleDataChannelMessage(event.data);
        };
    }
    
    async createAnswer() {
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        
        this.ws.send(JSON.stringify({
            type: 'answer',
            sdp: answer.sdp
        }));
    }
    
    handleDataChannelMessage(data) {
        // Try to parse as JSON (control messages)
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'metadata') {
                // Received file metadata
                this.fileMetadata = message.files;
                this.showPreview();
            } else if (message.type === 'chunk') {
                // Chunk header - next message will be binary data
                this.currentChunkInfo = message;
            } else if (message.type === 'file-complete') {
                // File transfer complete
                this.completeFile(message.fileIndex);
            }
        } catch (e) {
            // Binary data (file chunk)
            if (this.currentChunkInfo && this.acceptedTransfer) {
                this.receiveChunk(data);
            }
        }
    }
    
    showPreview() {
        document.getElementById('connecting-section').classList.add('hidden');
        document.getElementById('preview-section').classList.remove('hidden');
        
        const previewDiv = document.getElementById('filePreview');
        previewDiv.innerHTML = '';
        
        this.fileMetadata.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `
                <div class="file-info">
                    <span class="icon">📄</span>
                    <div>
                        <div class="file-name">${file.name}</div>
                        <div class="file-size">${this.formatBytes(file.size)}</div>
                    </div>
                </div>
            `;
            previewDiv.appendChild(fileItem);
        });
        
        // Setup accept/decline buttons
        document.getElementById('acceptBtn').addEventListener('click', () => {
            this.acceptTransfer();
        });
        
        document.getElementById('declineBtn').addEventListener('click', () => {
            this.declineTransfer();
        });
    }
    
    acceptTransfer() {
        this.acceptedTransfer = true;
        
        // Initialize received chunks array
        this.receivedChunks = this.fileMetadata.map(() => []);
        
        document.getElementById('preview-section').classList.add('hidden');
        document.getElementById('transfer-section').classList.remove('hidden');
        
        // Create progress bars
        const progressDiv = document.getElementById('transferProgress');
        progressDiv.innerHTML = '';
        
        this.fileMetadata.forEach((file, index) => {
            const progressItem = document.createElement('div');
            progressItem.className = 'progress-item';
            progressItem.innerHTML = `
                <div class="progress-header">
                    <span>${file.name}</span>
                    <span id="progress-${index}">0%</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar" id="bar-${index}" style="width: 0%"></div>
                </div>
            `;
            progressDiv.appendChild(progressItem);
        });
        
        // Notify sender that we're ready
        this.dataChannel.send(JSON.stringify({ type: 'ready' }));
        
        this.transferStartTime = Date.now();
        this.totalBytesReceived = 0;
    }
    
    declineTransfer() {
        this.showError('Transfer declined.');
        this.dataChannel.close();
        this.peerConnection.close();
        this.ws.close();
    }
    
    receiveChunk(arrayBuffer) {
        const { fileIndex, chunk, totalChunks } = this.currentChunkInfo;
        
        // Store chunk
        this.receivedChunks[fileIndex][chunk] = arrayBuffer;
        
        // Calculate progress
        const receivedChunks = this.receivedChunks[fileIndex].filter(c => c !== undefined).length;
        const progress = (receivedChunks / totalChunks) * 100;
        
        // Update progress
        document.getElementById(`progress-${fileIndex}`).textContent = 
            `${Math.round(progress)}%`;
        document.getElementById(`bar-${fileIndex}`).style.width = 
            `${progress}%`;
        
        // Update transfer stats
        this.totalBytesReceived += arrayBuffer.byteLength;
        const elapsed = (Date.now() - this.transferStartTime) / 1000;
        const speed = this.totalBytesReceived / elapsed;
        document.getElementById('transferSpeed').textContent = 
            `${this.formatBytes(speed)}/s`;
        
        const totalSize = this.fileMetadata.reduce((sum, file) => sum + file.size, 0);
        const remaining = (totalSize - this.totalBytesReceived) / speed;
        document.getElementById('timeRemaining').textContent = 
            this.formatTime(remaining);
    }
    
    completeFile(fileIndex) {
        const file = this.fileMetadata[fileIndex];
        const chunks = this.receivedChunks[fileIndex];
        
        // Combine chunks into a single blob
        const blob = new Blob(chunks, { type: file.type || 'application/octet-stream' });
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log(`File ${fileIndex} (${file.name}) complete`);
        
        // Check if all files are complete
        const allComplete = this.receivedChunks.every((chunks, idx) => {
            const expectedChunks = Math.ceil(this.fileMetadata[idx].size / CHUNK_SIZE);
            return chunks.filter(c => c !== undefined).length === expectedChunks;
        });
        
        if (allComplete) {
            this.showComplete();
        }
    }
    
    showComplete() {
        document.getElementById('transfer-section').classList.add('hidden');
        document.getElementById('complete-section').classList.remove('hidden');
        
        // Show downloaded files
        const downloadedDiv = document.getElementById('downloadedFiles');
        downloadedDiv.innerHTML = '<h3>Downloaded Files:</h3>';
        
        this.fileMetadata.forEach((file) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `
                <div class="file-info">
                    <span class="icon">✅</span>
                    <div>
                        <div class="file-name">${file.name}</div>
                        <div class="file-size">${this.formatBytes(file.size)}</div>
                    </div>
                </div>
            `;
            downloadedDiv.appendChild(fileItem);
        });
    }
    
    showError(message) {
        document.getElementById('errorMessage').textContent = message;
        document.getElementById('connecting-section').classList.add('hidden');
        document.getElementById('preview-section').classList.add('hidden');
        document.getElementById('transfer-section').classList.add('hidden');
        document.getElementById('error-section').classList.remove('hidden');
    }
    
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
    
    formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '--';
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const minutes = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${minutes}m ${secs}s`;
    }
}

// Initialize receiver
const receiver = new FileReceiver(ROOM_ID);
