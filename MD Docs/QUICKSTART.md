# Quick Start Guide

Get PyFileTransfer running in 5 minutes!

## Option 1: Docker (Fastest)

```bash
# 1. Clone or extract the project
cd pyfiletransfer

# 2. Start the application
docker-compose up -d

# 3. Access at http://localhost:8080
```

That's it! 🎉

## Option 2: Python Virtual Environment

```bash
# 1. Navigate to project
cd pyfiletransfer

# 2. Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the application
cd src
python main.py

# 5. Access at http://localhost:8080
```

## First Transfer

### As Sender:
1. Click "Send Files"
2. Select files
3. Copy the share link
4. Send link to receiver

### As Receiver:
1. Click the share link
2. Review files
3. Click "Accept & Download"
4. Files download automatically

## What's Next?

- **Production Deployment**: See [DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **Setup TURN Server**: See [TURN_SERVER.md](docs/TURN_SERVER.md)
- **Full Documentation**: See [INSTALLATION.md](docs/INSTALLATION.md)
- **User Guide**: See [USER_GUIDE.md](docs/USER_GUIDE.md)

## Troubleshooting

**Docker not found?**
```bash
curl -fsSL https://get.docker.com | sh
```

**Port 8080 in use?**
Edit `docker-compose.yml` and change `8080:8080` to `8081:8080`

**Python version?**
Requires Python 3.11+. Check with: `python3 --version`

## Project Structure

```
pyfiletransfer/
├── src/main.py           # FastAPI application
├── static/               # Frontend assets
│   ├── css/style.css
│   └── js/              # WebRTC client code
├── templates/           # HTML templates
├── docs/                # Documentation
├── docker/              # Deployment configs
└── requirements.txt     # Python dependencies
```

## Key Features

✅ Peer-to-peer file transfer (WebRTC)
✅ No server-side storage
✅ Multiple file support
✅ Real-time progress tracking
✅ QR code sharing
✅ Mobile friendly
✅ Self-hosted

## Support

- 📖 [Full Documentation](README.md)
- 🐛 [Report Issues](https://github.com/yourusername/pyfiletransfer/issues)
- 💬 [Discussions](https://github.com/yourusername/pyfiletransfer/discussions)

---

Happy file sharing! 🚀
