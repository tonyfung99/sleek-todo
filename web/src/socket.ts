import { io, Socket } from 'socket.io-client';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function createSocket(token: string): Socket {
  return io(BASE, { auth: { token }, transports: ['websocket'], autoConnect: true });
}
