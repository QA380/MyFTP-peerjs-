"use client";

import Peer, { DataConnection, MediaConnection } from "peerjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type LogRow = {
  id: number;
  text: string;
  error: boolean;
};

type FilePayload = {
  kind: "file";
  name: string;
  mime: string;
  size: number;
  data: ArrayBuffer;
};

type SelectionInfo = {
  count: number;
  totalBytes: number;
  ready: boolean;
};

type InboxItem = {
  id: string;
  source: "Files" | "Folder";
  name: string;
  size: number;
  mime: string;
  url: string;
};

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const value = Math.log(bytes) / Math.log(1024);
  const index = Math.min(Math.floor(value), units.length - 1);
  const scaled = bytes / 1024 ** index;

  return `${scaled.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
};

const inputClass =
  "w-full rounded-xl border border-slate-700 bg-[#030712]/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400";
const buttonClass =
  "rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400";

export default function Home() {
  const [mode, setMode] = useState<"cloud" | "local">("cloud");
  const [host, setHost] = useState("0.peerjs.com");
  const [port, setPort] = useState("443");
  const [path, setPath] = useState("/");
  const [secure, setSecure] = useState("true");
  const [myId, setMyId] = useState("Connecting...");
  const [targetId, setTargetId] = useState("");
  const [message, setMessage] = useState("");
  const [sender, setSender] = useState("");
  const [connState, setConnState] = useState("Not connected");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [callType, setCallType] = useState<"audio" | "video" | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const [streamVersion, setStreamVersion] = useState(0);
  const [fileSelection, setFileSelection] = useState<SelectionInfo>({ count: 0, totalBytes: 0, ready: false });
  const [folderSelection, setFolderSelection] = useState<SelectionInfo>({ count: 0, totalBytes: 0, ready: false });
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const activeConnRef = useRef<DataConnection | null>(null);
  const mediaConnRef = useRef<MediaConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const incomingTransferLabelRef = useRef<"Files" | "Folder">("Files");
  const inboxItemsRef = useRef<InboxItem[]>([]);

  const modeHint = useMemo(
    () => "For local mode, use host localhost, port 9000, path /myapp, secure false.",
    []
  );

  const pushLog = useCallback((line: string, error = false) => {
    const stamp = new Date().toLocaleTimeString();
    const text = `[${stamp}] ${line}`;
    setLogs((prev) => [...prev, { id: Date.now() + Math.random(), text, error }]);
  }, []);

  const stopStream = useCallback((stream: MediaStream | null) => {
    if (!stream) {
      return;
    }
    stream.getTracks().forEach((track) => track.stop());
  }, []);

  const setLocalStream = useCallback(
    (stream: MediaStream) => {
      stopStream(localStreamRef.current);
      stream.getAudioTracks().forEach((track) => {
        track.enabled = micEnabled;
      });
      stream.getVideoTracks().forEach((track) => {
        track.enabled = cameraEnabled;
      });
      localStreamRef.current = stream;
      setStreamVersion((prev) => prev + 1);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    },
    [cameraEnabled, micEnabled, stopStream]
  );

  const setRemoteStream = useCallback((stream: MediaStream) => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
    }
  }, []);

  const clearMediaStreams = useCallback(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }, []);

  const stopAudioMeter = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    sourceNodeRef.current?.disconnect();
    analyserRef.current?.disconnect();
    sourceNodeRef.current = null;
    analyserRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setAudioLevel(0);
  }, []);

  const requireConnection = useCallback(() => {
    if (!activeConnRef.current || !activeConnRef.current.open) {
      pushLog("No open connection. Connect first.", true);
      return false;
    }
    return true;
  }, [pushLog]);

  const readFilesAsPayloads = useCallback(
    (files: FileList) =>
      Promise.all(
        Array.from(files).map(
          (file) =>
            new Promise<FilePayload>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                resolve({
                  kind: "file",
                  name: file.webkitRelativePath || file.name,
                  mime: file.type || "application/octet-stream",
                  size: file.size,
                  data: reader.result as ArrayBuffer,
                });
              };
              reader.onerror = () => reject(reader.error);
              reader.readAsArrayBuffer(file);
            })
        )
      ),
    []
  );

  const summarizeSelection = useCallback((files: FileList | null): SelectionInfo => {
    if (!files || files.length === 0) {
      return { count: 0, totalBytes: 0, ready: false };
    }

    const totalBytes = Array.from(files).reduce((sum, file) => sum + file.size, 0);
    return {
      count: files.length,
      totalBytes,
      ready: true,
    };
  }, []);

  const extractArrayBuffer = useCallback((payload: unknown): ArrayBuffer | null => {
    if (payload instanceof ArrayBuffer) {
      return payload;
    }

    if (payload instanceof Uint8Array) {
      const bytes = payload.byteLength > 0
        ? payload.slice()
        : new Uint8Array(0);
      return bytes.buffer;
    }

    if (
      typeof payload === "object" &&
      payload !== null &&
      "type" in payload &&
      "data" in payload &&
      (payload as { type?: string }).type === "Buffer" &&
      Array.isArray((payload as { data?: unknown }).data)
    ) {
      const bytes = new Uint8Array((payload as { data: number[] }).data);
      return bytes.buffer;
    }

    return null;
  }, []);

  const clearSelectedUpload = useCallback((label: "file" | "folder") => {
    if (label === "file") {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setFileSelection({ count: 0, totalBytes: 0, ready: false });
      pushLog("Removed uploaded file selection.");
      return;
    }

    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
    setFolderSelection({ count: 0, totalBytes: 0, ready: false });
    pushLog("Removed uploaded folder selection.");
  }, [pushLog]);

  const clearInbox = useCallback(() => {
    inboxItemsRef.current.forEach((item) => {
      URL.revokeObjectURL(item.url);
    });
    setInboxItems([]);
    pushLog("Cleared received inbox.");
  }, [pushLog]);

  const removeInboxItem = useCallback((id: string) => {
    setInboxItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const wireConnection = useCallback(
    (conn: DataConnection) => {
      activeConnRef.current = conn;
      setConnState(`Connected to ${conn.peer}`);
      pushLog(`Connection opened with ${conn.peer}`);

      conn.on("data", (data) => {
        if (typeof data === "string") {
          pushLog(`Received: ${data}`);
          return;
        }

        if (typeof data === "object" && data !== null && "kind" in data) {
          const payload = data as {
            kind?: string;
            label?: "Files" | "Folder";
            count?: number;
            name?: string;
            mime?: string;
            size?: number;
            data?: unknown;
          };

          if (payload.kind === "transfer-start") {
            const source = payload.label === "Folder" ? "Folder" : "Files";
            incomingTransferLabelRef.current = source;
            pushLog(`Incoming ${source.toLowerCase()} transfer: ${payload.count ?? 0} item(s).`);
            return;
          }

          if (payload.kind === "file") {
            const buffer = extractArrayBuffer(payload.data);
            if (!buffer) {
              pushLog(`Received file metadata but could not parse binary data for ${payload.name ?? "unknown"}.`, true);
              return;
            }

            const mime = payload.mime || "application/octet-stream";
            const blob = new Blob([buffer], { type: mime });
            const url = URL.createObjectURL(blob);
            const size = typeof payload.size === "number" ? payload.size : blob.size;

            setInboxItems((prev) => [
              {
                id: `${Date.now()}-${Math.random()}`,
                source: incomingTransferLabelRef.current,
                name: payload.name || "unnamed-file",
                size,
                mime,
                url,
              },
              ...prev,
            ]);
            pushLog(`Received file ready in inbox: ${payload.name || "unnamed-file"} (${formatBytes(size)}).`);
            return;
          }
        }

        pushLog(`Received: ${JSON.stringify(data)}`);
      });

      conn.on("close", () => {
        pushLog("Connection closed");
        activeConnRef.current = null;
        setConnState("Not connected");
      });

      conn.on("error", (err) => {
        pushLog(`Connection error: ${err.message || err}`, true);
      });
    },
    [extractArrayBuffer, pushLog]
  );

  const makePeer = useCallback(() => {
    if (peerRef.current) {
      try {
        peerRef.current.destroy();
      } catch (err) {
        pushLog(`Destroy warning: ${String(err)}`, true);
      }
    }

    activeConnRef.current = null;
    setConnState("Not connected");
    setMyId("Connecting...");

    const options = {
      host: host.trim(),
      port: Number(port.trim() || 443),
      path: path.trim() || "/",
      secure: secure.trim().toLowerCase() !== "false",
    };

    pushLog(`Connecting with ${JSON.stringify(options)}`);
    const peer = new Peer(options);
    peerRef.current = peer;

    peer.on("open", (id) => {
      setMyId(id);
      pushLog(`Peer ready. ID: ${id}`);
    });

    peer.on("connection", (conn) => {
      pushLog(`Incoming connection from ${conn.peer}`);
      conn.on("open", () => wireConnection(conn));
    });

    peer.on("call", async (call) => {
      pushLog(`Incoming call from ${call.peer}`);
      try {
        if (!localStreamRef.current) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          setLocalStream(stream);
        }

        call.answer(localStreamRef.current ?? undefined);
        call.on("stream", (remoteStream) => {
          setRemoteStream(remoteStream);
          setCallType(remoteStream.getVideoTracks().length > 0 ? "video" : "audio");
          pushLog(`Call stream received from ${call.peer}`);
        });
        call.on("close", () => {
          setCallType(null);
          clearMediaStreams();
          pushLog("Incoming call closed.");
        });
        call.on("error", (err) => pushLog(`Incoming call error: ${err.message || err}`, true));
        mediaConnRef.current = call;
      } catch (err) {
        pushLog(`Could not answer call: ${String(err)}`, true);
      }
    });

    peer.on("error", (err) => {
      pushLog(`Peer error: ${err.type || ""} ${err.message || err}`.trim(), true);
    });
  }, [clearMediaStreams, host, path, port, pushLog, secure, setLocalStream, setRemoteStream, wireConnection]);

  const applyModeDefaults = useCallback(
    (nextMode: "cloud" | "local") => {
      if (nextMode === "local") {
        setHost("localhost");
        setPort("9000");
        setPath("/myapp");
        setSecure("false");
        return;
      }
      setHost("0.peerjs.com");
      setPort("443");
      setPath("/");
      setSecure("true");
    },
    []
  );

  const connectToTarget = useCallback(() => {
    if (!peerRef.current) {
      pushLog("Peer is not initialized yet.", true);
      return;
    }

    const trimmed = targetId.trim();
    if (!trimmed) {
      pushLog("Please enter a target peer ID first.", true);
      return;
    }

    const conn = peerRef.current.connect(trimmed);
    conn.on("open", () => wireConnection(conn));
  }, [pushLog, targetId, wireConnection]);

  const sendCurrentMessage = useCallback(() => {
    if (!requireConnection()) {
      return;
    }

    const text = message.trim();
    if (!text) {
      pushLog("Message is empty.", true);
      return;
    }

    const payload = sender.trim() ? `${sender.trim()}: ${text}` : text;
    activeConnRef.current?.send(payload);
    pushLog(`Sent: ${payload}`);
    setMessage("");
  }, [message, pushLog, requireConnection, sender]);

  const sendFilePayloads = useCallback(
    async (files: FileList | null, label: "Files" | "Folder") => {
      if (!requireConnection()) {
        return;
      }
      if (!files || files.length === 0) {
        pushLog(`No ${label.toLowerCase()} selected.`, true);
        return;
      }

      const payloads = await readFilesAsPayloads(files);
      activeConnRef.current?.send({ kind: "transfer-start", label, count: payloads.length });

      for (const payload of payloads) {
        activeConnRef.current?.send(payload);
        pushLog(`Sent ${label.toLowerCase()}: ${payload.name}`);
      }

      pushLog(`${label} upload complete. ${payloads.length} item(s) sent successfully.`);
    },
    [pushLog, readFilesAsPayloads, requireConnection]
  );

  const startCall = useCallback(
    async (kind: "audio" | "video") => {
      if (!requireConnection()) {
        return;
      }
      if (!peerRef.current || !activeConnRef.current) {
        pushLog("Peer connection is not ready.", true);
        return;
      }

      const constraints =
        kind === "video" ? { audio: true, video: true } : { audio: true, video: false };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setLocalStream(stream);

        if (mediaConnRef.current) {
          mediaConnRef.current.close();
        }

        const call = peerRef.current.call(activeConnRef.current.peer, stream);
        mediaConnRef.current = call;
        setCallType(kind);

        call.on("stream", (remoteStream) => {
          setRemoteStream(remoteStream);
          pushLog(`${kind === "video" ? "Video" : "Audio"} call connected.`);
        });
        call.on("close", () => {
          setCallType(null);
          clearMediaStreams();
          pushLog("Call closed.");
        });
        call.on("error", (err) => pushLog(`Call error: ${err.message || err}`, true));
        pushLog(`Starting ${kind} call to ${activeConnRef.current.peer}`);
      } catch (err) {
        pushLog(`Could not start ${kind} call: ${String(err)}`, true);
      }
    },
    [clearMediaStreams, pushLog, requireConnection, setLocalStream, setRemoteStream]
  );

  const endCall = useCallback(() => {
    if (!mediaConnRef.current && !localStreamRef.current) {
      pushLog("No active call to end.", true);
      return;
    }

    mediaConnRef.current?.close();
    mediaConnRef.current = null;
    stopStream(localStreamRef.current);
    localStreamRef.current = null;
    setCallType(null);
    stopAudioMeter();
    clearMediaStreams();
    pushLog("Call ended.");
  }, [clearMediaStreams, pushLog, stopAudioMeter, stopStream]);

  const toggleMic = useCallback(() => {
    const next = !micEnabled;
    setMicEnabled(next);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    pushLog(next ? "Microphone enabled." : "Microphone muted.");
  }, [micEnabled, pushLog]);

  const toggleCamera = useCallback(() => {
    const next = !cameraEnabled;
    setCameraEnabled(next);

    const videoTracks = localStreamRef.current?.getVideoTracks() ?? [];
    if (videoTracks.length === 0) {
      pushLog("No camera track available in current call.", true);
      return;
    }

    videoTracks.forEach((track) => {
      track.enabled = next;
    });
    pushLog(next ? "Camera enabled." : "Camera disabled.");
  }, [cameraEnabled, pushLog]);

  const onFilesSelected = useCallback(
    (files: FileList | null, label: "file" | "folder") => {
      const summary = summarizeSelection(files);

      if (label === "file") {
        setFileSelection(summary);
      } else {
        setFolderSelection(summary);
      }

      if (summary.ready) {
        pushLog(
          `${label === "file" ? "Files" : "Folder"} uploaded: ${summary.count} item(s), ${formatBytes(summary.totalBytes)}. Ready to send.`
        );
      }
    },
    [pushLog, summarizeSelection]
  );

  const copyPeerId = useCallback(async () => {
    const id = myId.trim();
    if (!id || id === "Connecting...") {
      pushLog("Peer ID is not ready yet.", true);
      return;
    }

    try {
      await navigator.clipboard.writeText(id);
      pushLog(`Copied peer ID: ${id}`);
    } catch (err) {
      pushLog(`Could not copy peer ID: ${String(err)}`, true);
    }
  }, [myId, pushLog]);

  useEffect(() => {
    const peerInitTimer = window.setTimeout(() => {
      makePeer();
    }, 0);

    return () => {
      window.clearTimeout(peerInitTimer);
      stopStream(localStreamRef.current);
      mediaConnRef.current?.close();
      activeConnRef.current?.close();
      peerRef.current?.destroy();
      stopAudioMeter();
      clearMediaStreams();
      inboxItemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.url);
      });
    };
  }, [clearMediaStreams, makePeer, stopAudioMeter, stopStream]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    inboxItemsRef.current = inboxItems;
  }, [inboxItems]);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute("webkitdirectory", "");
      folderInputRef.current.setAttribute("directory", "");
    }
  }, []);

  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream || callType !== "audio") {
      stopAudioMeter();
      return;
    }

    try {
      const AudioContextImpl =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextImpl) {
        return;
      }

      const context = new AudioContextImpl();
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.75;

      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = context;
      analyserRef.current = analyser;
      sourceNodeRef.current = source;

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(buffer);
        const total = buffer.reduce((sum, value) => sum + value, 0);
        const level = total / (buffer.length * 255);
        setAudioLevel(level);
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();
    } catch {
      // If audio context setup fails, keep visualizer at its last known state.
    }

    return () => {
      stopAudioMeter();
    };
  }, [callType, stopAudioMeter, streamVersion]);

  return (
    <div className="min-h-screen bg-[#030712] px-4 py-8 text-slate-100 sm:px-6">
      <div className="mx-auto grid w-full max-w-7xl gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <main className="rounded-2xl border border-slate-800 bg-[#030712]/85 p-5 backdrop-blur">
          <h1 className="text-2xl font-bold tracking-tight">PeerJS Live Test</h1>
          <p className="mt-2 text-sm text-slate-300">
            Connect | transfer files/folders | calls
          </p>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <section className="space-y-3 rounded-xl border border-slate-800 bg-[#030712]/50 p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Connection Settings</h2>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-[140px_minmax(0,1fr)_120px_120px]">
                <select
                  className={inputClass}
                  value={mode}
                  onChange={(e) => {
                    const nextMode = e.target.value as "cloud" | "local";
                    setMode(nextMode);
                    applyModeDefaults(nextMode);
                  }}
                >
                  <option value="cloud">Cloud</option>
                  <option value="local">Local server</option>
                </select>
                <input
                  className={inputClass}
                  placeholder="Host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="Port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="Path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  className={inputClass}
                  placeholder="Secure: true/false"
                  value={secure}
                  onChange={(e) => setSecure(e.target.value)}
                />
                <button className={buttonClass} onClick={makePeer}>
                  Reconnect Peer
                </button>
              </div>

              <p className="text-xs text-slate-400">{modeHint}</p>

              <div className="rounded-full border border-slate-700 bg-[#030712]/60 px-3 py-2 text-sm text-slate-300">
                <strong className="text-slate-100">Peer ID:</strong>
                <button
                  className="ml-2 rounded-full border border-cyan-500/40 bg-cyan-500/20 px-2 py-1 font-mono text-xs text-cyan-200 hover:bg-cyan-500/30"
                  onClick={copyPeerId}
                  title="Click to copy"
                >
                  {myId}
                </button>
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-slate-800 bg-[#030712]/50 p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Connection</h2>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  className={inputClass}
                  placeholder="Enter target peer ID"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      connectToTarget();
                    }
                  }}
                />
                <button className={buttonClass} onClick={connectToTarget}>
                  Connect
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <input
                  className={inputClass}
                  placeholder="Type message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      sendCurrentMessage();
                    }
                  }}
                />
                <input
                  className={inputClass}
                  placeholder="Name (optional)"
                  value={sender}
                  onChange={(e) => setSender(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      sendCurrentMessage();
                    }
                  }}
                />
                <button
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                  onClick={sendCurrentMessage}
                >
                  Send
                </button>
              </div>

              <button
                className="w-full rounded-xl border border-slate-700 bg-[#030712] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-[#111827]"
                onClick={() => {
                  setLogs([]);
                  pushLog("Cleared!");
                }}
              >
                Clear chat and log
              </button>

              <p className="text-sm text-slate-300">
                Connection: <strong className="text-slate-100">{connState}</strong>
              </p>
            </section>
          </div>

          <section className="mt-4 rounded-xl border border-slate-800 bg-[#030712]/50 p-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Chat and Log</h2>
            <div
              ref={logContainerRef}
              className="mt-3 max-h-72 min-h-40 space-y-1 overflow-auto rounded-lg border border-slate-700 bg-[#030712] p-3 font-mono text-xs"
            >
              {logs.map((row) => (
                <div
                  key={row.id}
                  className={row.error ? "text-rose-400" : row.text.includes("Received:") ? "text-[#00d659]" : "text-slate-200"}
                >
                  {row.text}
                </div>
              ))}
            </div>
          </section>
        </main>

        <main className="space-y-4 rounded-2xl border border-slate-800 bg-[#030712]/85 p-5 backdrop-blur">
          <h1 className="text-2xl font-bold tracking-tight">PeerJS Call</h1>

          <section className="rounded-xl border border-slate-800 bg-[#030712]/50 p-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Calls</h2>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className={buttonClass} onClick={() => startCall("audio")}>
                Audio Call
              </button>
              <button className={buttonClass} onClick={() => startCall("video")}>
                Video Call
              </button>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                className="rounded-xl border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/25"
                onClick={endCall}
                type="button"
              >
                End Call
              </button>
              <button
                className="rounded-xl border border-slate-700 bg-[#030712] px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-[#111827]"
                onClick={toggleMic}
                type="button"
              >
                {micEnabled ? "Mute Mic" : "Unmute Mic"}
              </button>
              <button
                className="rounded-xl border border-slate-700 bg-[#030712] px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-[#111827]"
                onClick={toggleCamera}
                type="button"
              >
                {cameraEnabled ? "Disable Camera" : "Enable Camera"}
              </button>
            </div>

            {callType === "audio" && (
              <div className="mt-3 rounded-lg border border-slate-700 bg-[#030712] p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Voice Activity</p>
                <div className="flex h-14 items-end gap-1">
                  {Array.from({ length: 18 }).map((_, index) => {
                    const wave = Math.min(1, audioLevel + ((index % 3) + 1) * 0.08);
                    const height = 6 + Math.round(wave * 42);

                    return (
                      <span
                        key={`wave-${index}`}
                        className="w-1.5 rounded-sm bg-cyan-400/85 transition-all duration-100"
                        style={{ height }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-700 bg-[#030712] p-2">
                <h3 className="mb-2 text-xs uppercase tracking-wide text-slate-400">Send</h3>
                <video ref={localVideoRef} autoPlay playsInline muted className="min-h-32 w-full rounded-lg bg-[#030712]" />
              </div>
              <div className="rounded-lg border border-slate-700 bg-[#030712] p-2">
                <h3 className="mb-2 text-xs uppercase tracking-wide text-slate-400">Receive</h3>
                <video ref={remoteVideoRef} autoPlay playsInline className="min-h-32 w-full rounded-lg bg-[#030712]" />
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-400">Secured Network</p>
          </section>

          <section className="rounded-xl border border-slate-800 bg-[#030712]/50 p-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">File Transfer</h2>
            <div className="mt-3 space-y-2">
              <input
                ref={fileInputRef}
                className={inputClass}
                type="file"
                multiple
                onChange={(event) => onFilesSelected(event.target.files, "file")}
              />
              <input
                ref={folderInputRef}
                className={inputClass}
                type="file"
                multiple
                onChange={(event) => onFilesSelected(event.target.files, "folder")}
              />

              <div className="rounded-lg border border-slate-700 bg-[#030712] px-3 py-2 text-xs text-slate-300">
                <p>
                  Files: {fileSelection.count} item(s), {formatBytes(fileSelection.totalBytes)}
                </p>
                <p className={fileSelection.ready ? "text-emerald-300" : "text-slate-400"}>
                  {fileSelection.ready ? "Files uploaded and ready to send." : "No files uploaded yet."}
                </p>
              </div>

              <div className="rounded-lg border border-slate-700 bg-[#030712] px-3 py-2 text-xs text-slate-300">
                <p>
                  Folder: {folderSelection.count} item(s), {formatBytes(folderSelection.totalBytes)}
                </p>
                <p className={folderSelection.ready ? "text-emerald-300" : "text-slate-400"}>
                  {folderSelection.ready ? "Folder uploaded and ready to send." : "No folder uploaded yet."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  className={buttonClass}
                  onClick={() => sendFilePayloads(fileInputRef.current?.files ?? null, "Files")}
                >
                  Send Files
                </button>
                <button
                  className={buttonClass}
                  onClick={() => sendFilePayloads(folderInputRef.current?.files ?? null, "Folder")}
                >
                  Send Folder
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  className="rounded-xl border border-slate-700 bg-[#030712] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-[#111827]"
                  onClick={() => clearSelectedUpload("file")}
                  type="button"
                >
                  Remove Files Upload
                </button>
                <button
                  className="rounded-xl border border-slate-700 bg-[#030712] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-[#111827]"
                  onClick={() => clearSelectedUpload("folder")}
                  type="button"
                >
                  Remove Folder Upload
                </button>
              </div>

              <p className="text-xs text-slate-400">
                Pick files or a folder, then send them over the active data connection.
              </p>

              <div className="mt-2 rounded-lg border border-slate-700 bg-[#030712] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">Received Inbox</h3>
                  <button
                    className="rounded-lg border border-slate-600 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-[#111827]"
                    onClick={clearInbox}
                    type="button"
                  >
                    Clear Inbox
                  </button>
                </div>

                {inboxItems.length === 0 ? (
                  <p className="text-xs text-slate-400">No received files/folders yet.</p>
                ) : (
                  <div className="space-y-2">
                    {inboxItems.map((item) => (
                      <div key={item.id} className="rounded-lg border border-slate-700 bg-[#030712]/70 p-2 text-xs">
                        <p className="font-medium text-slate-200">{item.name}</p>
                        <p className="text-slate-400">
                          {item.source} | {formatBytes(item.size)}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <a
                            className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2 py-1 font-semibold text-cyan-200 transition hover:bg-cyan-500/25"
                            href={item.url}
                            download={item.name}
                          >
                            Download
                          </a>
                          <button
                            className="rounded-lg border border-slate-600 px-2 py-1 font-semibold text-slate-200 transition hover:bg-[#111827]"
                            onClick={() => removeInboxItem(item.id)}
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}