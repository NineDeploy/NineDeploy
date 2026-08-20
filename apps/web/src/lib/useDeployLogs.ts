import { useEffect, useRef, useState } from 'react';
import { deployLogsWsUrl, websocketAuthProtocols } from './api.js';

/** Stream a deployment's logs over WebSocket (backlog + live lines). */
export function useDeployLogs(serviceId: number | null, deploymentId: number | null) {
  const [lines, setLines] = useState('');
  const [open, setOpen] = useState(false);
  const activeId = useRef<number | null>(null);
  // Chunks accumulate here and are joined into `lines` after each message.
  // Growing a string by concatenation in a loop is O(n²) on long deploys;
  // an array append is amortized O(1) per chunk.
  const chunksRef = useRef<string[]>([]);

  useEffect(() => {
    if (serviceId == null || deploymentId == null) return;
    activeId.current = deploymentId;
    chunksRef.current = [];
    setLines('');

    const ws = new WebSocket(deployLogsWsUrl(serviceId, deploymentId), websocketAuthProtocols());
    ws.onopen = () => setOpen(true);
    ws.onmessage = (event) => {
      if (activeId.current !== deploymentId) return;
      chunksRef.current.push(String(event.data));
      setLines(chunksRef.current.join(''));
    };
    ws.onerror = () => setOpen(false);
    ws.onclose = () => setOpen(false);

    return () => {
      activeId.current = null;
      ws.close();
    };
  }, [serviceId, deploymentId]);

  return { lines, open };
}
