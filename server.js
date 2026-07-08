const express = require('express');
const path = require('path');
const http = require('http');
const { Pool } = require('pg');
const session = require('express-session');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

const ADMIN_USER = 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json());
app.use(express.static(__dirname));

app.use(session({
    secret: process.env.SESSION_SECRET || 'piccolo-principe-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect()
    .then(() => console.log('Connected to PostgreSQL'))
    .catch(err => console.error('Database connection error:', err));

let adminSocket = null;
let viewerSockets = new Set();

io.on('connection', (socket) => {
    console.log('Client connesso:', socket.id);
    
    socket.on('admin-join', () => {
        adminSocket = socket;
        socket.isAdmin = true;
        console.log('Admin connesso');
    });
    
    socket.on('viewer-join', () => {
        viewerSockets.add(socket);
        socket.isViewer = true;
        console.log('Viewer connesso, tot:', viewerSockets.size);
    });
    
    socket.on('webcam-frame', (data) => {
        if (socket.isAdmin) {
            viewerSockets.forEach(viewer => {
                viewer.emit('webcam-frame', data);
            });
        }
    });
    
    socket.on('disconnect', () => {
        if (socket.isAdmin) {
            adminSocket = null;
            console.log('Admin disconnesso');
        }
        if (socket.isViewer) {
            viewerSockets.delete(socket);
            console.log('Viewer disconnesso, tot:', viewerSockets.size);
        }
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.isAdmin = true;
        res.json({ success: true, message: 'Login effettuato' });
    } else {
        res.status(401).json({ success: false, message: 'Credenziali errate' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/auth-status', (req, res) => {
    res.json({ isAdmin: !!req.session.isAdmin });
});

app.get('/api/aviators', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM f1_drivers');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

server.listen(PORT, () => {
    console.log(`Server avviato sulla porta ${PORT}`);
});
