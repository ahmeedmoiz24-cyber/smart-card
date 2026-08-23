const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ---------- YAHAN AAPKI DI HUI URI LAG GAYI (PERMANENT DB) ----------
const MONGODB_URI = 'mongodb+srv://admin:admin123@cluster1.ulswexc.mongodb.net/chatcarddb?appName=Cluster1';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB Atlas PERMANENT Database Connected Successfully!'))
  .catch(err => console.log('❌ DB Error:', err));

// ---------- DATABASE SCHEMA ----------
const cardSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: String,
  cvv: String,
  expiry: String,
  isLive: { type: Boolean, default: false },
  message: { type: String, default: 'Welcome! Send your first message.' },
  readers: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});

const Card = mongoose.model('Card', cardSchema);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- REST APIs ----------
app.post('/api/create-card', async (req, res) => {
  try {
    const { name, cvv, expiry } = req.body;
    const cardNumber = Math.floor(1000000000000000 + Math.random() * 9000000000000000).toString();
    
    const newCard = new Card({
      id: cardNumber,
      name: name || 'Unknown',
      cvv: cvv || '0000',
      expiry: expiry || '12/30',
      isLive: false,
      message: 'Welcome!',
      readers: []
    });
    await newCard.save();
    res.json({ success: true, card: newCard });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/get-card/:id', async (req, res) => {
  try {
    const card = await Card.findOne({ id: req.params.id });
    if (!card) return res.status(404).json({ error: 'Card not found' });
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/toggle-live/:id', async (req, res) => {
  try {
    const card = await Card.findOne({ id: req.params.id });
    if (!card) return res.status(404).json({ error: 'Card not found' });
    card.isLive = !card.isLive;
    await card.save();
    io.to(card.id).emit('live-update', { isLive: card.isLive });
    res.json({ success: true, isLive: card.isLive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/update-message/:id', async (req, res) => {
  try {
    const { message, viewerName } = req.body;
    const card = await Card.findOne({ id: req.params.id });
    if (!card) return res.status(404).json({ error: 'Card not found' });
    if (!card.isLive) return res.status(403).json({ error: 'Card is offline' });
    
    card.message = message;
    if (viewerName && !card.readers.includes(viewerName)) {
      card.readers.push(viewerName);
    }
    await card.save();
    io.to(card.id).emit('message-update', { message: card.message, readers: card.readers });
    res.json({ success: true, card });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/view-card/:id', async (req, res) => {
  try {
    const { viewerName } = req.body;
    const card = await Card.findOne({ id: req.params.id });
    if (!card) return res.status(404).json({ error: 'Card not found' });
    if (viewerName && !card.readers.includes(viewerName)) {
      card.readers.push(viewerName);
      await card.save();
      io.to(card.id).emit('reader-update', { readers: card.readers });
    }
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- SOCKET.IO (REAL-TIME) ----------
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join-card', (cardId) => {
    socket.join(cardId);
    console.log(`Socket joined room: ${cardId}`);
  });

  socket.on('send-message-live', async (data) => {
    try {
      const { cardId, message, sender } = data;
      const card = await Card.findOne({ id: cardId });
      if (card && card.isLive) {
        card.message = message;
        if (sender && !card.readers.includes(sender)) {
          card.readers.push(sender);
        }
        await card.save();
        io.to(cardId).emit('live-message', {
          message: card.message,
          readers: card.readers,
          updatedBy: sender
        });
      }
    } catch (err) {
      console.log('Socket error:', err);
    }
  });
});

// ---------- FRONTEND ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`🚀 Server live on http://localhost:${PORT}`);
  console.log(`📦 Data ab PERMANENT hai. Kabhi nahi mitega!`);
});