import { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { verifyToken } from './auth';
export function attachWebSockets(server: Server, db: Pool, secret: string) {
    const sockets = new Map<number, Set<WebSocket>>();
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16384 });
    wss.on('connection', ws => {
        let userId: number | undefined;
        let authenticating = false;
        const timeout = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
        ws.on('error', () => { });
        ws.on('message', async raw => {
            if (userId !== undefined || authenticating) return;
            authenticating = true;
            try {
                const message = JSON.parse(raw.toString());
                if (message.type !== 'auth' || typeof message.token !== 'string') throw new Error('Invalid auth message');
                const identity = verifyToken(message.token, secret);
                const user = (await db.query('SELECT id FROM users WHERE id=$1', [identity.id])).rows[0];
                if (!user || ws.readyState !== WebSocket.OPEN) throw new Error('Unknown user');
                userId = user.id; clearTimeout(timeout);
                const set = sockets.get(user.id) || new Set<WebSocket>(); set.add(ws); sockets.set(user.id, set);
                ws.send(JSON.stringify({ type: 'authenticated', userId: user.id }));
                const payload = jwt.decode(message.token) as jwt.JwtPayload;
                const expiry = setTimeout(() => ws.close(1008, 'Token expired'), Math.max(0, payload.exp! * 1000 - Date.now()));
                ws.once('close', () => clearTimeout(expiry));
            } catch { ws.close(1008, 'Invalid authentication'); }
        });
        ws.on('close', () => { clearTimeout(timeout); if (userId !== undefined) { const set = sockets.get(userId); set?.delete(ws); if (!set?.size) sockets.delete(userId); } });
    });
    return {
        publish(userId: number, notification: unknown) {
            for (const ws of sockets.get(userId) || []) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'notification', data: notification }));
        },
        close() { for (const set of sockets.values()) for (const ws of set) ws.close(1001, 'Server shutting down'); wss.close(); }
    };
}
