// app.js (fixed & simplified)
// Frontend logic for Rich Products traceability demo
// - Single ABI (extended) assumed to match FoodTraceability.sol
// - Safer contract init + demo fallback
// - Fixed localStorage/signup/login bugs
// - jsQR camera decode support (optional if jsQR is loaded)
// - Fixed IoT demo insertion (no duplicate keys)
// - Cleaner leaderboard merging

// ==== CONFIG ====
const CONTRACT_ADDRESS = "0x23Ec6454b4eEE71E5Eb9D76A7dDf2f3BdfE82cAa"; // paste deployed contract address here if available (leave empty to run demo mode)
const API_BASE_URL = ""; // optional: cloud JSON API base URL (MockAPI / JSONBin). If empty, localStorage is used.

// ==== STATE ====
let web3;
let contract = null;
let accounts = [];
let contractAvailable = false;

const $ = (id) => document.getElementById(id);
const shortenAddress = (addr = '') => (addr ? `${addr.slice(0,6)}...${addr.slice(-4)}` : '');
const TIMELINE_STAGES = ['Vendor', 'Manufacturer', 'Logistics', 'Retail'];
const DEMO_IOT_NOTES = ['Packed', 'In Cold Storage', 'Transit', 'Delivered'];
const BADGE_LIBRARY = ['Sustainable Product', 'Farm Fresh', 'Cold Chain Champion'];
const CAMERA_TIMEOUT_MS = 10000;
const DEFAULT_PRODUCT_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/4/46/Frozen_peas_with_snow.jpg';

// Extended ABI (keeps the methods used in this frontend). Update if your contract differs.
const ABI_EXTENDED = [
  {"inputs":[{"internalType":"string","name":"lotNumber","type":"string"}],"name":"consumerLookupByLot","outputs":[{"internalType":"string","name":"name","type":"string"},{"internalType":"string","name":"origin","type":"string"},{"internalType":"string","name":"certifications","type":"string"},{"internalType":"uint8","name":"stage","type":"uint8"},{"internalType":"address","name":"handler","type":"address"},{"internalType":"string","name":"latestQR","type":"string"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"string","name":"lotNumber","type":"string"}],"name":"getIoTLogs","outputs":[{"internalType":"int256[]","name":"temps","type":"int256[]"},{"internalType":"string[]","name":"notes","type":"string[]"},{"internalType":"uint256[]","name":"timestamps","type":"uint256[]"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"string","name":"lotNumber","type":"string"},{"internalType":"int256","name":"temperature","type":"int256"},{"internalType":"string","name":"handlingNotes","type":"string"}],"name":"captureIoTData","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"string","name":"lotNumber","type":"string"}],"name":"generateQRToken","outputs":[{"internalType":"string","name":"token","type":"string"}],"stateMutability":"nonpayable","type":"function"}
];

// UI connection status object
const CONNECTION_STATUS = {
  wallet: 'Wallet: not detected',
  contract: 'Contract: demo mode',
  tone: 'warning'
};
const renderConnectionStatus = () => {
  const el = $('connectionStatus');
  if (!el) return;
  el.textContent = `${CONNECTION_STATUS.wallet} • ${CONNECTION_STATUS.contract}`;
  el.dataset.tone = CONNECTION_STATUS.tone;
};
const setWalletStatus = (message, tone) => { CONNECTION_STATUS.wallet = message; if (tone) CONNECTION_STATUS.tone = tone; renderConnectionStatus(); };
const setContractStatus = (message, tone) => { CONNECTION_STATUS.contract = message; if (tone) CONNECTION_STATUS.tone = tone; renderConnectionStatus(); };

// Demo data store for when contract is not connected
const DEMO_PRODUCTS = {
  "LOT-1001": {
    name: "Frozen Peas",
    origin: "Green Valley Farms, CA",
    certifications: "Organic, FairTrade",
    stage: "Retail",
    iot: [{ts: Date.now()-3600*1000, temp:-18, note:"Packed"}, {ts: Date.now()-1800*1000, temp:-19, note:"In Cold Storage"}],
    imageUrl: "https://topcart.s3.ap-south-1.amazonaws.com/wp-content/uploads/2021/11/11182908/thumbnail-1.png"
  },
  "LOT-2002": {
    name: "Mixed Berries",
    origin: "Berry Farms, WA",
    certifications: "Sustainably Grown",
    stage: "Logistics",
    iot: [{ts: Date.now()-7200*1000, temp:-16, note:"Loaded"}, {ts: Date.now()-4000*1000, temp:-17, note:"Transit"}],
    imageUrl: "https://images.unsplash.com/photo-1598512752271-33f913a53283?q=80&w=1974&auto=format&fit=crop"
  }
};

// Image matchers
const PRODUCT_IMAGE_MATCHERS = [
  { keywords: ['frozen', 'peas'], url: 'https://upload.wikimedia.org/wikipedia/commons/4/46/Frozen_peas_with_snow.jpg' },
  { keywords: ['peas'], url: 'https://upload.wikimedia.org/wikipedia/commons/4/46/Frozen_peas_with_snow.jpg' },
  { keywords: ['mixed', 'berries'], url: 'https://images.unsplash.com/photo-1598512752271-33f913a53283?q=80&w=1974&auto=format&fit=crop' },
  { keywords: ['berries'], url: 'https://images.unsplash.com/photo-1598512752271-33f913a53283?q=80&w=1974&auto=format&fit=crop' },
  { keywords: ['spinach'], url: 'https://images.unsplash.com/photo-1576045057995-568f588f2d80?q=80&w=1974&auto=format&fit=crop' }
];
const getProductImage = (name = '') => {
  if (!name) return DEFAULT_PRODUCT_IMAGE;
  const normalized = name.trim().toLowerCase();
  for (const matcher of PRODUCT_IMAGE_MATCHERS) {
    const hitsAll = matcher.keywords.every((keyword) => normalized.includes(keyword));
    if (hitsAll) return matcher.url;
  }
  return DEFAULT_PRODUCT_IMAGE;
};

const LEADERBOARD = [
  {name: "Alice", points: 120, badges: ["Sustainable Product"]},
  {name: "Bob", points: 95, badges: ["Farm Fresh"]},
  {name: "Carol", points: 82, badges: ["Cold Chain Champion"]}
];

let currentUser = null; // { username, id }
let sessionPoints = 0;

// web3 / contract initialization
async function init() {
  // wire UI
  const lookupBtn = $('lookupBtn'); if (lookupBtn) lookupBtn.onclick = lookupProduct;
  const generateQRBtn = $('generateQRBtn'); if (generateQRBtn) generateQRBtn.onclick = generateQR;
  const scanQRBtn = $('scanQRBtn'); if (scanQRBtn) scanQRBtn.onclick = startCameraScan;
  const logIoTBtn = $('logIoTBtn'); if (logIoTBtn) logIoTBtn.onclick = simulateIoT;
  const scanBtn = $('scanBtn'); if (scanBtn) scanBtn.onclick = consumerScan;
  const connectBtn = $('connectBtn'); if (connectBtn) connectBtn.onclick = connectWallet;
  const loginBtn = $('loginBtn'); if(loginBtn) loginBtn.onclick = ()=>openAuthModal('login');
  const signupBtn = $('signupBtn'); if(signupBtn) signupBtn.onclick = ()=>openAuthModal('signup');
  const logoutBtn = $('logoutBtn'); if(logoutBtn) logoutBtn.onclick = logout;

  // auth modal handlers
  const authModal = $('authModal');
  const authForm = $('authForm');
  const authCancel = $('authCancel');
  if (authCancel) authCancel.onclick = closeAuthModal;
  if (authForm) authForm.addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const usernameField = $('authUsername'); const passwordField = $('authPassword');
    const username = usernameField ? usernameField.value.trim() : '';
    const password = passwordField ? passwordField.value : '';
    if (!username || !password) return alert('Username and password required');
    if (authModal && authModal.dataset.mode === 'signup') {
      await signup(username, password);
    } else {
      await login(username, password);
    }
    closeAuthModal();
  });

  // restore saved user
  try { const saved = localStorage.getItem('rpf_user'); if (saved) { currentUser = JSON.parse(saved); onLoginSuccess(currentUser); } } catch(e){}

  renderLeaderboard();
  renderBadges();
  renderConnectionStatus();

  if (CONTRACT_ADDRESS) {
    setContractStatus('Contract: detecting…', 'info');
  } else {
    setContractStatus('Contract: demo mode (no address configured)', 'warning');
  }

  // try connect to web3 (wallet)
  if (window.ethereum) {
    setWalletStatus('Wallet: detected (click Connect Wallet)', 'info');
    web3 = new Web3(window.ethereum);
    try {
      accounts = await web3.eth.getAccounts();
      if (accounts.length) onConnected(accounts[0]);
      // initialize contract if address present
      await initContract();

      // attach event listeners safely
      try {
        window.ethereum.removeAllListeners && window.ethereum.removeAllListeners('accountsChanged');
        window.ethereum.removeAllListeners && window.ethereum.removeAllListeners('chainChanged');

        window.ethereum.on('accountsChanged', async (accs) => {
          accounts = accs || [];
          if (accounts.length) onConnected(accounts[0]); else onConnected('');
          // re-initialize contract if account changes
          await initContract();
        });

        window.ethereum.on('chainChanged', (chainId) => {
          // remove listeners, then reload to re-init web3 & contract
          try { window.ethereum.removeAllListeners && window.ethereum.removeAllListeners('accountsChanged'); } catch(e){}
          try { window.ethereum.removeAllListeners && window.ethereum.removeAllListeners('chainChanged'); } catch(e){}
          setTimeout(()=>window.location.reload(), 200);
        });
      } catch (e) { console.warn('Failed to attach ethereum event listeners', e); }
    } catch(e) { console.log('web3 init error', e); }
  } else {
    setWalletStatus('Wallet: not detected — demo mode', 'warning');
  }
}

// Initialize contract (simple approach: assume extended ABI)
async function initContract() {
  contract = null;
  contractAvailable = false;
  if (!CONTRACT_ADDRESS || CONTRACT_ADDRESS.length === 0) {
    setContractStatus('Contract: demo mode (no address configured)', 'warning');
    return;
  }
  if (!web3) {
    setContractStatus('Contract: wallet not connected yet', 'warning');
    return;
  }

  try {
    const c = new web3.eth.Contract(ABI_EXTENDED, CONTRACT_ADDRESS);
    // make a safe read-only probe call (non-destructive)
    try {
      await c.methods.consumerLookupByLot('LOT-1001').call();
      contract = c;
      contractAvailable = true;
      setContractStatus('Contract: extended ABI ready', 'success');
      return;
    } catch (e) {
      // probe failed, still set contract but mark not available if methods fail later
      contract = c;
      contractAvailable = true; // still set true because some chains may reject probe for permission; rely on try/catch in actual calls
      setContractStatus('Contract: connected (probe warning)', 'info');
      return;
    }
  } catch (e) {
    console.warn('Contract init failed', e);
    setContractStatus('Contract: detection failed — using demo data', 'error');
    contract = null;
    contractAvailable = false;
  }
}

function onConnected(addr = '') {
  const btn = $('connectBtn');
  if (!btn) return;
  if (!addr) {
    btn.textContent = 'Connect Wallet';
    btn.classList.remove('connected');
    setWalletStatus('Wallet: disconnected', 'warning');
    return;
  }
  const short = shortenAddress(addr);
  btn.textContent = short;
  btn.classList.add('connected');
  setWalletStatus(`Wallet: ${short}`, 'success');
}

async function connectWallet() {
  if (!window.ethereum) {
    alert('Install MetaMask or a Web3 wallet');
    setWalletStatus('Wallet: not detected — install MetaMask to connect', 'error');
    return;
  }
  try {
    const requested = await window.ethereum.request({ method: 'eth_requestAccounts' });
    accounts = requested || [];
    if (accounts.length) {
      onConnected(accounts[0]);
      await initContract();
    } else {
      onConnected('');
    }
  } catch(e) {
    console.error(e);
    setWalletStatus('Wallet: connection request rejected', 'error');
  }
}

// Lookup product (uses on-chain if available, otherwise demo)
async function lookupProduct() {
  const input = $('lotInput');
  if (!input) return;
  const lot = input.value.trim();
  if (!lot) { alert('Enter lot number'); return; }

  clearProductUI();

  // if contract available, prefer on-chain lookup (safe try/catch)
  if (CONTRACT_ADDRESS && contract && web3 && contractAvailable) {
    try {
      const res = await contract.methods.consumerLookupByLot(lot).call();
      // consumerLookupByLot returns: name, origin, certifications, stage, handler, latestQR
      const name = res[0] || '';
      const origin = res[1] || '';
      const certs = res[2] || '';
      const stageNum = parseInt(res[3] || '0', 10);
      const imageUrl = getProductImage(name);
      showProduct({ name, origin, certs, stage: stageToString(stageNum), imageUrl });

      // fetch IoT logs if available
      try {
        const logsRes = await contract.methods.getIoTLogs(lot).call();
        const temps = logsRes[0] || [];
        const notes = logsRes[1] || [];
        const timestamps = logsRes[2] || [];
        const logs = temps.map((t, idx) => ({
          ts: parseInt(timestamps[idx] || '0', 10) * 1000,
          temp: parseInt(t, 10),
          note: notes[idx] || ''
        }));
        renderIoTLogs(logs);
      } catch (e) {
        // not fatal — just show empty logs or demo fallback
        console.warn('Failed to fetch on-chain IoT logs', e);
      }
      return;
    } catch (e) {
      console.warn('On-chain lookup failed; falling back to demo', e);
      setContractStatus('Contract: on-chain lookup failed — using demo', 'warning');
    }
  }

  // show demo product if on-chain not used / failed
  showDemoProduct(lot);
}

function stageToString(n) {
  const map = ['Registered','Vendor','Manufacturer','Logistics','Retail','Sold'];
  return map[n] || 'Unknown';
}

function showDemoProduct(lot) {
  const fallback = {name:'Unknown Product', origin:'Unknown', certifications:'-', stage:'Unknown', iot:[], imageUrl:''};
  const p = DEMO_PRODUCTS[lot] || fallback;
  const imageUrl = p.imageUrl || getProductImage(p.name);
  showProduct({ name: p.name, origin: p.origin, certs: p.certifications, stage: p.stage, imageUrl });
  renderIoTLogs(p.iot.map(x=>({ts:x.ts, temp:x.temp, note:x.note})));
}

function showProduct({name, origin, certs, stage, iotCount, imageUrl}) {
  const productImage = $('productImage');
  if (productImage) {
    productImage.src = imageUrl || DEFAULT_PRODUCT_IMAGE;
    productImage.alt = `${name} photo`;
    productImage.classList.remove('hidden');
  }

  const nameEl = $('productName'); if (nameEl) nameEl.textContent = name || 'Product Name';
  const originEl = $('productOrigin'); if (originEl) originEl.textContent = origin || '-';
  const certsEl = $('productCerts'); if (certsEl) certsEl.textContent = certs || '-';
  const stageEl = $('productStage'); if (stageEl) stageEl.textContent = stage || '-';

  const timeline = $('timeline');
  if (timeline) {
    timeline.innerHTML = '';
    TIMELINE_STAGES.forEach((label) => {
      const node = document.createElement('div');
      node.className = 'timeline-step';
      node.textContent = label;
      timeline.appendChild(node);
    });

    // highlight active stage if possible
    const activeIndex = TIMELINE_STAGES.findIndex(s => s.toLowerCase() === (stage || '').toLowerCase());
    if (activeIndex >= 0 && timeline.children[activeIndex]) {
      timeline.children[activeIndex].classList.add('active');
    }
  }
}

function renderIoTLogs(logs) {
  const list = $('iotLogs');
  if (!list) return;
  list.innerHTML = '';

  if (!Array.isArray(logs) || logs.length === 0) {
    const emptyState = document.createElement('li');
    emptyState.textContent = 'No IoT logs available yet';
    list.appendChild(emptyState);
    return;
  }

  logs.forEach((log) => {
    const li = document.createElement('li');
    const tempLine = document.createElement('div');
    tempLine.className = 'iot-entry-meta';
    tempLine.innerHTML = `<strong>${log.temp}°C</strong> — ${log.note}`;

    const timeLine = document.createElement('div');
    timeLine.className = 'iot-entry-time';
    timeLine.textContent = new Date(log.ts).toLocaleString();

    li.appendChild(tempLine);
    li.appendChild(timeLine);
    list.appendChild(li);
  });
}

function clearProductUI() {
  const imageEl = $('productImage');
  if (imageEl) {
    imageEl.classList.add('hidden');
    imageEl.removeAttribute('src');
  }
  const resetMap = {
    productName: 'Product Name',
    productOrigin: '-',
    productCerts: '-',
    productStage: '-'
  };
  Object.entries(resetMap).forEach(([id, value]) => {
    const el = $(id);
    if (el) el.textContent = value;
  });

  const timeline = $('timeline'); if (timeline) timeline.innerHTML = '';
  const logs = $('iotLogs'); if (logs) logs.innerHTML = '';
}

function generateQR() {
  const input = $('lotInput');
  if (!input) return;
  const lot = input.value.trim();
  if (!lot) return alert('Enter lot number to generate QR');
  const container = $('qrcode'); if (!container) return;
  container.innerHTML = '';
  new QRCode(container, { text: lot, width: 160, height: 160 });
}

// Camera scanning + optional jsQR decode
let scanning = false;
let videoStream = null;
let qrScanInterval = null;

async function startCameraScan() {
  const video = $('qrVideo');
  if (!video) return;
  video.classList.remove('hidden');
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = videoStream; video.play(); scanning = true;

    // If jsQR is available, try to decode frames every 300ms
    if (typeof jsQR === 'function') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      qrScanInterval = setInterval(() => {
        try {
          if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            // found code — set input and lookup
            const lotInput = $('lotInput');
            if (lotInput) lotInput.value = code.data;
            stopCameraScan();
            lookupProduct();
          }
        } catch (e) {
          console.warn('QR decode error', e);
        }
      }, 300);
      // stop automatically after timeout if not found
      setTimeout(()=>{ if (scanning) { stopCameraScan(); alert('Camera scan timed out — please enter lot manually'); } }, CAMERA_TIMEOUT_MS);
    } else {
      // no jsQR available — show camera and tell user to read code visually
      setTimeout(()=>{ stopCameraScan(); alert('Camera scan demo: please type the lot shown on product packaging into the input (or add jsQR to enable automatic decoding)'); }, CAMERA_TIMEOUT_MS);
    }
  } catch (e) {
    alert('Camera unavailable or permission denied');
    console.warn('startCameraScan error', e);
    const video = $('qrVideo'); if (video) video.classList.add('hidden');
  }
}

function stopCameraScan() {
  if (qrScanInterval) { clearInterval(qrScanInterval); qrScanInterval = null; }
  if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
  const video = $('qrVideo'); if (video) video.classList.add('hidden');
  scanning = false;
}

// Simulate IoT log: will attempt on-chain captureIoTData if contract available, otherwise add demo IoT
function simulateIoT() {
  const lotInput = $('lotInput');
  if (!lotInput) return;
  const lot = lotInput.value.trim();
  if (!lot) return alert('Enter lot number first');
  const temp = -15 - Math.floor(Math.random() * 6);
  const note = DEMO_IOT_NOTES[Math.floor(Math.random() * DEMO_IOT_NOTES.length)];

  if (CONTRACT_ADDRESS && contract && accounts && accounts[0] && contractAvailable) {
    // Try to call on-chain captureIoTData (extended ABI). If it fails, fallback to demo.
    try {
      contract.methods.captureIoTData(lot, temp, note).send({ from: accounts[0] })
        .on('transactionHash', h => { alert('IoT log sent: ' + h); })
        .on('error', e => { alert('Tx failed, showing demo log'); console.warn(e); addDemoIoT(lot, temp, note); });
    } catch (e) {
      console.warn('captureIoTData send failed', e);
      addDemoIoT(lot, temp, note);
    }
  } else {
    addDemoIoT(lot, temp, note);
  }
}

// Fixed addDemoIoT (no duplicate keys)
function addDemoIoT(lot, temp, note) {
  if (!DEMO_PRODUCTS[lot]) {
    DEMO_PRODUCTS[lot] = {
      name: lot,
      origin: 'Unknown',
      certifications: '-',
      stage: 'Unknown',
      iot: [],
      imageUrl: DEFAULT_PRODUCT_IMAGE
    };
  }
  DEMO_PRODUCTS[lot].iot.push({ ts: Date.now(), temp: temp, note: note });
  renderIoTLogs(DEMO_PRODUCTS[lot].iot.slice(-10).map(x => ({ ts: x.ts, temp: x.temp, note: x.note })));
}

// Consumer scan — local points awarding only (on-chain consumerScan not included in extended ABI)
function consumerScan() {
  const lotInput = $('lotInput');
  if (!lotInput) return;
  const lot = lotInput.value.trim();
  if (!lot) return alert('Enter lot number');

  // award local session points.
  const basePoints = 10;
  const bonus = awardBadgesIfAny(lot) || 0;
  const increment = basePoints + bonus;

  sessionPoints += increment;
  updateSessionPoints();

  // update leaderboard demo (local) and persist for user; store incremental points
  const name = currentUser ? currentUser.username : 'You';
  const entry = { name, points: increment, badges: bonus ? ['Farm Fresh'] : [] };

  // upsert into in-memory LEADERBOARD
  const existing = LEADERBOARD.find(e => e.name === name);
  if (existing) {
    existing.points = (existing.points || 0) + entry.points;
    existing.badges = Array.from(new Set([...(existing.badges || []), ...(entry.badges || [])]));
  } else {
    LEADERBOARD.push({ name: entry.name, points: entry.points, badges: entry.badges });
  }

  persistLeaderboardEntry(entry);
  renderLeaderboardWith(LEADERBOARD);
}

function updateSessionPoints() { const el = $('sessionPoints'); if (el) el.textContent = sessionPoints; }

function renderLeaderboard() { renderLeaderboardWith(LEADERBOARD); }
function renderLeaderboardWith(list) {
  const container = $('leaderboardList');
  if (!container) return;
  container.innerHTML = '';
  const sorted = (list || []).slice().sort((a,b) => (b.points || 0) - (a.points || 0));
  sorted.slice(0,20).forEach((entry) => {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'lb-row';

    const nameCell = document.createElement('div');
    nameCell.className = 'lb-name';
    nameCell.textContent = entry.name;

    (entry.badges || []).forEach((badge) => {
      const badgeChip = document.createElement('span');
      badgeChip.className = 'lb-badge';
      badgeChip.textContent = badge;
      nameCell.appendChild(badgeChip);
    });

    const pointsCell = document.createElement('div');
    pointsCell.className = 'lb-points';
    pointsCell.textContent = entry.points;

    row.appendChild(nameCell);
    row.appendChild(pointsCell);
    li.appendChild(row);
    container.appendChild(li);
  });
}

// ------------------ Auth & persistence ------------------

// Signup: single write, badges initialized
async function signup(username, password) {
  if (API_BASE_URL) {
    try {
      const resp = await fetch(`${API_BASE_URL}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      if (resp.ok) { const data = await resp.json(); currentUser = { username: data.username, id: data.id }; localStorage.setItem('rpf_user', JSON.stringify(currentUser)); onLoginSuccess(currentUser); return; }
    } catch (e) { console.warn('API signup failed', e); }
  }
  // local fallback
  const store = JSON.parse(localStorage.getItem('rpf_users') || '{}');
  if (store[username]) return alert('User exists');
  store[username] = { password: password, badges: [] };
  localStorage.setItem('rpf_users', JSON.stringify(store));
  currentUser = { username: username, id: username };
  localStorage.setItem('rpf_user', JSON.stringify(currentUser));
  onLoginSuccess(currentUser);
}

// Login: properly set currentUser and persist
async function login(username, password) {
  if (API_BASE_URL) {
    try {
      const resp = await fetch(`${API_BASE_URL}/users?username=${encodeURIComponent(username)}`);
      const arr = await resp.json();
      if (arr.length && arr[0].password === password) { currentUser = { username: arr[0].username, id: arr[0].id }; localStorage.setItem('rpf_user', JSON.stringify(currentUser)); onLoginSuccess(currentUser); return; }
      alert('Invalid credentials'); return;
    } catch (e) { console.warn('API login failed', e); }
  }
  const store = JSON.parse(localStorage.getItem('rpf_users') || '{}');
  if (store[username] && store[username].password === password) {
    currentUser = { username: username, id: username };
    localStorage.setItem('rpf_user', JSON.stringify(currentUser));
    onLoginSuccess(currentUser);
  } else {
    alert('Invalid credentials');
  }
}

function logout() {
  currentUser = null;
  localStorage.removeItem('rpf_user');
  const welcome = $('welcomeUser'); if (welcome) welcome.textContent = 'Guest';
  const logoutBtn = $('logoutBtn'); if (logoutBtn) logoutBtn.classList.add('hidden');
  renderLeaderboardWith(LEADERBOARD);
}

function onLoginSuccess(user) {
  const welcome = $('welcomeUser'); if (welcome) welcome.textContent = user.username;
  const logoutBtn = $('logoutBtn'); if (logoutBtn) logoutBtn.classList.remove('hidden');
  loadUserLeaderboard();
}

function openAuthModal(mode) {
  const modal = $('authModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.dataset.mode = mode;
  const usernameField = $('authUsername'); if (usernameField) usernameField.value = '';
  const passwordField = $('authPassword'); if (passwordField) passwordField.value = '';
  const title = $('authTitle'); if (title) title.textContent = mode === 'signup' ? 'Create account' : 'Login';
}

function closeAuthModal() {
  const modal = $('authModal'); if (!modal) return; modal.classList.add('hidden');
}

// Load leaderboard: merges local persisted entries + in-memory safely (dedupe by name)
async function loadUserLeaderboard() {
  if (API_BASE_URL) {
    try {
      const resp = await fetch(`${API_BASE_URL}/leaderboard`);
      if (resp.ok) { const data = await resp.json(); const merged = [...LEADERBOARD]; data.forEach(it => merged.push({ name: it.name, points: it.points, badges: it.badges || [] })); renderLeaderboardWith(deduplicateLeaderboard(merged)); return; }
    } catch (e) { console.warn('Failed to fetch leaderboard from API', e); }
  }
  const saved = JSON.parse(localStorage.getItem('rpf_leaderboard') || 'null');
  if (saved) {
    const merged = deduplicateLeaderboard([...LEADERBOARD, ...(saved || [])]);
    renderLeaderboardWith(merged);
  } else {
    renderLeaderboardWith(LEADERBOARD);
  }
}

// Persist leaderboard entry: merges by name in localStorage (incremental points)
async function persistLeaderboardEntry(entry) {
  if (API_BASE_URL) {
    try { await fetch(`${API_BASE_URL}/leaderboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }); return; } catch (e) { console.warn('Failed to persist to API', e); }
  }
  const arr = JSON.parse(localStorage.getItem('rpf_leaderboard') || '[]');
  const idx = arr.findIndex(a => a.name === entry.name);
  let userBadges = [];
  try { const users = JSON.parse(localStorage.getItem('rpf_users') || '{}'); if (users[entry.name] && users[entry.name].badges) userBadges = users[entry.name].badges; } catch (e) {}
  if (idx >= 0) {
    arr[idx].points = (arr[idx].points || 0) + (entry.points || 0);
    arr[idx].badges = Array.from(new Set([...(arr[idx].badges || []), ...(entry.badges || []), ...userBadges]));
  } else {
    arr.push({ name: entry.name, points: entry.points || 0, badges: Array.from(new Set([...(entry.badges || []), ...userBadges])) });
  }
  localStorage.setItem('rpf_leaderboard', JSON.stringify(arr));
}

// utility: deduplicate leaderboard array by name (sum points, union badges)
function deduplicateLeaderboard(list) {
  const map = {};
  (list || []).forEach(e => {
    if (!e || !e.name) return;
    if (!map[e.name]) map[e.name] = { name: e.name, points: 0, badges: [] };
    map[e.name].points += (e.points || 0);
    map[e.name].badges = Array.from(new Set([...(map[e.name].badges || []), ...(e.badges || [])]));
  });
  return Object.values(map).sort((a,b) => b.points - a.points);
}

// badges UI
function renderBadges() {
  const wrap = $('badgesList');
  if (!wrap) return;
  wrap.innerHTML = '';
  BADGE_LIBRARY.forEach((badgeLabel) => {
    const chip = document.createElement('div');
    chip.className = 'badge';
    chip.textContent = badgeLabel;
    wrap.appendChild(chip);
  });
}

// award demo badge and return bonus points
function awardBadgesIfAny(lot) {
  if (lot.includes('1001')) {
    const badge = 'Farm Fresh';
    if (currentUser) {
      try {
        const users = JSON.parse(localStorage.getItem('rpf_users') || '{}');
        if (!users[currentUser.username]) users[currentUser.username] = { password: '', badges: [] };
        users[currentUser.username].badges = Array.from(new Set([...(users[currentUser.username].badges || []), badge]));
        localStorage.setItem('rpf_users', JSON.stringify(users));
      } catch (e) { console.warn('Failed to persist badge', e); }
    }
    return 5;
  }
  return 0;
}

window.addEventListener('load', init);

// Optional CSS helper (add active timeline style)
(function injectActiveTimelineStyle(){
  const style = document.createElement('style');
  style.textContent = `
    .timeline-step.active { background: var(--secondary) !important; color: #fff !important; font-weight:600; }
  `;
  document.head.appendChild(style);
})();
