import { useEffect, useRef, useState } from 'react';
import { deployLogsWsUrl } from './api.js';

/** Stream a deployment's logs over WebSocket (backlog + live lines). */
export function useDeployLogs(serviceId: number | null, deploymentId: number | null) {
  const [lines, setLines] = useState('');
  const [open, setOpen] = useState(false);
  const activeId = useRef<number | null>(null);

  useEffect(() => {
    if (serviceId == null || deploymentId == null) return;
    activeId.current = deploymentId;
    setLines('');

    const ws = new WebSocket(deployLogsWsUrl(serviceId, deploymentId));
    ws.onopen = () => setOpen(true);
    ws.onmessage = (event) => {
      if (activeId.current !== deploymentId) return;
      setLines((prev) => prev + String(event.data));
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
