import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { registerAuthRoutes, requireAuth } from './auth.js';
import { httpRateLimiter } from './rate-limiter.js';
import { registerSocketHandlers, getCheckboxStates, getCheckedCount } from './socket-handler.js';

const CHECKBOX_SIZE = 1_000_000;

async function main() {
    const PORT = process.env.PORT ?? 3000;
    const app = express();
    const server = http.createServer(app);
    const io = new Server();
    io.attach(server);

    app.use(express.json());

    // ---- Auth Routes ----
    registerAuthRoutes(app);

    // ---- Public Routes ----
    app.get('/login.html', (req, res) => {
        res.sendFile(path.resolve('./public/login.html'));
    });

    app.get('/health', (req, res) => res.json({ healthy: true }));

    // ---- Protected Routes ----

    // Serve main app (protected)
    app.get('/', requireAuth, (req, res) => {
        res.sendFile(path.resolve('./public/index.html'));
    });

    // Get checkbox states with pagination (protected + rate limited)
    app.get('/checkboxes', requireAuth, httpRateLimiter({ maxRequests: 30, windowSec: 60 }), async (req, res) => {
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        const count = Math.min(10000, Math.max(1, parseInt(req.query.count) || 1000));

        const checkboxes = await getCheckboxStates(offset, count);
        const checkedCount = await getCheckedCount();

        return res.json({
            checkboxes,
            total: CHECKBOX_SIZE,
            offset,
            count,
            checkedCount,
        });
    });

    // Serve static files (after routes so protected routes take priority)
    app.use(express.static(path.resolve('./public')));

    // ---- WebSocket Handlers ----
    await registerSocketHandlers(io);

    server.listen(PORT, () => {
        console.log(`Million Checkboxes running on http://localhost:${PORT}`);
    });
}

main();

