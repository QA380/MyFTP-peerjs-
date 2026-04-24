"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";
import Peer, { DataConnection, MediaConnection } from "peerjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type LogRow = {
  id: number;
  text: string;
  error: boolean;
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
  progress: number;
  rate: number;
  complete: boolean;
};

type FileTransferStart = {
  kind: "file-start";
  transferId: string;
  source: "Files" | "Folder";
  name: string;
  mime: string;
  size: number;
  totalChunks: number;
};

type FileTransferChunk = {
  kind: "file-chunk";
  transferId: string;
  index: number;
  data: ArrayBuffer;
};

type FileTransferEnd = {
  kind: "file-end";
  transferId: string;
};

type ActiveInboxTransfer = {
  id: string;
  source: "Files" | "Folder";
  name: string;
  mime: string;
  size: number;
  receivedBytes: number;
  chunks: ArrayBuffer[];
  startedAt: number;
  lastTick: number;
  totalChunks: number;
};

type ActiveOutgoingTransfer = {
  id: string;
  source: "Files" | "Folder";
  name: string;
  size: number;
  sentBytes: number;
  startedAt: number;
  lastTick: number;
  totalChunks: number;
};

type OutgoingItem = {
  id: string;
  source: "Files" | "Folder";
  name: string;
  size: number;
  progress: number;
  rate: number;
  complete: boolean;
};

type ConnectionDiagnostics = {
  dataChannelState: string;
  bufferedAmount: number;
  rttMs: number | null;
  route: "direct" | "relay" | "unknown";
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
const FILE_CHUNK_SIZE = 64 * 1024;
const BUFFER_HIGH_WATERMARK = FILE_CHUNK_SIZE * 32;
const BUFFER_CHECK_INTERVAL_MS = 10;

const formatLatency = (rttMs: number | null): string => {
  if (rttMs === null || Number.isNaN(rttMs)) {
    return "n/a";
  }
  return `${Math.round(rttMs)} ms`;
};

type WorkerInboundMessage = {
  type: "prepare-file";
  transferId: string;
  source: "Files" | "Folder";
  file: File;
  chunkSize: number;
};

type WorkerOutboundMessage =
  | {
      type: "prepared-start";
      transferId: string;
      source: "Files" | "Folder";
      name: string;
      mime: string;
      size: number;
      totalChunks: number;
    }
  | {
      type: "prepared-chunk";
      transferId: string;
      index: number;
      data: ArrayBuffer;
    }
  | {
      type: "prepared-end";
      transferId: string;
    }
  | {
      type: "prepared-error";
      transferId: string;
      message: string;
    };

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
  const [sendingItems, setSendingItems] = useState<OutgoingItem[]>([]);
  const [diagnostics, setDiagnostics] = useState<ConnectionDiagnostics>({
    dataChannelState: "closed",
    bufferedAmount: 0,
    rttMs: null,
    route: "unknown",
  });

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
  const activeInboxTransfersRef = useRef<Map<string, ActiveInboxTransfer>>(new Map());
  const sendingTransfersRef = useRef<Map<string, ActiveOutgoingTransfer>>(new Map());
  const sendingItemsRef = useRef<OutgoingItem[]>([]);
  const transferWorkerRef = useRef<Worker | null>(null);
  const workerQueueRef = useRef<WorkerOutboundMessage[]>([]);
  const workerQueueRunningRef = useRef(false);
  const transferPromisesRef = useRef<
    Map<string, { resolve: () => void; reject: (error: Error) => void }>
  >(new Map());

  const modeHint = useMemo(
    () => "For localhost, use port 9000, path /myapp, secure false.",
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

  const getRtcDataChannel = useCallback((conn: DataConnection | null): RTCDataChannel | null => {
    if (!conn) {
      return null;
    }

    const candidate = conn as DataConnection & {
      dataChannel?: RTCDataChannel;
      _dc?: RTCDataChannel;
    };

    return candidate.dataChannel ?? candidate._dc ?? null;
  }, []);

  const getRtcPeerConnection = useCallback((conn: DataConnection | null): RTCPeerConnection | null => {
    if (!conn) {
      return null;
    }

    const candidate = conn as DataConnection & {
      peerConnection?: RTCPeerConnection;
      _pc?: RTCPeerConnection;
    };

    return candidate.peerConnection ?? candidate._pc ?? null;
  }, []);

  const waitForBufferedDrain = useCallback(
    async (conn: DataConnection | null) => {
      const channel = getRtcDataChannel(conn);
      if (!channel) {
        return;
      }

      while (channel.readyState === "open" && channel.bufferedAmount > BUFFER_HIGH_WATERMARK) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, BUFFER_CHECK_INTERVAL_MS));
      }
    },
    [getRtcDataChannel]
  );

  const isLikelyCompressed = useCallback((name: string, mime: string) => {
    const lower = name.toLowerCase();
    if (
      lower.endsWith(".zip") ||
      lower.endsWith(".rar") ||
      lower.endsWith(".7z") ||
      lower.endsWith(".gz") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png") ||
      lower.endsWith(".mp3") ||
      lower.endsWith(".mp4")
    ) {
      return true;
    }

    return mime.includes("zip") || mime.includes("audio/") || mime.includes("video/") || mime.startsWith("image/");
  }, []);

  const flushInboxTransfer = useCallback((transferId: string) => {
    const transfer = activeInboxTransfersRef.current.get(transferId);
    if (!transfer) {
      return;
    }

    const blob = new Blob(transfer.chunks, { type: transfer.mime });
    const url = URL.createObjectURL(blob);
    const elapsedSeconds = Math.max((Date.now() - transfer.startedAt) / 1000, 0.001);
    const rate = transfer.receivedBytes / elapsedSeconds;

    setInboxItems((prev) => [
      {
        id: transfer.id,
        source: transfer.source,
        name: transfer.name,
        size: transfer.size,
        mime: transfer.mime,
        url,
        progress: 1,
        rate,
        complete: true,
      },
      ...prev,
    ]);

    activeInboxTransfersRef.current.delete(transferId);
    pushLog(`Received file ready in inbox: ${transfer.name} (${formatBytes(transfer.size)}).`);
  }, [pushLog]);

  const updateInboxTransferProgress = useCallback((transferId: string) => {
    const transfer = activeInboxTransfersRef.current.get(transferId);
    if (!transfer) {
      return;
    }

    const elapsedSeconds = Math.max((Date.now() - transfer.startedAt) / 1000, 0.001);
    const rate = transfer.receivedBytes / elapsedSeconds;
    const progress = transfer.size > 0 ? Math.min(transfer.receivedBytes / transfer.size, 1) : 0;

    setInboxItems((prev) => prev.map((item) => (
      item.id === transferId
        ? { ...item, progress, rate, complete: false, size: transfer.size, mime: transfer.mime, name: transfer.name, source: transfer.source }
        : item
    )));
  }, []);

  const beginOutgoingTransfer = useCallback(
    (transferId: string, source: "Files" | "Folder", name: string, size: number, totalChunks: number) => {
      sendingTransfersRef.current.set(transferId, {
        id: transferId,
        source,
        name,
        size,
        sentBytes: 0,
        startedAt: Date.now(),
        lastTick: Date.now(),
        totalChunks,
      });

      setSendingItems((prev) => [
        {
          id: transferId,
          source,
          name,
          size,
          progress: 0,
          rate: 0,
          complete: false,
        },
        ...prev,
      ]);
    },
    []
  );

  const updateOutgoingTransferProgress = useCallback(
    (transferId: string, chunkSize: number) => {
      const transfer = sendingTransfersRef.current.get(transferId);
      if (!transfer) return;

      transfer.sentBytes += chunkSize;
      const elapsedMs = Math.max(Date.now() - transfer.startedAt, 1);
      const bytesPerSecond = (transfer.sentBytes / elapsedMs) * 1000;
      const progress = transfer.sentBytes / transfer.size;
      const complete = transfer.sentBytes >= transfer.size;

      setSendingItems((prev) =>
        prev.map((item) =>
          item.id === transferId
            ? { ...item, progress, rate: bytesPerSecond, complete }
            : item
        )
      );

      if (complete) {
        sendingTransfersRef.current.delete(transferId);
      }
    },
    []
  );

  const flushOutgoingTransfer = useCallback((transferId: string) => {
    sendingTransfersRef.current.delete(transferId);
    setSendingItems((prev) =>
      prev.map((item) =>
        item.id === transferId ? { ...item, complete: true } : item
      )
    );
  }, []);

  const processWorkerMessage = useCallback(
    async (payload: WorkerOutboundMessage) => {
      if (payload.type === "prepared-error") {
        transferPromisesRef.current.get(payload.transferId)?.reject(new Error(payload.message));
        transferPromisesRef.current.delete(payload.transferId);
        sendingTransfersRef.current.delete(payload.transferId);
        setSendingItems((prev) => prev.map((item) => (
          item.id === payload.transferId ? { ...item, complete: true } : item
        )));
        pushLog(`Worker error for transfer ${payload.transferId}: ${payload.message}`, true);
        return;
      }

      const conn = activeConnRef.current;
      if (!conn || !conn.open) {
        transferPromisesRef.current.get(payload.transferId)?.reject(new Error("Connection closed during transfer"));
        transferPromisesRef.current.delete(payload.transferId);
        return;
      }

      if (payload.type === "prepared-start") {
        conn.send({
          kind: "file-start",
          transferId: payload.transferId,
          source: payload.source,
          name: payload.name,
          mime: payload.mime,
          size: payload.size,
          totalChunks: payload.totalChunks,
        } satisfies FileTransferStart);
        return;
      }

      if (payload.type === "prepared-chunk") {
        await waitForBufferedDrain(conn);
        conn.send({
          kind: "file-chunk",
          transferId: payload.transferId,
          index: payload.index,
          data: payload.data,
        } satisfies FileTransferChunk);
        updateOutgoingTransferProgress(payload.transferId, payload.data.byteLength);
        return;
      }

      if (payload.type === "prepared-end") {
        await waitForBufferedDrain(conn);
        conn.send({
          kind: "file-end",
          transferId: payload.transferId,
        } satisfies FileTransferEnd);

        flushOutgoingTransfer(payload.transferId);
        transferPromisesRef.current.get(payload.transferId)?.resolve();
        transferPromisesRef.current.delete(payload.transferId);
      }
    },
    [flushOutgoingTransfer, pushLog, updateOutgoingTransferProgress, waitForBufferedDrain]
  );

  const drainWorkerQueue = useCallback(async () => {
    if (workerQueueRunningRef.current) {
      return;
    }

    workerQueueRunningRef.current = true;
    try {
      while (workerQueueRef.current.length > 0) {
        const payload = workerQueueRef.current.shift();
        if (!payload) {
          continue;
        }
        await processWorkerMessage(payload);
      }
    } finally {
      workerQueueRunningRef.current = false;
    }
  }, [processWorkerMessage]);

  const beginInboxTransfer = useCallback((payload: FileTransferStart) => {
    const exists = activeInboxTransfersRef.current.get(payload.transferId);
    if (!exists) {
      activeInboxTransfersRef.current.set(payload.transferId, {
        id: payload.transferId,
        source: payload.source,
        name: payload.name,
        mime: payload.mime,
        size: payload.size,
        receivedBytes: 0,
        chunks: [],
        startedAt: Date.now(),
        lastTick: Date.now(),
        totalChunks: payload.totalChunks,
      });

      setInboxItems((prev) => [
        {
          id: payload.transferId,
          source: payload.source,
          name: payload.name,
          size: payload.size,
          mime: payload.mime,
          url: "",
          progress: 0,
          rate: 0,
          complete: false,
        },
        ...prev,
      ]);
    }
  }, []);

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
    activeInboxTransfersRef.current.clear();
    inboxItemsRef.current.forEach((item) => {
      if (item.url) {
        URL.revokeObjectURL(item.url);
      }
    });
    setInboxItems([]);
    pushLog("Cleared received inbox.");
  }, [pushLog]);

  const removeInboxItem = useCallback((id: string) => {
    setInboxItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target && target.url) {
        URL.revokeObjectURL(target.url);
      }
      activeInboxTransfersRef.current.delete(id);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const wireConnection = useCallback(
    (conn: DataConnection) => {
      activeConnRef.current = conn;
      setConnState(`Connected to ${conn.peer}`);
      pushLog(`Connection opened with ${conn.peer}`);
      if (conn.serialization !== "raw") {
        pushLog(
          `Connection serialization is ${conn.serialization}; for large file throughput prefer raw/none serialization.`,
          true
        );
      }

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
            transferId?: string;
            totalChunks?: number;
            index?: number;
            data?: unknown;
          };

          if (payload.kind === "transfer-start") {
            const source = payload.label === "Folder" ? "Folder" : "Files";
            incomingTransferLabelRef.current = source;
            pushLog(`Incoming ${source.toLowerCase()} transfer: ${payload.count ?? 0} item(s).`);
            return;
          }

          if (payload.kind === "file-start" && payload.transferId && payload.name && payload.mime) {
            beginInboxTransfer({
              kind: "file-start",
              transferId: payload.transferId,
              source: payload.label === "Folder" ? "Folder" : "Files",
              name: payload.name,
              mime: payload.mime,
              size: payload.size ?? 0,
              totalChunks: payload.totalChunks ?? 0,
            });
            return;
          }

          if (payload.kind === "file-chunk" && payload.transferId) {
            const transfer = activeInboxTransfersRef.current.get(payload.transferId);
            const buffer = extractArrayBuffer(payload.data);
            if (!transfer || !buffer) {
              pushLog(`Received file chunk that could not be attached to a transfer.`, true);
              return;
            }

            transfer.chunks.push(buffer);
            transfer.receivedBytes += buffer.byteLength;
            transfer.lastTick = Date.now();

            updateInboxTransferProgress(payload.transferId);
            return;
          }

          if (payload.kind === "file-end" && payload.transferId) {
            const transfer = activeInboxTransfersRef.current.get(payload.transferId);
            if (!transfer) {
              pushLog(`Received file end without a matching transfer.`, true);
              return;
            }

            flushInboxTransfer(payload.transferId);
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
    [beginInboxTransfer, extractArrayBuffer, flushInboxTransfer, pushLog, updateInboxTransferProgress]
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
      config: {
        iceServers: [
          {
            urls: [
              "stun:stun.l.google.com:19302",
              "stun:stun1.l.google.com:19302",
              "stun:stun.cloudflare.com:3478",
            ],
          },
          ...(process.env.NEXT_PUBLIC_TURN_URL
            ? [
                {
                  urls: process.env.NEXT_PUBLIC_TURN_URL,
                  username: process.env.NEXT_PUBLIC_TURN_USERNAME,
                  credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
                },
              ]
            : []),
        ],
        iceTransportPolicy: "all" as RTCIceTransportPolicy,
      },
    };

    pushLog(
      `Connecting with ${JSON.stringify({
        host: options.host,
        port: options.port,
        path: options.path,
        secure: options.secure,
        hasTurnServer: Boolean(process.env.NEXT_PUBLIC_TURN_URL),
      })}`
    );
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

    const conn = peerRef.current.connect(trimmed, {
      reliable: true,
      serialization: "raw",
      metadata: {
        transferProfile: "raw-binary-v1",
      },
    });
    conn.on("open", () => wireConnection(conn));
  }, [pushLog, targetId, wireConnection]);

  const disconnectFromTarget = useCallback(() => {
    if (!activeConnRef.current) {
      pushLog("No active connection to disconnect.", true);
      return;
    }

    try {
      activeConnRef.current.close();
    } catch (err) {
      pushLog(`Disconnect warning: ${String(err)}`, true);
    }

    activeConnRef.current = null;
    setConnState("Not connected");
    pushLog("Disconnected from peer.");
  }, [pushLog]);

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

      const worker = transferWorkerRef.current;
      if (!worker) {
        pushLog("Transfer worker is not ready yet. Please retry in a second.", true);
        return;
      }

      activeConnRef.current?.send({
        kind: "transfer-start",
        label,
        count: files.length,
      });

      for (const file of Array.from(files)) {
        const transferId = `${Date.now()}-${Math.random()}`;
        const mime = file.type || "application/octet-stream";
        const fileName = file.webkitRelativePath || file.name;

        if (isLikelyCompressed(fileName, mime)) {
          pushLog(`Skipping app-level compression for ${fileName}; file is already compressed or media.`);
        }

        beginOutgoingTransfer(transferId, label, fileName, file.size, Math.ceil(file.size / FILE_CHUNK_SIZE));

        const completion = new Promise<void>((resolve, reject) => {
          transferPromisesRef.current.set(transferId, { resolve, reject });
        });

        worker.postMessage({
          type: "prepare-file",
          transferId,
          source: label,
          file,
          chunkSize: FILE_CHUNK_SIZE,
        } satisfies WorkerInboundMessage);

        await completion;
        pushLog(`Sent ${label.toLowerCase()}: ${fileName} (${formatBytes(file.size)})`);
      }

      pushLog(`${label} upload complete. ${files.length} item(s) sent successfully.`);
    },
    [
      beginOutgoingTransfer,
      isLikelyCompressed,
      pushLog,
      requireConnection,
    ]
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
    const worker = new Worker("/workers/transfer-worker.js");
    transferWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      workerQueueRef.current.push(event.data);
      void drainWorkerQueue();
    };

    worker.onerror = (event) => {
      pushLog(`Transfer worker failed: ${event.message}`, true);
    };

    return () => {
      transferWorkerRef.current?.terminate();
      transferWorkerRef.current = null;
      workerQueueRef.current = [];
      transferPromisesRef.current.clear();
    };
  }, [drainWorkerQueue, pushLog]);

  useEffect(() => {
    let timer: number | null = null;

    const updateDiagnostics = async () => {
      const conn = activeConnRef.current;
      const channel = getRtcDataChannel(conn);
      const peerConnection = getRtcPeerConnection(conn);

      if (!conn || !channel || !conn.open) {
        setDiagnostics({
          dataChannelState: channel?.readyState ?? "closed",
          bufferedAmount: 0,
          rttMs: null,
          route: "unknown",
        });
        return;
      }

      let rttMs: number | null = null;
      let route: "direct" | "relay" | "unknown" = "unknown";

      if (peerConnection) {
        try {
          const stats = await peerConnection.getStats();
          const reports = Array.from(stats.values());
          const candidatePair = reports.find((report) => {
            return (
              report.type === "candidate-pair" &&
              (report as RTCStats & { state?: string; selected?: boolean }).state === "succeeded" &&
              (report as RTCStats & { nominated?: boolean; selected?: boolean }).nominated
            );
          }) as (RTCStats & {
            currentRoundTripTime?: number;
            selected?: boolean;
            localCandidateId?: string;
            remoteCandidateId?: string;
          }) | undefined;

          const selectedPair =
            candidatePair ??
            (reports.find((report) => {
              return (
                report.type === "candidate-pair" &&
                (report as RTCStats & { selected?: boolean }).selected
              );
            }) as (RTCStats & {
              currentRoundTripTime?: number;
              localCandidateId?: string;
              remoteCandidateId?: string;
            }) | undefined);

          if (selectedPair?.currentRoundTripTime !== undefined) {
            rttMs = selectedPair.currentRoundTripTime * 1000;
          }

          if (selectedPair?.localCandidateId || selectedPair?.remoteCandidateId) {
            const localCandidate = reports.find((report) => report.id === selectedPair.localCandidateId) as
              | (RTCStats & { candidateType?: string })
              | undefined;
            const remoteCandidate = reports.find((report) => report.id === selectedPair.remoteCandidateId) as
              | (RTCStats & { candidateType?: string })
              | undefined;

            if (localCandidate?.candidateType === "relay" || remoteCandidate?.candidateType === "relay") {
              route = "relay";
            } else if (localCandidate?.candidateType || remoteCandidate?.candidateType) {
              route = "direct";
            }
          }
        } catch {
          // Stats can fail in some browsers; keep previous-friendly fallback values.
        }
      }

      setDiagnostics({
        dataChannelState: channel.readyState,
        bufferedAmount: channel.bufferedAmount,
        rttMs,
        route,
      });
    };

    void updateDiagnostics();
    timer = window.setInterval(() => {
      void updateDiagnostics();
    }, 1000);

    return () => {
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [connState, getRtcDataChannel, getRtcPeerConnection]);

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
        if (item.url) {
          URL.revokeObjectURL(item.url);
        }
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
    sendingItemsRef.current = sendingItems;
  }, [sendingItems]);

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
      <SpeedInsights />
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

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-[140px_minmax(0,1fr)_120px_120px]">
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
              <p className="text-xs text-slate-500">
                Direct P2P is preferred via STUN. Set NEXT_PUBLIC_TURN_URL, NEXT_PUBLIC_TURN_USERNAME, and NEXT_PUBLIC_TURN_CREDENTIAL only when relay is required.
              </p>

              <div className="rounded-full border border-slate-700 bg-[#030712]/60 px-3 py-2 text-xs text-slate-300">
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
                      if (connState === "Not connected") {
                        connectToTarget();
                      } else {
                        disconnectFromTarget();
                      }
                    }
                  }}
                />
                <button
                  className={
                    connState === "Not connected"
                      ? buttonClass
                      : "rounded-xl border border-rose-500/50 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/25"
                  }
                  onClick={() => {
                    if (connState === "Not connected") {
                      connectToTarget();
                    } else {
                      disconnectFromTarget();
                    }
                  }}
                >
                  {connState === "Not connected" ? "Connect" : "Disconnect"}
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

              <div className="rounded-lg border border-slate-700 bg-[#030712] px-3 py-2 text-xs text-slate-300">
                <p className="font-semibold uppercase tracking-wide text-slate-300">Connection Diagnostics</p>
                <p>Data channel: {diagnostics.dataChannelState}</p>
                <p>Buffered outbound: {formatBytes(diagnostics.bufferedAmount)}</p>
                <p>Estimated RTT: {formatLatency(diagnostics.rttMs)}</p>
                <p>
                  Route: {diagnostics.route === "unknown" ? "Unknown" : diagnostics.route === "relay" ? "Relay" : "Direct"}
                </p>
              </div>
            </section>
          </div>

          <section className="mt-4 rounded-xl border border-slate-800 bg-[#030712]/50 p-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Chat and Log</h2>
            <div
              ref={logContainerRef}
              className="mt-3 max-h-72 min-h-40 space-y-1 overflow-auto rounded-lg border border-slate-700 bg-[#030712] p-3 font-mono text-xs"
            >
              {logs.map((row) => {
                let textClass = "text-slate-200";

                // Error logs = red
                if (row.error) {
                  textClass = "text-rose-400";
                }
                // Received messages = blue
                else if (row.text.includes("Received:")) {
                  textClass = "text-[#0069d1]";
                }
                // Sent messages = dark cyan
                else if(row.text.includes("Sent:")){
                  textClass = "text-[#0096ad]"
                }
                else if(row.text.includes("Incoming") || row.text.includes("Received")){
                  textClass = "text-[#00ad4e]"
                }
                // All remaining chat/log rows keep the default text color. (it's white)

                return (
                  <div key={row.id} className={textClass}>
                    {row.text}
                  </div>
                );
              })}
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
              <p className="text-xs text-slate-500">
                Performance tip: keep this tab in the foreground and disable battery-saver modes for best sustained transfer speed.
              </p>

              <div className="mt-2 rounded-lg border border-slate-700 bg-[#030712] p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">Sending Transfers</h3>

                {sendingItems.length === 0 ? (
                  <p className="text-xs text-slate-400">No active transfers.</p>
                ) : (
                  <div className="space-y-2">
                    {sendingItems.map((item) => (
                      <div key={item.id} className="rounded-lg border border-slate-700 bg-[#030712]/70 p-2 text-xs">
                        <p className="font-medium text-slate-200">{item.name}</p>
                        <p className="text-slate-400">
                          {item.source} | {formatBytes(item.size)}
                        </p>
                        <p className="text-slate-400">
                          Transfer rate: {formatBytes(Math.max(item.rate, 0))}/s
                        </p>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-green-500 transition-all duration-150"
                            style={{ width: `${Math.min(Math.max(item.progress * 100, 0), 100)}%` }}
                          />
                        </div>
                        <p className={item.complete ? "mt-2 text-emerald-300" : "mt-2 text-slate-400"}>
                          {item.complete ? "Transfer complete." : `Sending... ${Math.round(item.progress * 100)}%`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

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
                        <p className="text-slate-400">
                          Transfer rate: {formatBytes(Math.max(item.rate, 0))}/s
                        </p>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-cyan-400 transition-all duration-150"
                            style={{ width: `${Math.min(Math.max(item.progress * 100, 0), 100)}%` }}
                          />
                        </div>
                        <p className={item.complete ? "mt-2 text-emerald-300" : "mt-2 text-slate-400"}>
                          {item.complete ? "Transfer complete and ready." : `Receiving... ${Math.round(item.progress * 100)}%`}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <a
                            aria-disabled={!item.complete}
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