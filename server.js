const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Initialize SQLite Database
const db = new sqlite3.Database('./licenses.db', (err) => {
    if (err) {
        console.error('Database opening error: ', err.message);
    } else {
        console.log('Connected to SQLite database.');
        
        // Create table after connection is established
        db.run(`CREATE TABLE IF NOT EXISTS licenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE,
            device_id TEXT,
            duration_days INTEGER DEFAULT 30,
            activated_at TEXT,
            expires_at TEXT,
            is_active INTEGER DEFAULT 1
        )`);
    }
});

// API Route: Generate a new 8-digit code
app.post('/api/generate', (req, res) => {
    const code = Math.floor(10000000 + Math.random() * 90000000).toString();
    const durationDays = req.body.duration_days || 30;

    db.run(`INSERT INTO licenses (code, duration_days) VALUES (?, ?)`, [code, durationDays], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error generating code' });
        }
        res.json({ success: true, code: code, duration_days: durationDays });
    });
});

// API Route: Verify or Activate Code from Chrome Extension
app.post('/api/verify', (req, res) => {
    const { code, device_id } = req.body;

    if (!code || !device_id) {
        return res.status(400).json({ error: 'Missing code or device ID' });
    }

    db.get(`SELECT * FROM licenses WHERE code = ?`, [code], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!row) {
            return res.status(404).json({ error: 'Invalid license code' });
        }

        if (row.is_active === 0) {
            return res.status(403).json({ error: 'License key has been disabled' });
        }

        const now = new Date();

        if (row.expires_at && new Date(row.expires_at) < now) {
            return res.status(403).json({ error: 'License key has expired' });
        }

        if (row.device_id && row.device_id !== device_id) {
            return res.status(403).json({ error: 'License key is already bound to another device' });
        }

        if (!row.device_id) {
            const activatedAt = now.toISOString();
            const expiryDate = new Date();
            expiryDate.setDate(now.getDate() + row.duration_days);
            const expiresAt = expiryDate.toISOString();

            db.run(
                `UPDATE licenses SET device_id = ?, activated_at = ?, expires_at = ? WHERE code = ?`,
                [device_id, activatedAt, expiresAt, code],
                (updateErr) => {
                    if (updateErr) {
                        return res.status(500).json({ error: 'Failed to bind device' });
                    }
                    return res.json({ success: true, message: 'License activated successfully', expires_at: expiresAt });
                }
            );
        } else {
            return res.json({ success: true, message: 'License verified successfully', expires_at: row.expires_at });
        }
    });
});

// API Route: Get all licenses for Admin Dashboard table
app.get('/api/licenses', (req, res) => {
    db.all(`SELECT * FROM licenses ORDER BY id DESC`, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error fetching licenses' });
        }
        res.json({ success: true, licenses: rows });
    });
});

// API Route: Reset device binding for a specific license key
app.post('/api/reset-device', (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ error: 'Missing license code' });
    }

    db.run(
        `UPDATE licenses SET device_id = NULL, activated_at = NULL, expires_at = NULL WHERE code = ?`,
        [code],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error resetting device' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'License key not found' });
            }
            res.json({ success: true, message: `Device binding reset for key ${code}` });
        }
    );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`License server running on port ${PORT}`);
});