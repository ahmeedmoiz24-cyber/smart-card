const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ---------- MongoDB Connection ----------
const MONGODB_URI = 'mongodb+srv://admin:admin123@cluster1.ulswexc.mongodb.net/chatcarddb?appName=Cluster1';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected!'))
  .catch(err => console.log('❌ DB Error:', err));

// ---------- Database Schema ----------
const cardSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: String,
  cvv: String,
  expiry: String,
  isLive: { type: Boolean, default: false },
  message: { type: String, default: '💳 Card is live! Set your message.' },
  readers: { type: [String], default: [] },
  transactions: { type: [String], default: [] },
  inbox: { type: [String], default: [] },
  sentMessages: { type: [String], default: [] },
  messageCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const Card = mongoose.model('Card', cardSchema);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- APIs ----------

// 1. Create Card
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
      message: '💳 Welcome! Set your first message.',
      readers: [],
      transactions: [],
      inbox: [],
      sentMessages: [],
      messageCount: 0
    });
    await newCard.save();
    res.json({ success: true, card: newCard });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get Card
app.get('/api/get-card/:id', async (req, res) => {
  try {
    const card = await Card.findOne({ id: req.params.id });
    if (!card) return res.status(404).json({ error: 'Card not found' });
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Toggle Live
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

// 4. UPDATE MY OWN MESSAGE (No send)
app.post('/api/update-message/:id', async (req, res) => {
  try {
    const { message, updaterName } = req.body;
    const card = await Card.findOne({ id: req.params.id });
    if (!card) return res.status(404).json({ error: 'Card not found' });
    if (!card.isLive) return res.status(403).json({ error: 'Card is offline' });
    
    card.message = message;
    card.transactions.push(`✏️ ${updaterName || card.name} updated message: "${message}"`);
    if (updaterName && !card.readers.includes(updaterName)) {
      card.readers.push(updaterName);
    }
    await card.save();
    
    io.to(card.id).emit('message-update', { 
      message: card.message, 
      readers: card.readers,
      transactions: card.transactions
    });
    res.json({ success: true, card });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. CUT & SEND to another card
app.post('/api/send-message/:senderId', async (req, res) => {
  try {
    const { receiverId, message, senderName } = req.body;
    const sender = await Card.findOne({ id: req.params.senderId });
    const receiver = await Card.findOne({ id: receiverId });
    
    if (!sender || !receiver) return res.status(404).json({ error: 'Card not found' });
    if (!sender.isLive || !receiver.isLive) return res.status(403).json({ error: 'One or both cards offline' });
    
    // Sender cuts message
    const cutMsg = `✂️ ${senderName || sender.name} cut: "${message}" → ${receiver.name}`;
    sender.transactions.push(cutMsg);
    sender.sentMessages.push(`To ${receiver.name}: ${message}`);
    sender.messageCount += 1;
    sender.message = message; // update sender's own message also
    
    // Receiver gets the message
    receiver.inbox.push(`📩 From ${sender.name}: ${message}`);
    receiver.transactions.push(`📩 Received from ${sender.name}: "${message}"`);
    receiver.message = message;
    
    await sender.save();
    await receiver.save();
    
    io.to(sender.id).emit('message-sent', { 
      message, receiver: receiver.name,
      transactions: sender.transactions,
      sentMessages: sender.sentMessages,
      messageCount: sender.messageCount
    });
    io.to(receiver.id).emit('message-received', { 
      message, sender: sender.name,
      inbox: receiver.inbox,
      transactions: receiver.transactions
    });
    io.emit('global-feed', {
      event: `✂️ ${sender.name} → ${receiver.name}: "${message}"`,
      timestamp: new Date().toLocaleTimeString()
    });
    
    res.json({ success: true, sender, receiver });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. REPLY
app.post('/api/reply-message/:replierId', async (req, res) => {
  try {
    const { originalSenderId, message, replierName } = req.body;
    const replier = await Card.findOne({ id: req.params.replierId });
    const originalSender = await Card.findOne({ id: originalSenderId });
    
    if (!replier || !originalSender) return res.status(404).json({ error: 'Card not found' });
    if (!replier.isLive || !originalSender.isLive) return res.status(403).json({ error: 'One or both offline' });
    
    const replyMsg = `💬 ${replierName || replier.name} replied: "${message}" → ${originalSender.name}`;
    replier.transactions.push(replyMsg);
    replier.sentMessages.push(`Reply to ${originalSender.name}: ${message}`);
    replier.messageCount += 1;
    replier.message = message;
    
    originalSender.inbox.push(`📩 Reply from ${replier.name}: ${message}`);
    originalSender.transactions.push(`📩 Received reply from ${replier.name}: "${message}"`);
    originalSender.message = message;
    
    await replier.save();
    await originalSender.save();
    
    io.to(replier.id).emit('reply-sent', { 
      message, originalSender: originalSender.name,
      transactions: replier.transactions
    });
    io.to(originalSender.id).emit('reply-received', { 
      message, replier: replier.name,
      inbox: originalSender.inbox,
      transactions: originalSender.transactions
    });
    io.emit('global-feed', {
      event: `💬 ${replier.name} replied to ${originalSender.name}`,
      timestamp: new Date().toLocaleTimeString()
    });
    
    res.json({ success: true, replier, originalSender });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. View Card (add reader)
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

// ---------- SOCKET.IO ----------
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  socket.on('join-card', (cardId) => {
    socket.join(cardId);
  });
  socket.on('global-join', () => {
    socket.join('global');
  });
});

// ---------- Frontend ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`🚀 Server live on http://localhost:${PORT}`);
});