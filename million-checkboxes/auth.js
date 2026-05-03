import cookieParser from 'cookie-parser';

const AUTH_SERVER = process.env.AUTH_SERVER || 'http://localhost:8000';
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const REDIRECT_URI = `${APP_URL}/auth/callback`;

/**
 * Middleware: require authenticated user.
 * Decodes JWT from httpOnly cookie, checks expiry.
 */
export function requireAuth(req, res, next) {
    const token = req.cookies['access_token'];
    if (!token) {
        return res.redirect('/login.html');
    }
    try {
        const payload = JSON.parse(
            Buffer.from(token.split('.')[1], 'base64url').toString()
        );
        if (payload.exp && payload.exp < Date.now() / 1000) {
            res.clearCookie('access_token');
            res.clearCookie('id_token');
            return res.redirect('/login.html');
        }
        req.user = payload;
        next();
    } catch {
        res.clearCookie('access_token');
        res.clearCookie('id_token');
        return res.redirect('/login.html');
    }
}

/**
 * Register auth routes on the Express app.
 */
export function registerAuthRoutes(app) {
    app.use(cookieParser());

    // Start OAuth flow
    app.get('/auth/login', (req, res) => {
        const state = Math.random().toString(36).substring(2);
        res.cookie('oauth_state', state, { httpOnly: true, maxAge: 300000 });

        const authUrl = new URL(`${AUTH_SERVER}/o/authorize`);
        authUrl.searchParams.set('client_id', CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('state', state);

        res.redirect(authUrl.toString());
    });

    // OAuth callback — exchange code for tokens server-side
    app.get('/auth/callback', async (req, res) => {
        const { code, state } = req.query;
        const savedState = req.cookies['oauth_state'];

        if (!code || !state || state !== savedState) {
            return res.status(400).send('Invalid OAuth callback. State mismatch.');
        }

        res.clearCookie('oauth_state');

        try {
            const tokenRes = await fetch(`${AUTH_SERVER}/o/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'authorization_code',
                    code,
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    redirect_uri: REDIRECT_URI,
                }),
            });

            const tokenData = await tokenRes.json();

            if (!tokenRes.ok) {
                return res.status(401).send(`Authentication failed: ${tokenData.message}`);
            }

            res.cookie('access_token', tokenData.access_token, {
                httpOnly: true,
                maxAge: tokenData.expires_in * 1000,
                sameSite: 'lax',
            });
            res.cookie('id_token', tokenData.id_token, {
                httpOnly: true,
                maxAge: tokenData.expires_in * 1000,
                sameSite: 'lax',
            });

            return res.redirect('/');
        } catch (err) {
            return res.status(500).send('Token exchange failed.');
        }
    });

    // Get current user info
    app.get('/auth/me', requireAuth, (req, res) => {
        const idToken = req.cookies['id_token'];
        if (!idToken) return res.status(401).json({ error: 'Not authenticated' });

        try {
            const payload = JSON.parse(
                Buffer.from(idToken.split('.')[1], 'base64url').toString()
            );
            res.json({
                name: payload.name,
                email: payload.email,
                picture: payload.picture,
            });
        } catch {
            res.status(401).json({ error: 'Invalid token' });
        }
    });

    // Logout
    app.get('/auth/logout', (req, res) => {
        res.clearCookie('access_token');
        res.clearCookie('id_token');
        res.redirect('/login.html');
    });
}

/**
 * Socket.io authentication middleware.
 * Validates access_token from cookie on WebSocket handshake.
 */
export function socketAuthMiddleware(socket, next) {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) return next(new Error('Authentication required'));

    const cookies = Object.fromEntries(
        cookieHeader.split(';').map(c => {
            const [key, ...val] = c.trim().split('=');
            return [key, val.join('=')];
        })
    );

    const token = cookies['access_token'];
    if (!token) return next(new Error('Authentication required'));

    try {
        const payload = JSON.parse(
            Buffer.from(token.split('.')[1], 'base64url').toString()
        );
        if (payload.exp && payload.exp < Date.now() / 1000) {
            return next(new Error('Token expired'));
        }
        socket.user = payload;
        next();
    } catch {
        next(new Error('Invalid token'));
    }
}
