# Rich Products — Frozen Food Supply Chain Traceability (Demo)
# Rich Products — Frozen Food Supply Chain Traceability (Demo)

This repository contains a demo blockchain-based traceability system for frozen food items.

Contents
- `FoodTraceability.sol` — Main Solidity smart contract (full feature set).
- `FoodTraceabilityFull.sol` - REMOVED / neutralized (use `FoodTraceability.sol` as canonical contract).
- `index.html`, `styles.css`, `app.js` — Frontend demo (Web3 integration + QR code generator, IoT simulation, badges, leaderboard). The frontend now includes a login/signup modal and optional cloud JSON persistence.

Quickstart (Frontend-only demo)
1. Open `index.html` in a browser. For full Web3 interactions use a local web server (e.g., `npx http-server` or VSCode Live Server) to avoid camera/security restrictions.
2. Use the input box to enter a lot number (examples: `LOT-1001`, `LOT-2002`) and click Lookup.
3. Generate QR, simulate IoT logs, and press "I'm a Consumer — Scan" to award session points and see badges.

Web3 / Contract notes
- To interact with the Solidity contract on a network, deploy `FoodTraceability.sol` (Solidity ^0.8.x) using Remix, Hardhat, or Truffle.
- After deploying, paste the deployed contract address into `app.js` in the `CONTRACT_ADDRESS` constant.
- The frontend attempts to detect whether the deployed contract conforms to the simple or extended ABI and adapts calls accordingly.
- Use MetaMask to connect and send transactions.

Security & Limitations
- This is a demo. The contract uses simple role checks and is not production hardened.
- Camera QR scanning is a visual/demo helper — no full QR decoding library is included. For production use, integrate ZXing or jsQR.

Files to consider updating
- `CONTRACT_ADDRESS` and `API_BASE_URL` in `app.js`.
- `DEMO_PRODUCTS` in `app.js` for more sample lots.

Auth & cloud persistence
- The app uses an in-page Login / Sign Up modal (click Login or Sign Up in the main card).
- When `API_BASE_URL` is set the app will attempt to use REST endpoints under that base URL (e.g. `${API_BASE_URL}/users` and `${API_BASE_URL}/leaderboard`). Otherwise it falls back to `localStorage` keys: `rpf_users`, `rpf_user`, `rpf_leaderboard`.

Example MockAPI setup (quick)
- Create a MockAPI project and add two resources: `users` and `leaderboard`.
- Set `API_BASE_URL` in `app.js` to the base URL MockAPI gives you (e.g. `https://xxxxx.mockapi.io`). The frontend will POST to `${API_BASE_URL}/users` to signup and `${API_BASE_URL}/leaderboard` to persist leaderboard entries.

License: MIT
