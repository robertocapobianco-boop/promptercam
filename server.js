const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 5000;

// In-memory store with file persistence
const STORE_FILE = path.join(__dirname, 'data', 'store.json');
let store = {};

// Load existing data
try {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  if (fs.existsSync(STORE_FILE)) {
    store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
  }
} catch(e) {}

function persistStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store), 'utf-8');
  } catch(e) {}
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Key-value store API
app.get('/api/store', (req, res) => {
  res.json(store);
});

app.post('/api/store', (req, res) => {
  const { key, value } = req.body;
  if (key) {
    store[key] = value;
    persistStore();
  }
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PrompterCam running on port ${PORT}`);
});
