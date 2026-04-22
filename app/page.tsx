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

const inputClass =
  "w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400";
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

  const peerRef = useRef<Peer | null>(null);
  const activeConnRef = useRef<DataConnection | null>(null);
  const mediaConnRef = useRef<MediaConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

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
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    },
    [stopStream]
  );

  const setRemoteStream = useCallback((stream: MediaStream) => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
    }
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

  const wireConnection = useCallback(
    (conn: DataConnection) => {
      activeConnRef.current = conn;
      setConnState(`Connected to ${conn.peer}`);
      pushLog(`Connection opened with ${conn.peer}`);

      conn.on("data", (data) => {
        const text = typeof data === "string" ? data : JSON.stringify(data);
        pushLog(`Received: ${text}`);
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
    [pushLog]
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
          pushLog(`Call stream received from ${call.peer}`);
        });
        call.on("close", () => pushLog("Incoming call closed."));
        call.on("error", (err) => pushLog(`Incoming call error: ${err.message || err}`, true));
        mediaConnRef.current = call;
      } catch (err) {
        pushLog(`Could not answer call: ${String(err)}`, true);
      }
    });

    peer.on("error", (err) => {
      pushLog(`Peer error: ${err.type || ""} ${err.message || err}`.trim(), true);
    });
  }, [host, path, port, pushLog, secure, setLocalStream, setRemoteStream, wireConnection]);

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

        call.on("stream", (remoteStream) => {
          setRemoteStream(remoteStream);
          pushLog(`${kind === "video" ? "Video" : "Audio"} call connected.`);
        });
        call.on("close", () => pushLog("Call closed."));
        call.on("error", (err) => pushLog(`Call error: ${err.message || err}`, true));
        pushLog(`Starting ${kind} call to ${activeConnRef.current.peer}`);
      } catch (err) {
        pushLog(`Could not start ${kind} call: ${String(err)}`, true);
      }
    },
    [pushLog, requireConnection, setLocalStream, setRemoteStream]
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
    makePeer();
    return () => {
      stopStream(localStreamRef.current);
      mediaConnRef.current?.close();
      activeConnRef.current?.close();
      peerRef.current?.destroy();
    };
  }, [makePeer, stopStream]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute("webkitdirectory", "");
      folderInputRef.current.setAttribute("directory", "");
    }
  }, []);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#1e3a8a_0%,_#0f172a_45%)] px-4 py-8 text-slate-100 sm:px-6">
      <div className="mx-auto grid w-full max-w-7xl gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <main className="rounded-2xl border border-slate-800 bg-slate-900/85 p-5 shadow-2xl shadow-black/40 backdrop-blur">
          <h1 className="text-2xl font-bold tracking-tight">PeerJS Live Test</h1>
          <p className="mt-2 text-sm text-slate-300">
            Connect, transfer files or folders, and place audio or video calls from one place.
          </p>

          <section className="mt-4 space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[140px_minmax(0,1fr)_120px_120px]">
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

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
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

            <div className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
              <strong className="text-slate-100">Your Peer ID:</strong>
              <button
                className="ml-2 rounded-full border border-cyan-500/40 bg-cyan-500/20 px-2 py-1 font-mono text-xs text-cyan-200 hover:bg-cyan-500/30"
                onClick={copyPeerId}
                title="Click to copy"
              >
                {myId}
              </button>
            </div>
          </section>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
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
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
                onClick={() => {
                  setLogs([]);
                  pushLog("Cleared!");
                }}
              >
                Clear
              </button>

              <p className="text-sm text-slate-300">
                Connection: <strong className="text-slate-100">{connState}</strong>
              </p>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Chat and Log</h2>
              <div
                ref={logContainerRef}
                className="mt-3 max-h-72 min-h-40 space-y-1 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs"
              >
                {logs.map((row) => (
                  <div key={row.id} className={row.error ? "text-rose-400" : "text-slate-200"}>
                    {row.text}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>

        <main className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/85 p-5 shadow-2xl shadow-black/40 backdrop-blur">
          <h1 className="text-2xl font-bold tracking-tight">PeerJS Call</h1>

          <section className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Calls</h2>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className={buttonClass} onClick={() => startCall("audio")}>
                Audio Call
              </button>
              <button className={buttonClass} onClick={() => startCall("video")}>
                Video Call
              </button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-700 bg-slate-950 p-2">
                <h3 className="mb-2 text-xs uppercase tracking-wide text-slate-400">Send</h3>
                <video ref={localVideoRef} autoPlay playsInline muted className="min-h-32 w-full rounded-lg bg-slate-950" />
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950 p-2">
                <h3 className="mb-2 text-xs uppercase tracking-wide text-slate-400">Receive</h3>
                <video ref={remoteVideoRef} autoPlay playsInline className="min-h-32 w-full rounded-lg bg-slate-950" />
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-400">Secured Network</p>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">File Transfer</h2>
            <div className="mt-3 space-y-2">
              <input ref={fileInputRef} className={inputClass} type="file" multiple />
              <input ref={folderInputRef} className={inputClass} type="file" multiple />

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

              <p className="text-xs text-slate-400">
                Pick files or a folder, then send them over the active data connection.
              </p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
