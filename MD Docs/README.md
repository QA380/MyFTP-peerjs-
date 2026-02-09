# PyFileTransfer

A peer-to-peer file transfer application inspired by [FilePizza](https://github.com/kern/filepizza), built with Python FastAPI and WebRTC.

## Features

- **Private & Secure**: Files are transferred directly between peers using encrypted WebRTC connections
- **No Server Storage**: Files stream directly from sender to receiver without touching the server
- **Multi-File Support**: Send multiple files in a single transfer session
- **Self-Hosted**: Run on your own infrastructure with complete control
- **Mobile Friendly**: Works on desktop and mobile browsers
- **Simple Sharing**: Share files via link or QR code
- **Transfer Progress**: Real-time progress tracking and speed monitoring

## Architecture

PyFileTransfer uses a client-server architecture where:

1. **FastAPI Server**: Provides the web interface and WebRTC signaling server
2. **WebRTC**: Enables direct peer-to-peer data transfer between browsers
3. **WebSocket**: Handles signaling for WebRTC connection establishment

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│ Sender  │◄──── Signaling ────┤ Server  │──── Signaling ────►│Receiver │
│ Browser │      (WebSocket)   │ FastAPI │    (WebSocket)     │ Browser │
└─────────┘                    └─────────┘                    └─────────┘
     │                                                              │
     └──────────────── File Transfer (WebRTC) ──────────────────────┘
                         Direct P2P Connection
```

## 🚀 Quick Start

### Using Docker (Recommended)

1. Clone the repository:
```bash
git clone https://github.com/yourusername/pyfiletransfer.git
cd pyfiletransfer
```

2. Build and run:
```bash
docker-compose up -d
```

3. Access the application at `http://localhost:8080`

### Using Python Virtualenv

1. Clone and setup:
```bash
git clone https://github.com/yourusername/pyfiletransfer.git
cd pyfiletransfer
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

2. Run the application:
```bash
cd src
python main.py
```

3. Access at `http://localhost:8080`

## Documentation

- [Installation Guide](docs/INSTALLATION.md) - Detailed installation instructions
- [Architecture Overview](docs/ARCHITECTURE.md) - System design and components
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment options
- [TURN Server Setup](docs/TURN_SERVER.md) - Setting up your own TURN server
- [API Documentation](docs/API.md) - WebSocket API reference
- [User Guide](docs/USER_GUIDE.md) - How to use PyFileTransfer

## Configuration

### Environment Variables

- `LOG_LEVEL`: Logging level (default: `info`)
- `HOST`: Host to bind to (default: `0.0.0.0`)
- `PORT`: Port to listen on (default: `8080`)

### STUN/TURN Servers

By default, PyFileTransfer uses public STUN servers (Google). For better reliability, especially behind NAT/firewalls, configure your own TURN server.

Edit `static/js/sender.js` and `static/js/receiver.js`:

```javascript
const config = {
    iceServers: [
        { urls: 'stun:your-stun-server.com:3478' },
        {
            urls: 'turn:your-turn-server.com:3478',
            username: 'username',
            credential: 'password'
        }
    ]
};
```

See [TURN_SERVER.md](docs/TURN_SERVER.md) for setup instructions.

## Deployment Options

### Docker Compose

Basic deployment:
```bash
docker-compose up -d
```

With Nginx reverse proxy:
```bash
docker-compose --profile with-nginx up -d
```

### Systemd Service

1. Copy files:
```bash
sudo cp -r pyfiletransfer /opt/
sudo cp docker/pyfiletransfer.service /etc/systemd/system/
```

2. Create user and setup:
```bash
sudo useradd -r -s /bin/false pyfiletransfer
cd /opt/pyfiletransfer
python -m venv venv
venv/bin/pip install -r requirements.txt
sudo chown -R pyfiletransfer:pyfiletransfer /opt/pyfiletransfer
```

3. Enable and start:
```bash
sudo systemctl enable pyfiletransfer
sudo systemctl start pyfiletransfer
```

### Reverse Proxy with SSL

For production, use a reverse proxy (Nginx/Caddy) with SSL certificates:

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Security Considerations

1. **HTTPS Required**: WebRTC requires HTTPS in production (except localhost)
2. **TURN Authentication**: Secure your TURN server with authentication
3. **Rate Limiting**: Consider implementing rate limits for production
4. **Firewall Rules**: Configure firewall to allow necessary ports
5. **Regular Updates**: Keep dependencies updated for security patches

## Testing

Test the application locally:

1. Start the server
2. Open `http://localhost:8080` in one browser tab
3. Click "Send Files" and select files
4. Copy the share link
5. Open the link in another browser tab (or device on same network)
6. Accept the transfer

## How It Works

1. **Sender** selects files and generates a unique room ID
2. **Server** creates a WebSocket signaling channel for the room
3. **Receiver** joins using the share link
4. **WebRTC** connection is established via signaling:
   - Sender creates an offer (SDP)
   - Receiver creates an answer (SDP)
   - ICE candidates are exchanged
5. **Direct P2P** connection is established
6. **Files** are chunked and transferred directly between peers
7. **Receiver** reassembles chunks and downloads files

## Development

### Project Structure

```
pyfiletransfer/
├── src/
│   └── main.py              # FastAPI application
├── static/
│   ├── css/
│   │   └── style.css        # Styling
│   └── js/
│       ├── sender.js        # Sender WebRTC logic
│       ├── receiver.js      # Receiver WebRTC logic
│       └── qrcode.min.js    # QR code generation
├── templates/
│   ├── index.html           # Home page
│   ├── send.html            # Sender page
│   └── receive.html         # Receiver page
├── docker/
│   ├── nginx.conf           # Nginx configuration
│   └── pyfiletransfer.service  # Systemd service
├── docs/                    # Documentation
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

### Adding Features

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Acknowledgments

- Inspired by [FilePizza](https://github.com/kern/filepizza) by kern
- Built with [FastAPI](https://fastapi.tiangolo.com/)
- Uses [WebRTC](https://webrtc.org/) for peer-to-peer communication

## Known Limitations

- Requires modern browser with WebRTC support
- Large files may require TURN server for NAT traversal
- Transfer interrupted if sender closes browser
- Mobile data connections may be unstable

## Roadmap

- [ ] Password protection for transfers
- [ ] Transfer resume capability
- [ ] Compression support
- [ ] End-to-end encryption option
- [ ] Transfer history
- [ ] API for programmatic access
- [ ] Mobile apps (iOS/Android)

Made with using Python and WebRTC


