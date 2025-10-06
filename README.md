# Rich Products — Frozen Food Supply Chain Traceability (Demo)

This repository is a demo traceability system for frozen-food items. It includes a Solidity contract and a Web3-enabled frontend with QR generation, IoT simulation, badges and a leaderboard. The frontend supports an in-page Login / Sign Up modal and can persist users/leaderboard to a cloud JSON store (MockAPI/JSONBin) or to browser localStorage.

Latest UX polish highlights:

- Refined dark theme with glassmorphism cards, upgraded typography (Inter & Poppins), and animated elements.
- Live connection status pill in the top bar indicating wallet and contract health (demo mode, warnings, successes).
- Product hero images that auto-load when you look up a lot (demo images + fallback map for on-chain data).
- Cleaner DOM structure (no inline styles, reusable classes) and safer rendering for IoT logs and leaderboard rows.
- Repository decluttered—legacy Remix artifacts and unused tests were removed for a lighter footprint.

This README includes step-by-step setup and testing instructions.

---

Prerequisites

- Node.js & npm (for local server or optional Hardhat): https://nodejs.org/
- MetaMask or compatible Web3 wallet installed in your browser.
- Recommended: a local HTTP server or VSCode Live Server (camera and MetaMask require http(s) context).

Quick steps summary

1. Serve the frontend locally (npx http-server or Live Server).
2. (Optional) Deploy `FoodTraceability.sol` with Remix or Hardhat and copy the contract address.
3. Configure `CONTRACT_ADDRESS` and `API_BASE_URL` in `app.js`.
4. Open the UI, sign up or log in, then lookup lots, simulate IoT logs and scan as a consumer to update the leaderboard.

Detailed step-by-step

1) Serve the frontend locally

PowerShell commands:

```powershell
# from repo root
npx http-server -p 8080

```

Alternatively use the VS Code Live Server extension.

2) Deploy the Solidity contract

Remix (fast):

- Open https://remix.ethereum.org
- Create a new file and paste `FoodTraceability.sol` contents.
- Compile using Solidity ^0.8.x.
- Deploy using Injected Web3 (MetaMask) or the JavaScript VM for local testing.
- Copy the deployed contract address.

Hardhat (repeatable local/dev):

```powershell
mkdir hf-deploy; cd hf-deploy
npm init -y
npm install --save-dev hardhat @nomiclabs/hardhat-ethers ethers
npx hardhat # choose 'create a javascript project'
```

- Copy `FoodTraceability.sol` into `hf-deploy/contracts/`.
- Add a simple deploy script `scripts/deploy.js` (example below).
- Run a local node and deploy:

```powershell
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost
```

Example deploy script (scripts/deploy.js):

```js
async function main(){
	const [deployer] = await ethers.getSigners();
	console.log('Deploying with', deployer.address);
	const Factory = await ethers.getContractFactory('FoodTraceability');
	const c = await Factory.deploy();
	await c.deployed();
	console.log('Deployed at', c.address);
}
main().catch(e=>{ console.error(e); process.exit(1); });
```

3) Configure the frontend

- Edit `d:\SemV\BlockChain\capstone-blockchain\app.js`.
- Set `CONTRACT_ADDRESS` to your deployed contract address (or leave empty to run demo mode).
- Optionally set `API_BASE_URL` to your MockAPI/JSONBin base URL to enable cloud persistence.
- (Optional) Add or update product images by editing the `PRODUCT_IMAGE_MAP` constant—unknown names fall back to a neutral hero photo.

At the top of `app.js`:

```js
const CONTRACT_ADDRESS = "0x..."; // set when contract is deployed (leave empty for demo)
const API_BASE_URL = ""; // e.g. https://xxxxx.mockapi.io (optional)
```

Notes about contract detection and wallet behavior

- The connection status pill (top-right) combines wallet + contract info: e.g., *Wallet: 0xABC…123 • Contract: simple ABI ready*. Color shifts indicate success/warning/error conditions.
- The frontend performs runtime detection between two supported ABIs (simple vs extended). If a `CONTRACT_ADDRESS` is provided the app will attempt safe, read-only calls to decide which ABI to use. If detection fails the app falls back to the browser demo data.
- The Connect Wallet button requests accounts from MetaMask. The app listens for `accountsChanged` and `chainChanged` events. On accounts disconnect, the status pill reverts to demo mode guidance; on a network change the page reloads to re-initialize web3 state.

4) (Optional) Create a MockAPI project for cloud persistence

- Create a free MockAPI account and project.
- Add two resources named `users` and `leaderboard`.
- Copy the base URL MockAPI gives you (e.g. `https://xxxxx.mockapi.io/api/v1`) and set it as `API_BASE_URL`.

How the app uses the API:

- POST `${API_BASE_URL}/users` to create users.
- GET `${API_BASE_URL}/users?username={username}` to lookup users on login.
- POST `${API_BASE_URL}/leaderboard` to persist leaderboard entries.

If API calls fail or `API_BASE_URL` is empty, the app uses localStorage keys: `rpf_users`, `rpf_user`, `rpf_leaderboard`.

5) Run and test the UI

- Start the local server and open the page in a browser.
- Click Login or Sign Up (in the top-left of the main card) and create an account.
- Enter `LOT-1001` or `LOT-2002` and click Lookup to view a demo product, IoT logs, and a contextual product image.
- Click Generate QR, Simulate IoT Log, and "I'm a Consumer — Scan" to award points and update the leaderboard.
- If `API_BASE_URL` is configured, leaderboard entries are POSTed to the remote API; otherwise they are saved in `localStorage`.

6) Optional: add live QR decoding (jsQR)

The demo generates QR images and shows a camera preview. To automatically decode QR codes and auto-lookup:

- Add jsQR (CDN):

```html
<script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"></script>
```

- In `app.js` add a small canvas and poll video frames (e.g., every 200-300ms), call `jsQR()` on the imageData and when a result is found, set `lotInput.value` and call `lookupProduct()`.

If you'd like, I can implement the jsQR integration and the code to wire it into the camera preview.

7) Troubleshooting

- MetaMask won't connect: ensure page is served over http(s) and MetaMask is unlocked.
- Contract calls fail: verify `CONTRACT_ADDRESS` points to the correct network and that MetaMask network matches the deployed network.
- LocalStorage issues: open DevTools -> Application -> Local Storage to inspect `rpf_users` and `rpf_leaderboard`.

Security notes & next steps

- This demo stores passwords in plaintext when using MockAPI/localStorage — suitable only for demos. For production, implement proper authentication (token-based, hashed passwords) and a secure backend.
- Suggested next work: add jsQR live decoding, add a small backend for secure accounts & leaderboard, or add a Hardhat project inside the repo for repeatable testing.

Repository housekeeping

- Removed Remix VM snapshots, Remix test dependencies, and scaffold tests to keep version control clean. Artifacts needed at runtime remain under `artifacts/`.
- CSS now defines reusable classes for modal actions, product images, timeline steps, and connection badges—feel free to extend styling there.
- The frontend JavaScript centralizes DOM lookups (`const $ = id => ...`) and connection status messaging, making it simpler to wire additional UI states.

If you want, I'll implement one of the suggested next steps (jsQR, MockAPI wiring, or Hardhat example) — tell me which and I will follow up with code changes.
