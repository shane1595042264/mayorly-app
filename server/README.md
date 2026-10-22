# mayorly-api

The sync server. It knows no rules of the product. It verifies a Google sign-in, hands out a session token, and keeps one state document per account with a revision number. Last writer wins: a `PUT` carries the revision it was based on and gets `409` with the winning document if someone else wrote first.

| | |
|---|---|
| `POST /auth/google` | `{ credential }` (a Google ID token) → `{ token, user }` |
| `GET /auth/me` | the signed-in user |
| `GET /sync/state?have=N` | `{ revision, state, updatedAt, device }`, or `unchanged: true` when `N` is current |
| `PUT /sync/state` | `{ baseRevision, state, device }` → `{ revision }` or `409 { revision, state }` |
| `GET /health` | pings the database |

Runs on Railway from the `Dockerfile`; the tables are created on boot. Environment: see `.env.example`.

```
cd server && npm install && npm run dev
```
