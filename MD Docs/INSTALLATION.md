# Installation Guide

This guide covers all methods of installing and running PyFileTransfer.

## Table of Contents

- [System Requirements](#system-requirements)
- [Docker Installation](#docker-installation)
- [Python Virtual Environment](#python-virtual-environment)
- [Systemd Service](#systemd-service)
- [Cloud Deployment](#cloud-deployment)
- [Troubleshooting](#troubleshooting)

## System Requirements

### Minimum Requirements

- **Operating System**: Linux, macOS, or Windows
- **Python**: 3.11 or higher (for non-Docker installations)
- **Docker**: 20.10+ and Docker Compose 2.0+ (for Docker installations)
- **Memory**: 512 MB RAM
- **Storage**: 100 MB for application files
- **Network**: Open ports 8080 (configurable)

### Browser Requirements

- Chrome/Chromium 56+
- Firefox 44+
- Safari 11+
- Edge 79+

## Docker Installation

Docker is the recommended installation method for production deployments.

### Prerequisites

1. Install Docker:
```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Verify installation
docker --version
docker-compose --version
```

### Installation Steps

1. Clone the repository:
```bash
git clone https://github.com/yourusername/pyfiletransfer.git
cd pyfiletransfer
```

2. Build and start the container:
```bash
docker-compose up -d
```

3. Verify the service is running:
```bash
docker-compose ps
docker-compose logs -f pyfiletransfer
```

4. Access the application:
```
http://localhost:8080
```

### Docker Configuration

Edit `docker-compose.yml` to customize:

```yaml
services:
  pyfiletransfer:
    ports:
      - "8080:8080"  # Change external port here
    environment:
      - LOG_LEVEL=info  # debug, info, warning, error
```

### Using Nginx Reverse Proxy

For production with SSL:

1. Create SSL certificates (self-signed for testing):
```bash
mkdir -p docker/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout docker/ssl/key.pem \
  -out docker/ssl/cert.pem \
  -subj "/CN=localhost"
```

2. Start with Nginx profile:
```bash
docker-compose --profile with-nginx up -d
```

3. Access via HTTPS:
```
https://localhost
```

### Docker Management Commands

```bash
# View logs
docker-compose logs -f

# Restart service
docker-compose restart

# Stop service
docker-compose stop

# Remove containers
docker-compose down

# Rebuild after changes
docker-compose up -d --build

# View resource usage
docker stats pyfiletransfer
```

## Python Virtual Environment

For development or if you prefer not to use Docker.

### Prerequisites

1. Install Python 3.11+:
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install python3.11 python3.11-venv python3-pip

# macOS (using Homebrew)
brew install python@3.11

# Windows
# Download from https://www.python.org/downloads/
```

### Installation Steps

1. Clone the repository:
```bash
git clone https://github.com/yourusername/pyfiletransfer.git
cd pyfiletransfer
```

2. Create virtual environment:
```bash
python3.11 -m venv venv

# Activate on Linux/macOS
source venv/bin/activate

# Activate on Windows
venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

4. Run the application:
```bash
cd src
python main.py
```

Or use uvicorn directly:
```bash
uvicorn src.main:app --host 0.0.0.0 --port 8080 --reload
```

5. Access the application:
```
http://localhost:8080
```

### Development Mode

For development with auto-reload:

```bash
uvicorn src.main:app --reload --host 0.0.0.0 --port 8080
```

## Systemd Service

For production deployments on Linux servers without Docker.

### Prerequisites

- Linux system with systemd
- Python 3.11+
- Root/sudo access

### Installation Steps

1. Create application user:
```bash
sudo useradd -r -s /bin/false pyfiletransfer
```

2. Install application:
```bash
# Clone to /opt
sudo git clone https://github.com/yourusername/pyfiletransfer.git /opt/pyfiletransfer
cd /opt/pyfiletransfer

# Create virtual environment
sudo python3.11 -m venv venv
sudo venv/bin/pip install --upgrade pip
sudo venv/bin/pip install -r requirements.txt

# Set permissions
sudo chown -R pyfiletransfer:pyfiletransfer /opt/pyfiletransfer
```

3. Install systemd service:
```bash
sudo cp docker/pyfiletransfer.service /etc/systemd/system/
sudo systemctl daemon-reload
```

4. Enable and start service:
```bash
sudo systemctl enable pyfiletransfer
sudo systemctl start pyfiletransfer
```

5. Check status:
```bash
sudo systemctl status pyfiletransfer
sudo journalctl -u pyfiletransfer -f
```

### Systemd Commands

```bash
# Start service
sudo systemctl start pyfiletransfer

# Stop service
sudo systemctl stop pyfiletransfer

# Restart service
sudo systemctl restart pyfiletransfer

# View logs
sudo journalctl -u pyfiletransfer -f

# Disable auto-start
sudo systemctl disable pyfiletransfer
```

### Updating Application

```bash
cd /opt/pyfiletransfer
sudo -u pyfiletransfer git pull
sudo -u pyfiletransfer venv/bin/pip install -r requirements.txt
sudo systemctl restart pyfiletransfer
```

## Cloud Deployment

### AWS EC2

1. Launch EC2 instance (Ubuntu 22.04 LTS recommended)
2. Configure security group:
   - Inbound: Port 80 (HTTP), 443 (HTTPS), 22 (SSH)
3. SSH into instance and follow Docker or Systemd installation
4. Configure domain and SSL certificates

### DigitalOcean Droplet

1. Create droplet (Ubuntu 22.04)
2. SSH into droplet
3. Follow Docker installation steps
4. Configure Nginx with Let's Encrypt:

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

### Heroku

Create `Procfile`:
```
web: uvicorn src.main:app --host 0.0.0.0 --port $PORT
```

Deploy:
```bash
heroku create your-app-name
git push heroku main
```

### Railway/Render

Both platforms support Docker deployment. Push your repository and configure:
- Port: 8080
- Health check: /health
- Auto-deploy: enabled

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 8080
sudo lsof -i :8080

# Kill process
sudo kill -9 <PID>

# Or change port in docker-compose.yml or when running
uvicorn src.main:app --port 8081
```

### Permission Denied Errors

```bash
# Docker
sudo usermod -aG docker $USER
newgrp docker

# File permissions
sudo chown -R $USER:$USER .
```

### WebSocket Connection Fails

1. Check firewall allows port 8080
2. Verify WebSocket upgrade headers in reverse proxy
3. Check browser console for errors

### Module Not Found Errors

```bash
# Reinstall dependencies
pip install --force-reinstall -r requirements.txt

# Verify virtual environment is activated
which python  # Should point to venv
```

### Docker Build Fails

```bash
# Clear Docker cache
docker system prune -a

# Rebuild without cache
docker-compose build --no-cache
```

### SSL Certificate Issues

```bash
# Self-signed certificates (testing only)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout key.pem -out cert.pem

# Production: Use Let's Encrypt
sudo certbot --nginx -d yourdomain.com
```

### High Memory Usage

Adjust uvicorn workers:
```bash
uvicorn src.main:app --workers 1 --host 0.0.0.0 --port 8080
```

## Verification

After installation, verify everything works:

1. Health check:
```bash
curl http://localhost:8080/health
```

2. WebSocket test:
```bash
# Install wscat
npm install -g wscat

# Test WebSocket
wscat -c ws://localhost:8080/ws/test-room
```

3. Browser test:
   - Open http://localhost:8080
   - Click "Send Files"
   - Select a test file
   - Open share link in another tab
   - Verify transfer completes

## Next Steps

- [Configure TURN server](TURN_SERVER.md) for better connectivity
- [Set up reverse proxy](DEPLOYMENT.md) for production
- [Read user guide](USER_GUIDE.md) to understand features
- [Review architecture](ARCHITECTURE.md) for customization

## Getting Help

If you encounter issues:

1. Check logs: `docker-compose logs` or `journalctl -u pyfiletransfer`
2. Review [Troubleshooting](#troubleshooting) section
3. Search [GitHub Issues](https://github.com/yourusername/pyfiletransfer/issues)
4. Open a new issue with:
   - Installation method
   - Error messages
   - System information
   - Steps to reproduce
