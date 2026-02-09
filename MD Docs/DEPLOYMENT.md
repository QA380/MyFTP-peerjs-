# Deployment Guide

Production deployment guide for PyFileTransfer.

## Table of Contents

- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Deployment Options](#deployment-options)
- [Production Configuration](#production-configuration)
- [Monitoring](#monitoring)
- [Backup and Recovery](#backup-and-recovery)
- [Scaling](#scaling)

## Pre-Deployment Checklist

Before deploying to production:

- [ ] Domain name registered and configured
- [ ] SSL certificate obtained (Let's Encrypt recommended)
- [ ] Server/VPS provisioned (minimum 1GB RAM, 1 CPU)
- [ ] Firewall configured
- [ ] TURN server set up (optional but recommended)
- [ ] Monitoring tools configured
- [ ] Backup strategy defined

## Deployment Options

### Option 1: Docker Compose (Recommended)

**Best for**: Quick deployment, easy updates, consistent environment

**Steps**:

1. **Prepare Server**:
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin
```

2. **Clone and Configure**:
```bash
# Clone repository
git clone https://github.com/yourusername/pyfiletransfer.git
cd pyfiletransfer

# Create environment file
cat > .env << EOF
LOG_LEVEL=info
DOMAIN=your-domain.com
EOF
```

3. **SSL Certificates**:
```bash
# Install Certbot
sudo apt install certbot

# Get certificate
sudo certbot certonly --standalone -d your-domain.com

# Copy to project
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem docker/ssl/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem docker/ssl/key.pem
sudo chown $USER:$USER docker/ssl/*.pem
```

4. **Deploy**:
```bash
# Start with Nginx
docker-compose --profile with-nginx up -d

# Verify
docker-compose ps
docker-compose logs -f
```

5. **Configure Auto-Renewal**:
```bash
# Add renewal hook
sudo bash -c 'cat > /etc/letsencrypt/renewal-hooks/deploy/docker-reload.sh << EOF
#!/bin/bash
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem /path/to/pyfiletransfer/docker/ssl/cert.pem
cp /etc/letsencrypt/live/your-domain.com/privkey.pem /path/to/pyfiletransfer/docker/ssl/key.pem
cd /path/to/pyfiletransfer
docker-compose restart nginx
EOF'

sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/docker-reload.sh
```

### Option 2: Systemd Service

**Best for**: Direct control, minimal overhead

**Steps**:

1. **Setup Application**:
```bash
# Create user
sudo useradd -r -s /bin/false pyfiletransfer

# Install to /opt
sudo git clone https://github.com/yourusername/pyfiletransfer.git /opt/pyfiletransfer
cd /opt/pyfiletransfer

# Setup virtual environment
sudo python3.11 -m venv venv
sudo venv/bin/pip install -r requirements.txt

# Set permissions
sudo chown -R pyfiletransfer:pyfiletransfer /opt/pyfiletransfer
```

2. **Install Service**:
```bash
sudo cp docker/pyfiletransfer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable pyfiletransfer
sudo systemctl start pyfiletransfer
```

3. **Setup Nginx**:
```bash
# Install Nginx
sudo apt install nginx

# Configure
sudo nano /etc/nginx/sites-available/pyfiletransfer
```

Content:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/pyfiletransfer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Option 3: Cloud Platforms

#### DigitalOcean App Platform

1. Create `app.yaml`:
```yaml
name: pyfiletransfer
services:
- name: web
  github:
    repo: yourusername/pyfiletransfer
    branch: main
    deploy_on_push: true
  run_command: uvicorn src.main:app --host 0.0.0.0 --port 8080
  http_port: 8080
  health_check:
    http_path: /health
  instance_count: 1
  instance_size_slug: basic-xxs
```

2. Deploy:
```bash
doctl apps create --spec app.yaml
```

#### Railway

1. Connect GitHub repository
2. Configure:
   - Start Command: `uvicorn src.main:app --host 0.0.0.0 --port $PORT`
   - Health Check: `/health`
3. Deploy automatically on push

#### AWS Elastic Beanstalk

1. Install EB CLI:
```bash
pip install awsebcli
```

2. Initialize:
```bash
eb init -p python-3.11 pyfiletransfer
```

3. Create `Procfile`:
```
web: uvicorn src.main:app --host 0.0.0.0 --port 8080
```

4. Deploy:
```bash
eb create pyfiletransfer-env
eb open
```

## Production Configuration

### Environment Variables

Create `.env` file:
```bash
# Application
LOG_LEVEL=info
HOST=0.0.0.0
PORT=8080

# Domain
DOMAIN=your-domain.com

# Security
ALLOWED_ORIGINS=https://your-domain.com

# Rate Limiting (if implemented)
MAX_CONNECTIONS_PER_IP=10
MAX_ROOMS_PER_IP=5
```

### Nginx Configuration

Optimized production config:

```nginx
# /etc/nginx/nginx.conf

user www-data;
worker_processes auto;
pid /run/nginx.pid;

events {
    worker_connections 2048;
    use epoll;
}

http {
    # Basic Settings
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    
    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    
    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/json application/javascript;
    
    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    
    # Include site configs
    include /etc/nginx/sites-enabled/*;
}
```

### Firewall Configuration

```bash
# UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# For TURN server
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp
sudo ufw allow 49152:65535/udp
```

### Security Hardening

1. **Disable Debug Mode**:
```python
# In production, set:
reload=False
log_level="info"
```

2. **Use Strong SSL**:
```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers on;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
```

3. **Enable HSTS**:
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

4. **Regular Updates**:
```bash
# Weekly security updates
sudo apt update && sudo apt upgrade -y
```

## Monitoring

### Application Monitoring

1. **Health Checks**:
```bash
# Create monitoring script
cat > /usr/local/bin/check-pyfiletransfer.sh << 'EOF'
#!/bin/bash
status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health)
if [ "$status" != "200" ]; then
    echo "Service unhealthy: $status"
    systemctl restart pyfiletransfer
fi
EOF

chmod +x /usr/local/bin/check-pyfiletransfer.sh

# Add to crontab
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/check-pyfiletransfer.sh") | crontab -
```

2. **Log Monitoring**:
```bash
# View logs
docker-compose logs -f pyfiletransfer
# or
sudo journalctl -u pyfiletransfer -f
```

3. **Metrics Collection**:

Install Prometheus Node Exporter:
```bash
sudo apt install prometheus-node-exporter
```

### Uptime Monitoring

Use external services:
- UptimeRobot (free)
- Pingdom
- StatusCake
- Healthchecks.io

Configure to check:
- HTTPS endpoint
- `/health` endpoint
- SSL certificate expiry

### Log Aggregation

Use centralized logging:

1. **Syslog**:
```python
import logging
import logging.handlers

handler = logging.handlers.SysLogHandler(address='/dev/log')
logger.addHandler(handler)
```

2. **ELK Stack** (Elasticsearch, Logstash, Kibana)
3. **Loki + Grafana**
4. **CloudWatch** (AWS)

## Backup and Recovery

### What to Backup

- Application code (Git repository)
- Configuration files
- SSL certificates
- Docker volumes (if using Docker)
- Environment files

### Backup Script

```bash
#!/bin/bash
# /usr/local/bin/backup-pyfiletransfer.sh

BACKUP_DIR="/var/backups/pyfiletransfer"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup configuration
tar -czf $BACKUP_DIR/config_$DATE.tar.gz \
    /opt/pyfiletransfer/docker \
    /opt/pyfiletransfer/.env \
    /etc/nginx/sites-available/pyfiletransfer \
    /etc/letsencrypt/live

# Keep only last 7 days
find $BACKUP_DIR -name "config_*.tar.gz" -mtime +7 -delete
```

Schedule:
```bash
# Add to crontab
0 2 * * * /usr/local/bin/backup-pyfiletransfer.sh
```

### Disaster Recovery

1. **Documentation**: Keep deployment docs updated
2. **Infrastructure as Code**: Use Terraform/Ansible
3. **Configuration Management**: Version control all configs
4. **Regular Testing**: Test restore procedures quarterly

## Scaling

### Vertical Scaling

Upgrade server resources:
- 1GB RAM → 2GB RAM
- 1 CPU → 2 CPUs
- Add more workers:

```bash
uvicorn src.main:app --workers 4 --host 0.0.0.0 --port 8080
```

### Horizontal Scaling

Multiple server instances:

1. **Load Balancer**:
```nginx
upstream pyfiletransfer {
    ip_hash;  # Required for WebSocket
    server server1.example.com:8080;
    server server2.example.com:8080;
    server server3.example.com:8080;
}

server {
    location / {
        proxy_pass http://pyfiletransfer;
    }
}
```

2. **Shared State** (if needed):
   - Redis for room metadata
   - Shared storage for configs

### CDN Integration

For static assets:
- CloudFlare
- AWS CloudFront
- Fastly

### Database (Future Enhancement)

If adding persistence:
- PostgreSQL for metadata
- Redis for sessions
- S3 for optional storage

## Performance Tuning

### Application

```python
# Increase worker count
uvicorn src.main:app --workers 4

# Adjust timeouts
--timeout-keep-alive 75
--limit-concurrency 1000
```

### Nginx

```nginx
worker_processes auto;
worker_connections 2048;
keepalive_timeout 65;
client_max_body_size 0;  # No limit on upload size
```

### System

```bash
# Increase file descriptors
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf

# TCP tuning
cat >> /etc/sysctl.conf << EOF
net.core.somaxconn = 65536
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_tw_reuse = 1
EOF

sysctl -p
```

## Troubleshooting Production Issues

### High CPU Usage

```bash
# Check processes
top -o %CPU

# Check connections
netstat -ant | grep ESTABLISHED | wc -l

# Restart service
docker-compose restart pyfiletransfer
```

### Memory Leaks

```bash
# Monitor memory
watch -n 1 'docker stats pyfiletransfer'

# Check for leaks
docker logs pyfiletransfer | grep -i memory
```

### Connection Issues

```bash
# Test WebSocket
wscat -c wss://your-domain.com/ws/test

# Check nginx logs
sudo tail -f /var/log/nginx/error.log

# Check SSL
openssl s_client -connect your-domain.com:443
```

## Maintenance

### Regular Tasks

**Daily**:
- Monitor error logs
- Check health endpoint
- Verify SSL certificate

**Weekly**:
- Review metrics
- Check disk space
- Update dependencies

**Monthly**:
- Security updates
- SSL certificate renewal check
- Review and rotate logs

### Update Procedure

```bash
# 1. Backup
/usr/local/bin/backup-pyfiletransfer.sh

# 2. Pull updates
cd /opt/pyfiletransfer
git pull

# 3. Update dependencies
docker-compose build --no-cache
# or
venv/bin/pip install -r requirements.txt

# 4. Restart
docker-compose up -d
# or
sudo systemctl restart pyfiletransfer

# 5. Verify
curl https://your-domain.com/health
```

## Cost Estimation

**Monthly Costs**:

Small deployment:
- VPS (2GB RAM): $10-15
- Domain: $1
- SSL: Free (Let's Encrypt)
- **Total**: ~$11-16/month

Medium deployment:
- VPS (4GB RAM): $20-30
- TURN server: $10
- Monitoring: $10
- **Total**: ~$40-50/month

Large deployment:
- Multiple servers: $60-100
- Load balancer: $20
- CDN: $20
- Monitoring: $30
- **Total**: ~$130-170/month

## Support

For deployment help:
- [GitHub Issues](https://github.com/yourusername/pyfiletransfer/issues)
- [Documentation](https://github.com/yourusername/pyfiletransfer/docs)
- Community Discord/Slack
