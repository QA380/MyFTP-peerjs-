# User Guide

Complete guide to using PyFileTransfer for secure peer-to-peer file sharing.

## Table of Contents

- [Quick Start](#quick-start)
- [Sending Files](#sending-files)
- [Receiving Files](#receiving-files)
- [Tips and Best Practices](#tips-and-best-practices)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

## Quick Start

### What You Need

- Modern web browser (Chrome, Firefox, Safari, or Edge)
- Internet connection
- Files to share

### Basic Flow

1. Sender selects files and generates a share link
2. Sender shares link with receiver (via email, chat, etc.)
3. Receiver clicks link and accepts transfer
4. Files transfer directly between browsers
5. Receiver automatically downloads files

**Total Time**: Usually 1-2 minutes for small files

## Sending Files

### Step 1: Access PyFileTransfer

Navigate to your PyFileTransfer instance:
```
https://your-domain.com
```

Click the "Send Files" button.

### Step 2: Select Files

1. Click "Choose Files" button
2. Select one or multiple files from your computer
3. Files appear in the list with their sizes

**Supported Files**:
- Any file type
- Multiple files at once
- Total size limited only by available memory

**File Size Recommendations**:
- Small files (<100MB): Works great on any connection
- Medium files (100MB-1GB): Recommended for good connections
- Large files (>1GB): Requires stable connection, consider TURN server

### Step 3: Share the Link

After selecting files, you'll see:
- **Share Link**: Copy-paste link to send to receiver
- **QR Code**: Scan with mobile device for easy sharing
- **Copy Button**: One-click copy to clipboard

**Sharing Methods**:
- Email: Paste link in email
- Chat Apps: Send via WhatsApp, Slack, Discord, etc.
- QR Code: Let receiver scan with phone camera

**Security Note**: Anyone with the link can download files. Only share with intended recipients.

### Step 4: Wait for Receiver

You'll see a "Waiting for receiver..." message.

**What's Happening**:
- Your browser is ready to transfer
- Link is active and waiting
- Keep browser tab open

**Tips**:
- Don't close the browser tab
- Don't let computer sleep
- Stay on stable internet connection

### Step 5: Transfer Progress

Once receiver connects:
- Progress bar for each file
- Transfer speed in real-time
- Time remaining estimate
- Overall completion status

**During Transfer**:
- Browser tab can be in background
- Allowed to use other tabs
- Do not close the tab
- Do not lose internet connection

### Step 6: Transfer Complete

Success message appears when done!

**Options**:
- Send more files (new session)
- Close the tab
- Start another transfer

## Receiving Files

### Step 1: Access Share Link

Click the link sent by the sender:
```
https://your-domain.com/receive/xh3kJ9mP2nQ8rT4vW6yZ
```

Or scan QR code with phone camera.

### Step 2: Review Files

You'll see:
- List of files to receive
- File names and sizes
- Total download size

**Before Accepting**:
- Verify sender identity
- Check file names look correct
- Ensure you have enough storage space

### Step 3: Accept or Decline

**Accept**: Click "Accept & Download" to start transfer
**Decline**: Click "Decline" to cancel

**What Happens**:
- Accept: Files begin downloading immediately
- Decline: Connection closes, sender is notified

### Step 4: Receive Files

Transfer begins automatically:
- Progress bar for each file
- Speed and time remaining
- Browser downloads files as they complete

**Where Files Go**:
- Default browser download folder
- Usually: `~/Downloads` or `C:\Users\[You]\Downloads`
- Check browser downloads list (Ctrl+J or Cmd+J)

**During Transfer**:
- Keep browser tab open
- Stay connected to internet
- Don't navigate away

### Step 5: Transfer Complete

Files automatically download to your computer!

**Check Downloads**:
- Files should appear in Downloads folder
- Verify all expected files arrived
- Scan files with antivirus if from unknown sender

## Tips and Best Practices

### For Best Performance

1. **Use Wired Connection**: More stable than WiFi
2. **Close Unnecessary Tabs**: Free up browser resources
3. **Disable VPN**: Can interfere with P2P connections
4. **Same Network**: Fastest when both on same local network
5. **Modern Browser**: Use latest version of Chrome/Firefox

### Security Tips

1. **Verify Sender**: Confirm identity before accepting files
2. **Scan Files**: Run antivirus on received files
3. **Use HTTPS**: Ensure connection shows padlock icon
4. **Private Links**: Don't share links publicly
5. **Delete Links**: Link expires after use, but delete from chat history

### Optimization

**Small Files** (<10MB):
- Works on any connection
- Mobile data friendly
- Very fast transfer

**Medium Files** (10MB-500MB):
- Use WiFi connection
- Stable environment recommended
- Transfer time: few minutes

**Large Files** (>500MB):
- Wired connection recommended
- TURN server helpful
- May take 10+ minutes
- Consider splitting into smaller transfers

### Mobile Usage

**Sending from Mobile**:
1. Open browser (Chrome/Safari)
2. Select files from gallery/files app
3. Share link via app
4. Keep app in foreground

**Receiving on Mobile**:
1. Click link in chat app
2. Opens browser automatically
3. Accept transfer
4. Files download to device
5. Find in Downloads or Files app

**Mobile Tips**:
- Charge device or connect to power
- Use WiFi, not cellular data (for large files)
- Disable auto-lock/sleep
- Keep app in foreground

## Troubleshooting

### Connection Issues

**"Waiting for receiver..." stuck**:
- Check receiver clicked correct link
- Verify both have internet connection
- Try refreshing both pages
- Check firewall isn't blocking WebRTC

**"Connection failed"**:
- One party may be behind restrictive firewall
- Enable TURN server (contact admin)
- Try different network
- Disable VPN temporarily

**Transfer interrupted**:
- Check internet connection
- Ensure browser tab stayed open
- Verify computer didn't sleep
- Restart transfer from beginning

### Performance Issues

**Slow transfer speed**:
- Check internet speed (speedtest.net)
- Close other downloads/streams
- Use wired connection
- Try during off-peak hours

**Browser freezing**:
- File may be too large
- Close other tabs
- Try smaller chunks
- Use desktop instead of mobile

**High CPU usage**:
- Normal during transfer
- CPU encrypts data
- Larger files = more CPU
- Will return to normal after transfer

### File Issues

**File won't download**:
- Check browser download permissions
- Verify disk space available
- Try different browser
- Check download folder isn't full

**Incomplete transfer**:
- Connection was interrupted
- Must restart from beginning
- Ensure stable connection
- Consider splitting into smaller transfers

**Wrong file received**:
- Verify with sender
- Check file name/size
- May need to re-transfer
- Scan for malware before opening

## FAQ

### General

**Q: Is this secure?**
A: Yes, files are transferred via encrypted WebRTC connections. Files never touch the server.

**Q: How large can files be?**
A: Limited only by browser memory. Typically up to 2-4GB works well. Larger files may require TURN server.

**Q: Can I send multiple files?**
A: Yes! Select multiple files at once, they'll transfer sequentially.

**Q: Does it work on mobile?**
A: Yes, works on iOS Safari and Android Chrome.

**Q: Do both users need accounts?**
A: No, completely anonymous. No registration required.

### Technical

**Q: Where are files stored?**
A: Files are never stored on the server. They go directly from sender to receiver.

**Q: What happens to the link after use?**
A: Link becomes invalid after the transfer completes or if either party disconnects.

**Q: Can I resume if connection drops?**
A: No, currently transfers must start over. Keep connections stable.

**Q: Why does it need camera/microphone permissions?**
A: It doesn't! WebRTC is used for data only, not video/audio.

**Q: Does it work behind corporate firewall?**
A: Usually yes, but may require TURN server for restrictive firewalls.

### Privacy

**Q: Can the server see my files?**
A: No, files transfer peer-to-peer. Server only facilitates connection.

**Q: Can others intercept my files?**
A: No, WebRTC uses DTLS encryption. Files are encrypted in transit.

**Q: What logs are kept?**
A: Only connection metadata (timestamps, IPs). No file content or names.

**Q: Can I delete transfer history?**
A: No history is stored. Transfers are ephemeral.

**Q: Is this GDPR compliant?**
A: Yes, no personal data is stored. Files never touch the server.

### Limits

**Q: How many people can receive same files?**
A: Currently one receiver per transfer. Sender must create new links for additional receivers.

**Q: How long is link valid?**
A: Links are valid until transfer completes or sender closes browser.

**Q: Daily transfer limit?**
A: No built-in limits. Administrator may set rate limits.

**Q: Maximum file count?**
A: No hard limit, but recommend <100 files per transfer for performance.

## Getting Help

If you encounter issues:

1. **Check This Guide**: Review troubleshooting section
2. **Test Connection**: Verify internet is working
3. **Try Again**: Many issues resolve with retry
4. **Different Browser**: Try Chrome or Firefox
5. **Contact Admin**: If self-hosted, contact your admin
6. **Report Bug**: Open issue on GitHub

## Best Use Cases

**Perfect For**:
- Sending large files quickly
- Sharing sensitive documents
- No-cloud file sharing
- Temporary file exchange
- Cross-platform transfers

**Not Ideal For**:
- Long-term storage (use cloud storage)
- Multiple recipients (must send separately)
- Unreliable connections (may interrupt)
- Automated/scheduled transfers (manual process)

## Comparison

| Feature | PyFileTransfer | Email | Cloud Storage |
|---------|---------------|-------|---------------|
| File Size | GB+ | 25MB | GB+ |
| Speed | Fast (P2P) | Slow | Medium |
| Privacy | High | Medium | Medium |
| Storage | None | Inbox | Cloud |
| Expiry | Immediate | Manual | Configurable |
| Setup | None | Account | Account |
