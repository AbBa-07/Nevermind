# CivicFlow backend

Express API for voter credential issuance and vote relaying to the Polygon Amoy contract.

## Run locally

1. Use Node.js 20 or later.
2. From this directory, run `npm install` (runtime packages: `express`, `mongoose`, `ethers`, `cors`, `dotenv`, `helmet`, and `express-rate-limit`).
3. Copy `.env.example` to `.env`, then provide:
   - `MONGO_URI`: MongoDB connection string.
   - `RPC_URL`: an RPC endpoint connected to Polygon Amoy (chain ID `80002`).
   - `PRIVATE_KEY`: private key for a relayer wallet funded with Amoy test POL.
   - `CONTRACT_ADDRESS`: address of the deployed `Voting` contract on Amoy.
   - `CORS_ORIGINS`: comma-separated allowed frontend origins.
4. Run `npm start`.

The server checks the contract address and Amoy chain ID on startup, connects to MongoDB, and waits for the voter indexes before accepting requests. Never commit `.env` or use a production wallet's private key for local development.

## API

- `POST /api/auth/verify` — JSON `{ "studentId": "..." }`; issues a one-time random credential hash.
- `POST /api/vote` — JSON `{ "tokenHash": "0x...", "candidateId": 0 }`; submits and confirms the vote. A `202` response means confirmation or database reconciliation is pending; retrying the same request is safe and reconciles a recorded transaction.
- `GET /health` — reports API and MongoDB connection status.

The voter record stores a SHA-256 student ID digest, the one-time credential hash, authentication/vote flags, and transaction reconciliation state. MongoDB reserves each credential atomically before relaying; the contract also rejects repeated credentials. Treat `tokenHash` as a bearer credential and transmit it only over HTTPS. Pending transactions whose hash could not be persisted are deliberately locked against resubmission and require operational reconciliation.

## Important security limits

This is a testnet implementation, not a complete institutional identity or secret-ballot system. As requested, an unrecognized student ID is registered automatically; that does **not** verify enrollment, so anyone who can submit an ID can claim it unless an authoritative eligibility check is added. Plain SHA-256 of a predictable student ID is vulnerable to guessing, and the database links each student-ID digest to the credential whose hash is published on-chain. Therefore this design does not provide strong anonymity or unlinkability. Use an independently audited eligibility system and an unlinkable credential / privacy-preserving voting protocol before real elections.

The included rate limiter uses in-memory state and is per process. For multiple backend instances, configure a shared rate-limit store. Free MongoDB/RPC tiers and Amoy are subject to provider limits and are not suitable availability guarantees for a real election.
