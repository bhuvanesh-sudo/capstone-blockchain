// Frontend logic for Rich Products traceability demo
// - Connects to Web3 if available
// - Uses FoodTraceabilityFull contract ABI if deployed (optional)
// - Provides QR generation and simple camera scanning (fallback)
// - Simulates IoT logs and awards consumer points

const CONTRACT_ADDRESS = ""; // paste deployed contract address here if available
// Optional cloud JSON API base URL (MockAPI, JSONBin, Firebase REST endpoints). If empty, localStorage is used.
const API_BASE_URL = ""; // e.g. https://YOUR_API_BASE_URL

// Auth state (simple demo)
let currentUser = null; // { username, id }

// Two ABIs: one for the simple contract (FoodTraceabilityFull.sol) and one for the more feature-rich contract (FoodTraceability.sol)
const ABI_SIMPLE = [
  {"inputs":[{"internalType":"string","name":"lotStr","type":"string"}],"name":"productExists","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"string","name":"lotStr","type":"string"}],"name":"getProductSummary","outputs":[{"internalType":"bytes32","name":"lot","type":"bytes32"},{"internalType":"string","name":"name","type":"string"},{"internalType":"string","name":"origin","type":"string"},{"internalType":"string","name":"certifications","type":"string"},{"internalType":"uint8","name":"currentStage","type":"uint8"},{"internalType":"uint256","name":"registeredAt","type":"uint256"},{"internalType":"address","name":"registrant","type":"address"},{"internalType":"uint256","name":"iotCount","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"string","name":"lotStr","type":"string"},{"internalType":"int16","name":"temperatureC","type":"int16"},{"internalType":"string","name":"note","type":"string"}],"name":"logIoT","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"string","name":"lotStr","type":"string"}],"name":"consumerScan","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"string","name":"lotStr","type":"string"},{"internalType":"uint256","name":"index","type":"uint256"}],"name":"getIoTRecord","outputs":[{"internalType":"uint256","name":"timestamp","type":"uint256"},{"internalType":"int16","name":"temperatureC","type":"int16"},{"internalType":"string","name":"note","type":"string"}],"stateMutability":"view","type":"function"}
];

const ABI_EXTENDED = [
  {"inputs":[{"internalType":"string","name":"lotNumber","type":"string"}],"name":"consumerLookupByLot","outputs":[{"internalType":"string","name":"name","type":"string"},{"internalType":"string","name":"origin","type":"string"},{"internalType":"string","name":"certifications","type":"string"},{"internalType":"uint8","name":"stage","type":"uint8"},{"internalType":"address","name":"handler","type":"address"},{"internalType":"string","name":"latestQR","type":"string"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"string","name":"lotNumber","type":"string"}],"name":"getIoTLogs","outputs":[{"internalType":"int256[]","name":"temps","type":"int256[]"},{"internalType":"string[]","name":"notes","type":"string[]"},{"internalType":"uint256[]","name":"timestamps","type":"uint256[]"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"string","name":"lotNumber","type":"string"},{"internalType":"int256","name":"temperature","type":"int256"},{"internalType":"string","name":"handlingNotes","type":"string"}],"name":"captureIoTData","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"string","name":"lotNumber","type":"string"}],"name":"generateQRToken","outputs":[{"internalType":"string","name":"token","type":"string"}],"stateMutability":"nonpayable","type":"function"}
];

let web3; let contract = null; let accounts = []; let contractMode = null; // 'simple'|'extended'|null

// Demo data store for when contract is not connected
const DEMO_PRODUCTS = {
  "LOT-1001":{
    name:"Frozen Peas",
    origin:"Green Valley Farms, CA",
    certifications:"Organic, FairTrade",
    stage:"Retail",
    iot:[{ts:Date.now()-3600*1000, temp:-18, note:"Packed"},{ts:Date.now()-1800*1000,temp:-19,note:"In Cold Storage"}]
  },
  "LOT-2002":{
    name:"Mixed Berries",
    origin:"Berry Farms, WA",
    certifications:"Sustainably Grown",
    stage:"Logistics",
    iot:[{ts:Date.now()-7200*1000,temp:-16,note:"Loaded"},{ts:Date.now()-4000*1000,temp:-17,note:"Transit"}]
  }
};

const LEADERBOARD = [
  {name:"Alice", points:120, badges:["Sustainable Product"]},
  {name:"Bob", points:95, badges:["Farm Fresh"]},
  {name:"Carol", points:82, badges:["Cold Chain Champion"]}
];

let sessionPoints = 0;

async function init() {
  // wire UI
  document.getElementById('lookupBtn').onclick = lookupProduct;
  document.getElementById('generateQRBtn').onclick = generateQR;
  document.getElementById('scanQRBtn').onclick = startCameraScan;
  document.getElementById('logIoTBtn').onclick = simulateIoT;
  document.getElementById('scanBtn').onclick = consumerScan;
  document.getElementById('connectBtn').onclick = connectWallet;
  // auth UI
  const loginBtn = document.getElementById('loginBtn'); if(loginBtn) loginBtn.onclick = ()=>openAuthModal('login');
  const signupBtn = document.getElementById('signupBtn'); if(signupBtn) signupBtn.onclick = ()=>openAuthModal('signup');
  const logoutBtn = document.getElementById('logoutBtn'); if(logoutBtn) logoutBtn.onclick = logout;

  // auth modal handlers
  const authModal = document.getElementById('authModal');
  const authForm = document.getElementById('authForm');
  const authTitle = document.getElementById('authTitle');
  const authSubmit = document.getElementById('authSubmit');
  const authCancel = document.getElementById('authCancel');
  if(authCancel) authCancel.onclick = closeAuthModal;
  if(authForm) authForm.addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    if(!username || !password) return alert('Username and password required');
    if(authModal.dataset.mode === 'signup'){
      await signup(username,password);
    } else {
      await login(username,password);
    }
    closeAuthModal();
  });

  // restore saved user
  const saved = localStorage.getItem('rpf_user'); if(saved){ try{ currentUser = JSON.parse(saved); onLoginSuccess(currentUser); }catch(e){} }

  renderLeaderboard();
  renderBadges();

  // try connect to web3
  if (window.ethereum) {
    web3 = new Web3(window.ethereum);
    try{
      accounts = await web3.eth.getAccounts();
      if(accounts.length) onConnected(accounts[0]);

      // Initialize contract only if CONTRACT_ADDRESS is set
      if (CONTRACT_ADDRESS && CONTRACT_ADDRESS.length > 0) {
        // Try the simple ABI first (non-destructive check). If calls fail, try extended ABI.
        const cSimple = new web3.eth.Contract(ABI_SIMPLE, CONTRACT_ADDRESS);
        const cExt = new web3.eth.Contract(ABI_EXTENDED, CONTRACT_ADDRESS);
        // detection: try a read-only call that should be safe; use a demo lot (might revert if not present)
        try {
          await cSimple.methods.productExists('LOT-1001').call();
          contract = cSimple; contractMode = 'simple';
          console.log('Using simple contract ABI');
        } catch (errSimple) {
          try {
            // try extended
            await cExt.methods.consumerLookupByLot('LOT-1001').call();
            contract = cExt; contractMode = 'extended';
            console.log('Using extended contract ABI');
          } catch (errExt) {
            console.warn('Contract at address did not respond to detection calls — falling back to demo mode');
            contract = null; contractMode = null;
          }
        }
      }
    }catch(e){console.log('web3 init',e)}
  }
}

function onConnected(addr){
  document.getElementById('connectBtn').innerText = addr.slice(0,6)+"..."+addr.slice(-4);
}

async function connectWallet(){
  if(!window.ethereum) return alert('Install MetaMask or a Web3 wallet');
  try{
    accounts = await window.ethereum.request({method:'eth_requestAccounts'});
    onConnected(accounts[0]);
  }catch(e){console.error(e)}
}

async function lookupProduct(){
  const lot = document.getElementById('lotInput').value.trim();
  if(!lot) return alert('Enter lot number');

  clearProductUI();

  if(CONTRACT_ADDRESS && contract && web3){
    try{
      const exists = await contract.methods.productExists(lot).call();
      if(!exists){
        alert('Product not found on-chain, showing demo data if available');
        showDemoProduct(lot);return;
      }
      const res = await contract.methods.getProductSummary(lot).call();
      const [lotHex,name,origin,certs,stage,registeredAt,registrant,iotCount] = res;
      showProduct({name,origin,certs,stage:stageToString(stage),iotCount:parseInt(iotCount)});
      // load IoT logs from contract (up to 10)
      const logs = [];
      for(let i=0;i<Math.min(10, parseInt(iotCount)); i++){
        const r = await contract.methods.getIoTRecord(lot,i).call();
        logs.push({ts:parseInt(r[0])*1000,temp:parseInt(r[1]),note:r[2]});
      }
      renderIoTLogs(logs);
    }catch(e){
      console.error(e);showDemoProduct(lot);
    }
  }else{
    showDemoProduct(lot);
  }
}

// Updated lookup supporting extended contract if detected
async function lookupProduct(){
  const lot = document.getElementById('lotInput').value.trim();
  if(!lot) return alert('Enter lot number');

  clearProductUI();

  if(CONTRACT_ADDRESS && contract && web3){
    try{
      if (contractMode === 'extended') {
        // extended contract: consumerLookupByLot + getIoTLogs
        const res = await contract.methods.consumerLookupByLot(lot).call();
        // res: [name, origin, certifications, stage, handler, latestQR]
        const [name, origin, certs, stageNum] = res;
        showProduct({name, origin, certs, stage: stageToString(stageNum)});
        // IoT logs
        const logsRes = await contract.methods.getIoTLogs(lot).call();
        const temps = logsRes[0] || [];
        const notes = logsRes[1] || [];
        const timestamps = logsRes[2] || [];
        const logs = [];
        for (let i=0;i<temps.length;i++) logs.push({ts: parseInt(timestamps[i])*1000, temp: parseInt(temps[i]), note: notes[i]});
        renderIoTLogs(logs);
      } else {
        // simple contract behavior (existing code path)
        const exists = await contract.methods.productExists(lot).call();
        if(!exists){ alert('Product not found on-chain, showing demo data if available'); showDemoProduct(lot); return; }
        const res = await contract.methods.getProductSummary(lot).call();
        const [lotHex,name,origin,certs,stage,registeredAt,registrant,iotCount] = res;
        showProduct({name,origin,certs,stage:stageToString(stage),iotCount:parseInt(iotCount)});
        // load IoT logs from contract (up to 10)
        const logs = [];
        for(let i=0;i<Math.min(10, parseInt(iotCount)); i++){
          const r = await contract.methods.getIoTRecord(lot,i).call();
          logs.push({ts:parseInt(r[0])*1000,temp:parseInt(r[1]),note:r[2]});
        }
        renderIoTLogs(logs);
      }
    }catch(e){ console.error(e); showDemoProduct(lot); }
  }else{
    showDemoProduct(lot);
  }
}

function stageToString(n){
  const map = ['Registered','Vendor','Manufacturer','Logistics','Retail','Sold'];
  return map[n]||'Unknown';
}

function showDemoProduct(lot){
  const p = DEMO_PRODUCTS[lot] || {name:'Unknown Product', origin:'Unknown', certifications:'-', stage:'Unknown', iot:[]};
  showProduct({name:p.name, origin:p.origin, certs:p.certifications, stage:p.stage});
  renderIoTLogs(p.iot.map(x=>({ts:x.ts,temp:x.temp,note:x.note})));
}

function showProduct({name,origin,certs,stage,iotCount}){
  document.getElementById('productName').innerText = name;
  document.getElementById('productOrigin').innerText = origin;
  document.getElementById('productCerts').innerText = certs;
  document.getElementById('productStage').innerText = stage || '-';
  const timeline = document.getElementById('timeline');
  timeline.innerHTML = '';
  const stages = ['Vendor','Manufacturer','Logistics','Retail'];
  stages.forEach(s=>{
    const el = document.createElement('div'); el.innerText = s; el.style.padding='6px 0'; timeline.appendChild(el);
  });
}

function renderIoTLogs(logs){
  const ul = document.getElementById('iotLogs'); ul.innerHTML='';
  if(!logs || logs.length===0){ ul.innerHTML='<li>No IoT logs available</li>'; return; }
  logs.forEach(l=>{
    const li = document.createElement('li');
    const d = new Date(l.ts);
    li.innerHTML = `<div><strong>${l.temp}°C</strong> — ${l.note}</div><div style="font-size:12px;color:#9aa7b2">${d.toLocaleString()}</div>`;
    ul.appendChild(li);
  })
}

function clearProductUI(){
  document.getElementById('productName').innerText='Product Name';
  document.getElementById('productOrigin').innerText='-';
  document.getElementById('productCerts').innerText='-';
  document.getElementById('productStage').innerText='-';
  document.getElementById('iotLogs').innerHTML='';
}

function generateQR(){
  const lot = document.getElementById('lotInput').value.trim();
  if(!lot) return alert('Enter lot number to generate QR');
  const container = document.getElementById('qrcode'); container.innerHTML='';
  new QRCode(container, {text:lot,width:160,height:160});
}

// Basic camera scanning using getUserMedia and canvas -> decode not implemented here; we simulate by reading video frames and trying to use an offscreen library
let scanning = false; let videoStream;
async function startCameraScan(){
  const video = document.getElementById('qrVideo');
  video.classList.remove('hidden');
  try{
    videoStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    video.srcObject = videoStream; video.play(); scanning = true;
    // Very simple polling: let user visually read the code; in demo, stop after 10s
    setTimeout(()=>{ stopCameraScan(); alert('Camera scan demo: please type the lot shown on product packaging into the input'); }, 10000);
  }catch(e){alert('Camera unavailable or permission denied')}
}

function stopCameraScan(){ if(videoStream){ videoStream.getTracks().forEach(t=>t.stop()); } const video=document.getElementById('qrVideo'); video.classList.add('hidden'); scanning=false; }

function simulateIoT(){
  const lot = document.getElementById('lotInput').value.trim(); if(!lot) return alert('Enter lot number first');
  const temp = -15 - Math.floor(Math.random()*6); const note = ['Packed','In Cold Storage','Transit','Delivered'][Math.floor(Math.random()*4)];

  if(CONTRACT_ADDRESS && contract && accounts && accounts[0]){
    if (contractMode === 'extended'){
      // extended contract uses captureIoTData(lot, temperature, notes)
      contract.methods.captureIoTData(lot, temp, note).send({from:accounts[0]})
        .on('transactionHash', h=>{ alert('IoT log sent: '+h); })
        .on('error', e=>{ alert('Tx failed, showing demo log'); addDemoIoT(lot,temp,note); });
    } else {
      contract.methods.logIoT(lot, temp, note).send({from:accounts[0]})
        .on('transactionHash', h=>{ alert('IoT log sent: '+h); })
        .on('error', e=>{ alert('Tx failed, showing demo log'); addDemoIoT(lot,temp,note); });
    }
  }else{
    addDemoIoT(lot,temp,note);
  }
}

function addDemoIoT(lot,temp,note){
  if(!DEMO_PRODUCTS[lot]) DEMO_PRODUCTS[lot]={name:lot,origin:'Unknown',certifications:'-',stage:'Unknown',iot:[]};
  DEMO_PRODUCTS[lot].iot.push({ts:Date.now(),temp,temp,note});
  renderIoTLogs(DEMO_PRODUCTS[lot].iot.slice(-10).map(x=>({ts:x.ts,temp:x.temp,note:x.note})));
}

function consumerScan(){
  const lot = document.getElementById('lotInput').value.trim(); if(!lot) return alert('Enter lot number');
  // award local session points. Simple contract supports on-chain consumerScan, but extended contract does not include consumerScan
  if(CONTRACT_ADDRESS && contract && accounts && accounts[0] && contractMode === 'simple'){
    contract.methods.consumerScan(lot).send({from:accounts[0]})
      .on('transactionHash', h=>{ sessionPoints += 10; updateSessionPoints(); alert('Scan recorded on-chain'); })
      .on('error', e=>{ alert('Tx failed, awarding local points'); sessionPoints+=10; updateSessionPoints(); });
  } else {
    sessionPoints+=10; updateSessionPoints(); awardBadgesIfAny(lot);
  }
  // update leaderboard demo (local) and persist for user if available
  const name = currentUser ? currentUser.username : 'You';
  const entry = {name, points: sessionPoints, badges:[] };
  LEADERBOARD.push(entry);
  persistLeaderboardEntry(entry);
  renderLeaderboardWith(LEADERBOARD);
}

function updateSessionPoints(){ document.getElementById('sessionPoints').innerText = sessionPoints; }

function renderLeaderboard(){
  renderLeaderboardWith(LEADERBOARD);
}

function renderLeaderboardWith(list){
  const ul = document.getElementById('leaderboardList'); ul.innerHTML='';
  const sorted = (list || []).slice().sort((a,b)=> (b.points||0) - (a.points||0));
  sorted.slice(0,20).forEach(p=>{
    const li = document.createElement('li'); li.innerHTML = `<div>${p.name}</div><div>${p.points}</div>`; ul.appendChild(li);
  });
}

// ------------------ Auth & persistence ------------------
function showLogin(){
  openAuthModal('login');
}

function showSignup(){
  openAuthModal('signup');
}

async function signup(username,password){
  if(API_BASE_URL){
    try{
      const resp = await fetch(`${API_BASE_URL}/users`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username,password})});
      if(resp.ok){ const data = await resp.json(); currentUser={username:data.username,id:data.id}; localStorage.setItem('rpf_user', JSON.stringify(currentUser)); onLoginSuccess(currentUser); return; }
    }catch(e){ console.warn('API signup failed', e); }
  }
  // local fallback
  const store = JSON.parse(localStorage.getItem('rpf_users')||'{}');
  if(store[username]) return alert('User exists');
  store[username] = {password}; localStorage.setItem('rpf_users', JSON.stringify(store)); currentUser={username,id:username}; currentUser.id = username; localStorage.setItem('rpf_user', JSON.stringify(currentUser)); onLoginSuccess(currentUser);
}

async function login(username,password){
  if(API_BASE_URL){
    try{
      const resp = await fetch(`${API_BASE_URL}/users?username=${encodeURIComponent(username)}`);
      const arr = await resp.json();
      if(arr.length && arr[0].password === password){ currentUser={username:arr[0].username,id:arr[0].id}; localStorage.setItem('rpf_user', JSON.stringify(currentUser)); onLoginSuccess(currentUser); return; }
      alert('Invalid credentials'); return;
    }catch(e){ console.warn('API login failed', e); }
  }
  const store = JSON.parse(localStorage.getItem('rpf_users')||'{}');
  if(store[username] && store[username].password === password){ currentUser={username,id:username}; currentUser.id = username; localStorage.setItem('rpf_user', JSON.stringify(currentUser)); onLoginSuccess(currentUser);} else { alert('Invalid credentials'); }
}

function logout(){ currentUser=null; localStorage.removeItem('rpf_user'); document.getElementById('welcomeUser').innerText='Guest'; document.getElementById('logoutBtn').classList.add('hidden'); renderLeaderboardWith(LEADERBOARD); }

function onLoginSuccess(user){ document.getElementById('welcomeUser').innerText = user.username; document.getElementById('logoutBtn').classList.remove('hidden'); loadUserLeaderboard(); }

function openAuthModal(mode){
  const modal = document.getElementById('authModal');
  if(!modal) return;
  modal.classList.remove('hidden');
  modal.dataset.mode = mode;
  document.getElementById('authUsername').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authTitle').innerText = mode === 'signup' ? 'Create account' : 'Login';
}

function closeAuthModal(){
  const modal = document.getElementById('authModal'); if(!modal) return; modal.classList.add('hidden');
}

async function loadUserLeaderboard(){
  if(API_BASE_URL){
    try{
      const resp = await fetch(`${API_BASE_URL}/leaderboard`);
      if(resp.ok){ const data = await resp.json(); const merged = [...LEADERBOARD]; data.forEach(it=>merged.push({name:it.name, points:it.points, badges:it.badges||[]})); renderLeaderboardWith(merged); return; }
    }catch(e){ console.warn('Failed to fetch leaderboard from API', e); }
  }
  const saved = JSON.parse(localStorage.getItem('rpf_leaderboard')||'null');
  if(saved){ renderLeaderboardWith(saved); } else { renderLeaderboardWith(LEADERBOARD); }
}

async function persistLeaderboardEntry(entry){
  if(API_BASE_URL){
    try{ await fetch(`${API_BASE_URL}/leaderboard`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(entry)}); return; }catch(e){ console.warn('Failed to persist to API', e); }
  }
  const arr = JSON.parse(localStorage.getItem('rpf_leaderboard')||'[]'); arr.push(entry); localStorage.setItem('rpf_leaderboard', JSON.stringify(arr));
}

function renderBadges(){
  const badges = ['Sustainable Product','Farm Fresh','Cold Chain Champion'];
  const wrap = document.getElementById('badgesList'); wrap.innerHTML='';
  badges.forEach(b=>{ const d = document.createElement('div'); d.className='badge'; d.innerText=b; wrap.appendChild(d); });
}

function awardBadgesIfAny(lot){
  // Simple demo: award 'Farm Fresh' if lot contains '1001'
  if(lot.includes('1001')){
    sessionPoints += 5; updateSessionPoints(); alert('Badge awarded: Farm Fresh (+5 pts)');
  }
}

window.addEventListener('load', init);
