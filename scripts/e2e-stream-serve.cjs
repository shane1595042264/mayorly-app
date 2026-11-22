// Serves scripts/e2e-stream.html over HTTPS for scripts/e2e-stream.ps1, which points Chrome's
// www.twitch.tv here, so the Mayorly extension's stream eye runs on it as on Twitch. The page
// posts to /report each time its video is muted or unmuted; each post is a line in <report>.
//   node scripts/e2e-stream-serve.cjs <cert.pfx> <passphrase> <port> <report>
const fs = require('fs')
const https = require('https')
const path = require('path')

const [pfx, passphrase, port = '443', report = ''] = process.argv.slice(2)
const page = fs.readFileSync(path.join(__dirname, 'e2e-stream.html'))
https
  .createServer({ pfx: fs.readFileSync(pfx), passphrase }, (req, res) => {
    if (req.url === '/favicon.ico') return res.writeHead(404).end()
    if (req.method === 'POST' && req.url === '/report') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (report) fs.appendFileSync(report, body.slice(0, 500) + '\n')
        res.writeHead(204).end()
      })
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(page)
  })
  .listen(Number(port), '127.0.0.1', () => console.log(`serving on ${port}`))
