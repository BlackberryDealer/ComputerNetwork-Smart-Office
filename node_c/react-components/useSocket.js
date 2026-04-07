import { useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

// Singleton socket instance — shared across all components
let socketInstance = null;
let refCount = 0;

/**
 * Custom hook that provides a shared Socket.IO connection.
 * Automatically manages the singleton lifecycle: creates on first mount,
 * disconnects when the last component unmounts.
 */
export function useSocket() {
  const socketRef = useRef(null);

  if (!socketRef.current) {
    if (!socketInstance) {
      socketInstance = io({
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 10
      });
    }
    socketRef.current = socketInstance;
    refCount++;
  }

  useEffect(() => {
    return () => {
      refCount--;
      if (refCount <= 0 && socketInstance) {
        socketInstance.disconnect();
        socketInstance = null;
        refCount = 0;
      }
    };
  }, []);

  return socketRef.current;
}

/**
 * Fetch with AbortController timeout.
 * @param {string} url
 * @param {object} options - fetch options
 * @param {number} timeoutMs - timeout in milliseconds (default 5000)
 */
export function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}
