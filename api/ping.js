export default function handler(req, res) {
  res.json({ ping: 'pong', timestamp: new Date().toISOString() });
}
