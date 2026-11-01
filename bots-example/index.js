// 🤖 Example Bot
// This is a sample bot you can upload to the panel

const http = require('http');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from Bot Hosting Panel!\n');
});

server.listen(PORT, () => {
  console.log(`✅ Bot server running on port ${PORT}`);
  console.log(`🕐 Started at: ${new Date().toLocaleString()}`);
});

// Keep alive
setInterval(() => {
  console.log(`💓 Heartbeat - ${new Date().toLocaleString()}`);
}, 30000);
