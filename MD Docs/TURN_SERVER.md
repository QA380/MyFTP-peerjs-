# TURN Server Setup Guide

TURN (Traversal Using Relays around NAT) servers help establish WebRTC connections when direct peer-to-peer connections fail due to strict NAT or firewall configurations.

## Why You Need a TURN Server

- **NAT Traversal**: Some networks block direct P2P connections
- **Firewall Compatibility**: Works through restrictive firewalls
- **Reliability**: Improves connection success rate from ~80% to ~99%
- **Corporate Networks**: Essential for users behind corporate proxies

## When to Use TURN

- Production deployments
- Users behind symmetric NAT
- Corporate/enterprise environments
- When connection success rate is critical

For development or local networks, public STUN servers (default) are usually sufficient.

## Option 1: Coturn (Recommended)

Coturn is the most popular open-source TURN server implementation.

### Installation on Ubuntu/Debian

1. Install Coturn:
```bash
sudo apt update
sudo apt install coturn
```

2. Enable Coturn:
```bash
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

3. Configure Coturn (`/etc/turnserver.conf`):
```bash
# Listen on all interfaces
listening-port=3478
tls-listening-port=5349

# Use fingerprints in TURN messages
fingerprint

# Use long-term credentials
lt-cred-mech

# Specify the user/password
user=username:password

# Realm for authentication
realm=yourdomain.com

# Log file location
log-file=/var/log/turnserver.log

# Enable verbose logging (optional)
verbose

# External IP (your server's public IP)
external-ip=YOUR_PUBLIC_IP

# Minimum and maximum port range for relay endpoints
min-port=49152
max-port=65535

# Deny all TCP peers (WebRTC uses UDP)
no-tcp-relay

# Enable STUN
# Comment out if you only want TURN
# stun-only
```

4. Set credentials:
```bash
# Generate a strong password
openssl rand -hex 16

# Add user to credentials
sudo turnadmin -a -u username -r yourdomain.com -p YOUR_PASSWORD
```

5. Configure firewall:
```bash
# UFW
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp
sudo ufw allow 49152:65535/udp

# iptables
sudo iptables -A INPUT -p udp --dport 3478 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 3478 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 5349 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 49152:65535 -j ACCEPT
```

6. Start and enable Coturn:
```bash
sudo systemctl start coturn
sudo systemctl enable coturn
sudo systemctl status coturn
```

7. Test the server:
```bash
# Install test tool
npm install -g turn-test

# Test TURN server
turn-test -s turn:yourdomain.com:3478 -u username -p password
```

### SSL/TLS Configuration

For production, enable TLS:

1. Get SSL certificate (Let's Encrypt):
```bash
sudo certbot certonly --standalone -d yourdomain.com
```

2. Update `/etc/turnserver.conf`:
```bash
# TLS certificates
cert=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
pkey=/etc/letsencrypt/live/yourdomain.com/privkey.pem
```

3. Set up certificate renewal:
```bash
# Create renewal hook
sudo nano /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
```

Content:
```bash
#!/bin/bash
systemctl restart coturn
```

Make executable:
```bash
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
```

### Coturn Performance Tuning

For high-traffic servers (`/etc/turnserver.conf`):

```bash
# Number of relay threads
relay-threads=10

# Maximum number of relay endpoints
max-bps=0

# Total allocation quota
total-quota=100

# Per-user allocation quota
user-quota=10
```

## Option 2: Docker Coturn

Quick deployment using Docker:

1. Create `docker-compose.coturn.yml`:
```yaml
version: '3.8'

services:
  coturn:
    image: coturn/coturn:latest
    container_name: coturn
    network_mode: host
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro
    restart: unless-stopped
```

2. Create `turnserver.conf`:
```bash
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
user=username:password
realm=yourdomain.com
external-ip=YOUR_PUBLIC_IP
min-port=49152
max-port=65535
no-tcp-relay
log-file=/var/log/turnserver.log
```

3. Run:
```bash
docker-compose -f docker-compose.coturn.yml up -d
```

## Option 3: Cloud TURN Services

For hassle-free setup, use managed TURN services:

### Twilio STUN/TURN

1. Sign up at https://www.twilio.com
2. Get API credentials
3. Use Twilio's network traversal service

Configuration:
```javascript
const config = {
    iceServers: [
        {
            urls: 'stun:global.stun.twilio.com:3478',
        },
        {
            urls: 'turn:global.turn.twilio.com:3478?transport=udp',
            username: 'your-username',
            credential: 'your-password'
        }
    ]
};
```

### Metered TURN Servers

1. Sign up at https://www.metered.ca
2. Get credentials
3. Use their TURN servers

### Xirsys

1. Sign up at https://xirsys.com
2. Create a channel
3. Get ICE servers

## Configuring PyFileTransfer

### Update WebRTC Configuration

Edit `static/js/sender.js` and `static/js/receiver.js`:

```javascript
const config = {
    iceServers: [
        // STUN servers
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:yourdomain.com:3478' },
        
        // TURN server (UDP)
        {
            urls: 'turn:yourdomain.com:3478?transport=udp',
            username: 'username',
            credential: 'password'
        },
        
        // TURN server (TCP)
        {
            urls: 'turn:yourdomain.com:3478?transport=tcp',
            username: 'username',
            credential: 'password'
        },
        
        // TURN server (TLS)
        {
            urls: 'turns:yourdomain.com:5349?transport=tcp',
            username: 'username',
            credential: 'password'
        }
    ],
    iceCandidatePoolSize: 10
};
```

### Environment-Based Configuration

For better security, use environment-based configuration:

1. Create `static/js/config.js`:
```javascript
// This file should be generated during deployment
window.WEBRTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
            urls: 'turn:yourdomain.com:3478',
            username: 'username',
            credential: 'password'
        }
    ]
};
```

2. Update templates to include config:
```html
<script src="/static/js/config.js"></script>
<script src="/static/js/sender.js"></script>
```

3. Use in sender.js/receiver.js:
```javascript
const config = window.WEBRTC_CONFIG || {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};
```

## Testing TURN Server

### Manual Testing

```bash
# Install test tools
npm install -g turn-test

# Test TURN
turn-test -s turn:yourdomain.com:3478 -u username -p password

# Test TURNS (TLS)
turn-test -s turns:yourdomain.com:5349 -u username -p password
```

### Browser Testing

1. Open Chrome: `chrome://webrtc-internals/`
2. Start a file transfer
3. Check ICE candidates - should see "relay" type candidates
4. Verify connection uses TURN (relay) if direct connection fails

### Connection Statistics

Add to your WebRTC code:
```javascript
peerConnection.addEventListener('icecandidate', event => {
    if (event.candidate) {
        console.log('ICE Candidate Type:', event.candidate.type);
        console.log('ICE Candidate:', event.candidate.candidate);
    }
});
```

Candidate types:
- `host`: Direct connection
- `srflx`: STUN reflexive (NAT traversal)
- `relay`: TURN relay (requires TURN server)

## Security Best Practices

1. **Use Strong Credentials**:
```bash
# Generate secure password
openssl rand -base64 32
```

2. **Rotate Credentials Regularly**:
```bash
# Update turnserver.conf and restart
sudo turnadmin -a -u newuser -r yourdomain.com -p NEWPASSWORD
sudo systemctl restart coturn
```

3. **Rate Limiting**:
```bash
# In turnserver.conf
max-bps=1000000  # 1 Mbps per session
total-quota=100
user-quota=10
```

4. **IP Whitelisting** (optional):
```bash
# Allow only specific IPs
allowed-peer-ip=YOUR_APP_SERVER_IP
```

5. **Monitoring**:
```bash
# Monitor logs
tail -f /var/log/turnserver.log

# Check connections
sudo netstat -tulpn | grep turnserver
```

## Monitoring and Maintenance

### Log Analysis

```bash
# View active sessions
grep "session" /var/log/turnserver.log | tail -20

# View allocation requests
grep "allocation" /var/log/turnserver.log

# Monitor errors
grep "error" /var/log/turnserver.log
```

### Performance Metrics

```bash
# Check CPU/Memory
htop

# Network usage
iftop

# Connection count
ss -s
```

### Automated Monitoring

Set up alerts:
```bash
# Install monitoring
sudo apt install prometheus-node-exporter

# Configure alerts for:
# - High CPU usage
# - High bandwidth
# - Connection failures
# - Port exhaustion
```

## Troubleshooting

### Connection Fails

1. Check firewall:
```bash
sudo ufw status
```

2. Verify external IP:
```bash
curl ifconfig.me
```

3. Test connectivity:
```bash
nc -vz yourdomain.com 3478
```

### High Latency

1. Check server load:
```bash
uptime
top
```

2. Optimize relay threads in turnserver.conf:
```bash
relay-threads=20
```

### Port Exhaustion

Increase port range:
```bash
# In turnserver.conf
min-port=10000
max-port=60000
```

## Cost Estimation

Self-hosted TURN server costs:
- **VPS**: $5-20/month (DigitalOcean, Linode)
- **Bandwidth**: ~1-5 GB per file transfer
- **Domain**: $10-15/year
- **SSL Certificate**: Free (Let's Encrypt)

Managed services:
- **Twilio**: Pay per use (~$0.0005/minute)
- **Xirsys**: $10-50/month
- **Metered**: $10-100/month

## Best Practices

1. **Redundancy**: Run multiple TURN servers
2. **Geographic Distribution**: Deploy servers in multiple regions
3. **Load Balancing**: Distribute traffic across servers
4. **Monitoring**: Set up uptime monitoring
5. **Backups**: Regular configuration backups
6. **Updates**: Keep Coturn updated
7. **Documentation**: Document your specific configuration

## Additional Resources

- [Coturn Documentation](https://github.com/coturn/coturn)
- [WebRTC Samples](https://webrtc.github.io/samples/)
- [TURN Server Configuration Guide](https://www.html5rocks.com/en/tutorials/webrtc/infrastructure/)
- [ICE Candidate Types](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate)
