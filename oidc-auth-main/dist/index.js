"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = __importDefault(require("express"));
const node_path_1 = __importDefault(require("node:path"));
const drizzle_orm_1 = require("drizzle-orm");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const node_jose_1 = __importDefault(require("node-jose"));
const db_1 = require("./db");
const schema_1 = require("./db/schema");
const cert_1 = require("./utils/cert");
const admin_1 = __importDefault(require("./routes/admin"));
const oauth_1 = __importDefault(require("./routes/oauth"));
const app = (0, express_1.default)();
const PORT = process.env.PORT ?? 8000;
app.use(express_1.default.json());
app.use(express_1.default.static(node_path_1.default.resolve("public")));
// Mount routers
app.use("/admin", admin_1.default);
app.use("/o", oauth_1.default);
app.get("/", (req, res) => res.json({ message: "Hello from Auth Server" }));
app.get("/health", (req, res) => res.json({ message: "Server is healthy", healthy: true }));
// OIDC Endpoints
app.get("/.well-known/openid-configuration", (req, res) => {
    const ISSUER = `http://localhost:${PORT}`;
    return res.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/o/authorize`,
        token_endpoint: `${ISSUER}/o/token`,
        userinfo_endpoint: `${ISSUER}/o/userinfo`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        scopes_supported: ["openid", "profile", "email"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
    });
});
app.get("/.well-known/jwks.json", async (_, res) => {
    const key = await node_jose_1.default.JWK.asKey(cert_1.PUBLIC_KEY, "pem");
    return res.json({ keys: [key.toJSON()] });
});
app.get("/o/authenticate", (req, res) => {
    return res.sendFile(node_path_1.default.resolve("public", "authenticate.html"));
});
app.post("/o/authenticate/sign-in", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400).json({ message: "Email and password are required." });
        return;
    }
    const [user] = await db_1.db
        .select()
        .from(schema_1.usersTable)
        .where((0, drizzle_orm_1.eq)(schema_1.usersTable.email, email))
        .limit(1);
    if (!user || !user.password || !user.salt) {
        res.status(401).json({ message: "Invalid email or password." });
        return;
    }
    const hash = node_crypto_1.default
        .createHash("sha256")
        .update(password + user.salt)
        .digest("hex");
    if (hash !== user.password) {
        res.status(401).json({ message: "Invalid email or password." });
        return;
    }
    const ISSUER = `http://localhost:${PORT}`;
    const now = Math.floor(Date.now() / 1000);
    const claims = {
        iss: ISSUER,
        sub: user.id,
        email: user.email,
        email_verified: String(user.emailVerified),
        exp: now + 3600,
        given_name: user.firstName ?? "",
        family_name: user.lastName ?? undefined,
        name: [user.firstName, user.lastName].filter(Boolean).join(" "),
        picture: user.profileImageURL ?? undefined,
    };
    const token = jsonwebtoken_1.default.sign(claims, cert_1.PRIVATE_KEY, { algorithm: "RS256" });
    res.json({ token });
});
app.post("/o/authenticate/sign-up", async (req, res) => {
    const { firstName, lastName, email, password } = req.body;
    if (!email || !password || !firstName) {
        res
            .status(400)
            .json({ message: "First name, email, and password are required." });
        return;
    }
    const [existing] = await db_1.db
        .select({ id: schema_1.usersTable.id })
        .from(schema_1.usersTable)
        .where((0, drizzle_orm_1.eq)(schema_1.usersTable.email, email))
        .limit(1);
    if (existing) {
        res
            .status(409)
            .json({ message: "An account with this email already exists." });
        return;
    }
    const salt = node_crypto_1.default.randomBytes(16).toString("hex");
    const hash = node_crypto_1.default
        .createHash("sha256")
        .update(password + salt)
        .digest("hex");
    await db_1.db.insert(schema_1.usersTable).values({
        firstName,
        lastName: lastName ?? null,
        email,
        password: hash,
        salt,
    });
    res.status(201).json({ ok: true });
});
app.get("/o/userinfo", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        res
            .status(401)
            .json({ message: "Missing or invalid Authorization header." });
        return;
    }
    const token = authHeader.slice(7);
    let claims;
    try {
        claims = jsonwebtoken_1.default.verify(token, cert_1.PUBLIC_KEY, {
            algorithms: ["RS256"],
        });
    }
    catch {
        res.status(401).json({ message: "Invalid or expired token." });
        return;
    }
    const [user] = await db_1.db
        .select()
        .from(schema_1.usersTable)
        .where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, claims.sub))
        .limit(1);
    if (!user) {
        res.status(404).json({ message: "User not found." });
        return;
    }
    res.json({
        sub: user.id,
        email: user.email,
        email_verified: user.emailVerified,
        given_name: user.firstName,
        family_name: user.lastName,
        name: [user.firstName, user.lastName].filter(Boolean).join(" "),
        picture: user.profileImageURL,
    });
});
app.listen(PORT, () => {
    console.log(`AuthServer is running on PORT ${PORT}`);
});
//# sourceMappingURL=index.js.map