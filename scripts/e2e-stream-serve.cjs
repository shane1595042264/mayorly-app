// Serves scripts/e2e-stream.html over HTTPS for scripts/e2e-stream.ps1, which points Chrome's
// www.twitch.tv here, so the Mayorly extension's stream eye runs on it as on Twitch.
//   node scripts/e2e-stream-serve.cjs <cert.pfx> <passphrase> [port]
const fs = require('fs')
const https = require('https')
const path = require('path')

const [pfx, passphrase, port = '443'] = process.argv.slice(2)
const page = fs.readFileSync(path.join(__dirname, 'e2e-stream.html'))
https
  .createServer({ pfx: fs.readFileSync(pfx), passphrase }, (req, res) => {
    if (req.url === '/favicon.ico') return res.writeHead(404).end()
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(page)
  })
  .listen(Number(port), '127.0.0.1', () => console.log(`serving on ${port}`))
