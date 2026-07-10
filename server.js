const express = require('express');
const path = require('path');
const http = require('http');
const { Pool } = require('pg');
const session = require('express-session');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { 
        origin: true,
        methods: ["GET", "POST"],
        credentials: true
    },
    allowEIO3: true
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

pool.query(`
    CREATE TABLE IF NOT EXISTS sensor_data (
        id SERIAL PRIMARY KEY,
        touch BOOLEAN DEFAULT false,
        proximity INTEGER DEFAULT 0,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).catch(err => console.error('Table creation error:', err));

let adminSocket = null;
let viewerSockets = new Set();
let totalLikes = 0;

io.on('connection', (socket) => {
    console.log('Client connesso:', socket.id);
    
    socket.emit('likes-update', totalLikes);
    
    socket.on('admin-join', () => {
        adminSocket = socket;
        socket.isAdmin = true;
        totalLikes = 0;
        io.emit('likes-update', totalLikes);
        console.log('Admin connesso, like resettati');
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
    
    socket.on('audio-frame', (data) => {
        if (socket.isAdmin) {
            viewerSockets.forEach(viewer => {
                viewer.emit('audio-frame', data);
            });
        }
    });
    
    socket.on('add-like', () => {
        totalLikes++;
        io.emit('likes-update', totalLikes);
    });
    
    socket.on('add-ten-likes', () => {
        totalLikes += 10;
        io.emit('likes-update', totalLikes);
    });
    
    socket.on('zoom-change', (data) => {
        if (socket.isAdmin) {
            viewerSockets.forEach(viewer => {
                viewer.emit('zoom-change', data);
            });
        }
    });
    
    socket.on('planet-activate', (data) => {
        io.emit('planet-activate', data);
    });
    
    socket.on('planet-deactivate', (data) => {
        io.emit('planet-deactivate', data);
    });
    
    socket.on('planet-deactivate-all', () => {
        io.emit('planet-deactivate-all');
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
        const result = await pool.query('SELECT * FROM sensor_data ORDER BY timestamp DESC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sensors', async (req, res) => {
    try {
        let { touch, proximity } = req.body;
        
        if (touch === 1 || touch === '1') touch = true;
        else if (touch === 0 || touch === '0') touch = false;
        
        const result = await pool.query(
            'INSERT INTO sensor_data (touch, proximity) VALUES ($1, $2) RETURNING *',
            [touch, proximity]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/test-data', async (req, res) => {
    try {
        const testInserts = [
            { touch: false, proximity: 50 },
            { touch: false, proximity: 45 },
            { touch: false, proximity: 30 },
            { touch: true, proximity: 5 },
            { touch: false, proximity: 20 },
            { touch: false, proximity: 35 },
            { touch: true, proximity: 2 },
            { touch: false, proximity: 60 },
            { touch: false, proximity: 55 },
            { touch: true, proximity: 8 }
        ];
        
        for (const data of testInserts) {
            await pool.query(
                'INSERT INTO sensor_data (touch, proximity) VALUES ($1, $2)',
                [data.touch, data.proximity]
            );
        }
        
        res.json({ message: 'Dati di test inseriti!', count: testInserts.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/sensors', async (req, res) => {
    if (!req.session.isAdmin) {
        return res.status(403).json({ error: 'Accesso negato' });
    }
    
    try {
        await pool.query('DELETE FROM sensor_data');
        res.json({ message: 'Tutti i dati sono stati eliminati' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

server.listen(PORT, () => {
    console.log(`Server avviato sulla porta ${PORT}`);
});
