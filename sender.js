// Sender WebRTC implementation
const CHUNK_SIZE = 16384; // 16KB chunks

class FileSender {
    constructor(roomId) {
        this.roomId = roomId;
        this.files = [];
        this.peerConnection = null;
        this.dataChannel = null;
        this.ws = null;
        this.currentFileIndex = 0;
        this.currentChunk = 0;
        this.isTransferring = false;
        
        this.setupWebSocket();
        this.setupUI();
    }
    
    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/${this.roomId}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.showLinkSection();
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
    
    setupUI() {
        const fileInput = document.getElementById('fileInput');
        const copyBtn = document.getElementById('copyBtn');
        
        fileInput.addEventListener('change', (e) => {
            this.handleFileSelection(e.target.files);
        });
        
        copyBtn.addEventListener('click', () => {
            this.copyShareLink();
        });
    }
    
    handleFileSelection(fileList) {
        this.files = Array.from(fileList);
        
        if (this.files.length === 0) return;
        
        // Display selected files
        const fileListDiv = document.getElementById('fileList');
        fileListDiv.innerHTML = '';
        
        this.files.forEach((file, index) => {
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
            fileListDiv.appendChild(fileItem);
        });
        
        // Show link section
        this.showLinkSection();
    }
    
    showLinkSection() {
        const shareLink = `${window.location.origin}/receive/${this.roomId}`;
        document.getElementById('shareLink').value = shareLink;
        document.getElementById('link-section').classList.remove('hidden');
        
        // Generate QR code
        this.generateQRCode(shareLink);
        
        // Show waiting section
        document.getElementById('waiting-section').classList.remove('hidden');
    }
    
    generateQRCode(text) {
        const canvas = document.getElementById('qrcode');
        QRCode.toCanvas(canvas, text, {
            width: 200,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        }, (error) => {
            if (error) console.error('QR code generation error:', error);
        });
    }
    
    copyShareLink() {
        const shareLink = document.getElementById('shareLink');
        shareLink.select();
        document.execCommand('copy');
        
        const copyBtn = document.getElementById('copyBtn');
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyBtn.textContent = originalText;
        }, 2000);
    }
    
    async handleSignaling(message) {
        console.log('Received signaling message:', message.type);
        
        if (message.type === 'peer-joined') {
            // Receiver has joined, create offer
            await this.createPeerConnection();
            await this.createOffer();
        } else if (message.type === 'answer') {
            // Received answer from receiver
            await this.peerConnection.setRemoteDescription(
                new RTCSessionDescription({ type: 'answer', sdp: message.sdp })
            );
        } else if (message.type === 'ice-candidate' && message.candidate) {
            // Received ICE candidate
            await this.peerConnection.addIceCandidate(
                new RTCIceCandidate(message.candidate)
            );
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
        
        // Create data channel
        this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
            ordered: true
        });
        
        this.setupDataChannel();
        
        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    candidate: event.candidate
                }));
            }
        };
        
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            
            if (this.peerConnection.connectionState === 'connected') {
                console.log('Peer connection established');
            } else if (this.peerConnection.connectionState === 'failed') {
                this.showError('Connection failed. Please try again.');
            }
        };
    }
    
    setupDataChannel() {
        this.dataChannel.onopen = () => {
            console.log('Data channel opened');
            document.getElementById('waiting-section').classList.add('hidden');
            this.sendFileMetadata();
        };
        
        this.dataChannel.onclose = () => {
            console.log('Data channel closed');
        };
        
        this.dataChannel.onerror = (error) => {
            console.error('Data channel error:', error);
            this.showError('Transfer error. Please try again.');
        };
        
        this.dataChannel.onmessage = (event) => {
            const message = JSON.parse(event.data);
            
            if (message.type === 'ready') {
                // Receiver is ready, start transfer
                this.startTransfer();
            }
        };
    }
    
    async createOffer() {
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        
        this.ws.send(JSON.stringify({
            type: 'offer',
            sdp: offer.sdp
        }));
    }
    
    sendFileMetadata() {
        const metadata = this.files.map(file => ({
            name: file.name,
            size: file.size,
            type: file.type
        }));
        
        this.dataChannel.send(JSON.stringify({
            type: 'metadata',
            files: metadata
        }));
    }
    
    async startTransfer() {
        document.getElementById('transfer-section').classList.remove('hidden');
        this.isTransferring = true;
        
        // Create progress bars
        const progressDiv = document.getElementById('transferProgress');
        progressDiv.innerHTML = '';
        
        this.files.forEach((file, index) => {
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
        
        // Send files sequentially
        for (let i = 0; i < this.files.length; i++) {
            await this.sendFile(i);
        }
        
        this.showComplete();
    }
    
    async sendFile(fileIndex) {
        const file = this.files[fileIndex];
        const reader = new FileReader();
        let offset = 0;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        
        const startTime = Date.now();
        
        return new Promise((resolve, reject) => {
            reader.onload = (e) => {
                if (this.dataChannel.readyState === 'open') {
                    // Send chunk header
                    this.dataChannel.send(JSON.stringify({
                        type: 'chunk',
                        fileIndex: fileIndex,
                        chunk: offset / CHUNK_SIZE,
                        totalChunks: totalChunks
                    }));
                    
                    // Send chunk data
                    this.dataChannel.send(e.target.result);
                    
                    offset += CHUNK_SIZE;
                    const progress = Math.min((offset / file.size) * 100, 100);
                    
                    // Update progress
                    document.getElementById(`progress-${fileIndex}`).textContent = 
                        `${Math.round(progress)}%`;
                    document.getElementById(`bar-${fileIndex}`).style.width = 
                        `${progress}%`;
                    
                    // Update transfer stats
                    const elapsed = (Date.now() - startTime) / 1000;
                    const speed = offset / elapsed;
                    document.getElementById('transferSpeed').textContent = 
                        `${this.formatBytes(speed)}/s`;
                    
                    const remaining = (file.size - offset) / speed;
                    document.getElementById('timeRemaining').textContent = 
                        this.formatTime(remaining);
                    
                    if (offset < file.size) {
                        readNextChunk();
                    } else {
                        // File complete
                        this.dataChannel.send(JSON.stringify({
                            type: 'file-complete',
                            fileIndex: fileIndex
                        }));
                        resolve();
                    }
                }
            };
            
            reader.onerror = reject;
            
            const readNextChunk = () => {
                const slice = file.slice(offset, offset + CHUNK_SIZE);
                reader.readAsArrayBuffer(slice);
            };
            
            readNextChunk();
        });
    }
    
    showComplete() {
        document.getElementById('transfer-section').classList.add('hidden');
        document.getElementById('complete-section').classList.remove('hidden');
    }
    
    showError(message) {
        document.getElementById('errorMessage').textContent = message;
        document.getElementById('file-selection').classList.add('hidden');
        document.getElementById('link-section').classList.add('hidden');
        document.getElementById('waiting-section').classList.add('hidden');
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

// Initialize sender
const sender = new FileSender(ROOM_ID);
