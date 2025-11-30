export default function handler(req, res) {
  res.json({ test: 'working', time: new Date().toISOString() });
}
