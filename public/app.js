// ── State ──────────────────────────────────────────────────────
let conversationHistory = [];
let sessionStats = { trips: 0, ev: 0, onstar: 0, tokens: 0 };
let interactionLog = [];
let currentRating = null;
let activityCount = 0;

// ── Map ────────────────────────────────────────────────────────
let navMap = null;
let activeRouteLayer = null;
let vehicleMarker = null;

// Preset routes (lat/lng polylines for demo scenarios)
const ROUTES = {
  milwaukee: {
    label: 'Chicago → Milwaukee  ⚡ Charging stop: Gurnee, IL',
    coords: [
      [41.878, -87.630], [41.920, -87.660], [41.980, -87.720],
      [42.070, -87.790], [42.165, -87.840], // Gurnee area (charging stop)
      [42.250, -87.860], [42.400, -87.890], [42.600, -87.910],
      [42.800, -87.930], [43.038, -87.907]
    ],
    chargeStop: [42.165, -87.840],
    center: [42.45, -87.78], zoom: 9
  },
  ohare: {
    label: 'Chicago → O\'Hare Airport',
    coords: [
      [41.878, -87.630], [41.900, -87.680], [41.930, -87.730],
      [41.960, -87.790], [41.975, -87.850], [41.978, -87.905]
    ],
    center: [41.928, -87.77], zoom: 11
  },
  school_groceries: {
    label: 'Home → Lincoln Elementary → Jewel-Osco → Home',
    coords: [
      [41.878, -87.630], [41.895, -87.645], [41.910, -87.655],
      [41.900, -87.670], [41.885, -87.660], [41.878, -87.630]
    ],
    center: [41.895, -87.650], zoom: 13
  },
  local: {
    label: 'Chicago, IL · Blazer EV ready',
    coords: null,
    center: [41.878, -87.630], zoom: 12
  }
};

function initMap() {
  navMap = L.map('nav-map', {
    zoomControl: true,
    attributionControl: false,
    dragging: true,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    keyboard: false
  }).setView([41.878, -87.630], 11);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18
  }).addTo(navMap);

  // Vehicle marker (Jordan's Blazer EV)
  const vehicleIcon = L.divIcon({
    html: `<div style="width:14px;height:14px;background:#4da6ff;border:2px solid white;border-radius:50%;box-shadow:0 0 8px #4da6ff88;"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    className: ''
  });
  vehicleMarker = L.marker([41.878, -87.630], { icon: vehicleIcon }).addTo(navMap);
}

function drawRoute(routeKey) {
  const route = ROUTES[routeKey] || ROUTES.local;

  // Remove old route
  if (activeRouteLayer) {
    navMap.removeLayer(activeRouteLayer);
    activeRouteLayer = null;
  }

  if (route.coords) {
    navMap.fitBounds(L.latLngBounds(route.coords), { padding: [24, 24], animate: true, duration: 0.8 });
  } else {
    navMap.setView(route.center, route.zoom, { animate: true, duration: 0.8 });
  }

  // Update overlay label
  const labelEl = document.getElementById('map-route-label');
  const overlayText = document.querySelector('.map-overlay-text');
  labelEl.textContent = route.label;
  labelEl.style.display = 'inline';
  overlayText.textContent = '';

  if (!route.coords) return;

  // Draw route line
  activeRouteLayer = L.layerGroup().addTo(navMap);

  // Shadow line
  L.polyline(route.coords, { color: '#000', weight: 6, opacity: 0.3 }).addTo(activeRouteLayer);
  // Main route line
  L.polyline(route.coords, { color: '#4da6ff', weight: 3, opacity: 0.9 }).addTo(activeRouteLayer);

  // Destination marker
  const destCoord = route.coords[route.coords.length - 1];
  const destIcon = L.divIcon({
    html: `<div style="width:12px;height:12px;background:#00c853;border:2px solid white;border-radius:50%;box-shadow:0 0 6px #00c85388;"></div>`,
    iconSize: [12, 12], iconAnchor: [6, 6], className: ''
  });
  L.marker(destCoord, { icon: destIcon }).addTo(activeRouteLayer);

  // Charging stop marker
  if (route.chargeStop) {
    const chargeIcon = L.divIcon({
      html: `<div style="width:14px;height:14px;background:#ffab00;border:2px solid white;border-radius:3px;box-shadow:0 0 6px #ffab0088;display:flex;align-items:center;justify-content:center;font-size:8px;">⚡</div>`,
      iconSize: [14, 14], iconAnchor: [7, 7], className: ''
    });
    L.marker(route.chargeStop, { icon: chargeIcon }).addTo(activeRouteLayer);
  }
}

function detectRouteFromMessage(msg, action) {
  const lower = msg.toLowerCase();
  if (lower.includes('milwaukee')) return 'milwaukee';
  if (lower.includes('o\'hare') || lower.includes('ohare') || lower.includes('airport') || lower.includes('coffee')) return 'ohare';
  if (lower.includes('school') || lower.includes('groceries') || lower.includes('kids')) return 'school_groceries';
  if (action === 'route_planned' || action === 'charging_optimized' || action === 'multi_stop_optimized') return 'local';
  return null;
}


// ── Tooltips (JS-based, appended to body) ──────────────────────
function initTooltips() {
  document.querySelectorAll('[data-tooltip]').forEach(el => {
    // Avoid duplicate listeners
    el.removeEventListener('mouseenter', showTooltip);
    el.removeEventListener('mouseleave', hideTooltip);
    el.addEventListener('mouseenter', showTooltip);
    el.addEventListener('mouseleave', hideTooltip);
    el.addEventListener('touchstart', showTooltip, { passive: true });
    el.addEventListener('touchend', hideTooltip);
  });
}

function showTooltip(e) {
  hideTooltip();
  const text = this.dataset.tooltip;
  if (!text) return;

  const tip = document.createElement('div');
  tip.id = 'global-tooltip';
  tip.className = 'global-tooltip';
  tip.textContent = text;
  document.body.appendChild(tip);

  const rect = this.getBoundingClientRect();
  const tipW = 230;
  let left = rect.right + 12;
  let top  = rect.top + rect.height / 2;

  // Flip left if off-screen right
  if (left + tipW > window.innerWidth - 8) {
    left = rect.left - tipW - 12;
  }
  // Clamp top
  const tipH = tip.offsetHeight || 80;
  if (top - tipH / 2 < 8) top = tipH / 2 + 8;
  if (top + tipH / 2 > window.innerHeight - 8) top = window.innerHeight - tipH / 2 - 8;

  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top  = top + 'px';
}

function hideTooltip() {
  const tip = document.getElementById('global-tooltip');
  if (tip) tip.remove();
}

// ── Mobile sidebar ─────────────────────────────────────────────
function toggleSidebar() {
  const sidebar  = document.querySelector('.sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const isOpen   = sidebar.classList.contains('open');
  sidebar.classList.toggle('open', !isOpen);
  overlay.classList.toggle('active', !isOpen);
}

function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}

// ── Mobile tab switching ───────────────────────────────────────
let activeTab = 'chat';

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');

  const mapStrip    = document.querySelector('.map-strip');
  const chatMain    = document.querySelector('.chat-main');
  const activityPanel = document.querySelector('.activity-panel');

  // Reset
  mapStrip.classList.remove('tab-hidden', 'map-full');
  activityPanel.classList.remove('mobile-open');

  if (tab === 'chat') {
    chatMain.style.display = 'flex';
    // map strip visible in chat tab (navigation app — always show map)
    if (navMap) setTimeout(() => navMap.invalidateSize(), 200);
  } else if (tab === 'map') {
    chatMain.style.display = 'flex';
    mapStrip.classList.add('map-full');
    if (navMap) setTimeout(() => navMap.invalidateSize(), 200);
  } else if (tab === 'info') {
    chatMain.style.display = 'flex';
    mapStrip.classList.add('tab-hidden');
    activityPanel.classList.add('mobile-open');
  }

  closeSidebar();
}

// ── DOM refs ───────────────────────────────────────────────────
const messagesEl  = document.getElementById('messages');
const typingEl    = document.getElementById('typing');
const inputEl     = document.getElementById('userInput');
const sendBtn     = document.getElementById('sendBtn');
const logTbody    = document.getElementById('log-tbody');
const activityFeed = document.getElementById('activity-feed');
const actionCard  = document.getElementById('action-card');

// ── Send ───────────────────────────────────────────────────────
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  // Remove welcome screen
  const welcome = messagesEl.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  inputEl.value = '';
  inputEl.style.height = 'auto';
  sendBtn.disabled = true;

  appendMessage('user', text);
  conversationHistory.push({ role: 'user', content: text });

  typingEl.style.display = 'flex';
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Trigger backend activity simulation
  triggerBackendActivity(text);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory })
    });

    const data = await res.json();
    typingEl.style.display = 'none';

    if (!res.ok || data.error) {
      appendMessage('assistant', `Navigation AI error: ${data.error || 'Unexpected response.'}`);
      sendBtn.disabled = false;
      return;
    }

    conversationHistory.push({ role: 'assistant', content: data.reply });
    appendMessage('assistant', data.reply, data);

    // Update stats, log, map
    updateStats(data);
    addToLog(data);
    updateActionCard(data);

    // Draw route on map if applicable
    const routeKey = detectRouteFromMessage(text, data.action);
    if (routeKey && navMap) drawRoute(routeKey);

  } catch (err) {
    typingEl.style.display = 'none';
    appendMessage('assistant', 'Connection error. Please check the server and try again.');
  }

  sendBtn.disabled = false;
}

function sendQuick(text) {
  inputEl.value = text;
  sendMessage();
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── Append message ─────────────────────────────────────────────
function appendMessage(role, text, data) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const avatarLabel = role === 'user' ? 'JK' : '⬡';
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  div.innerHTML = `
    <div class="msg-avatar">${role === 'user' ? 'JK' : '⬡'}</div>
    <div class="msg-content">
      <div class="msg-bubble">${escapeHtml(text)}</div>
      <div class="msg-time">${timeStr}</div>
    </div>`;

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Backend activity simulation ────────────────────────────────
function triggerBackendActivity(msg) {
  const lower = msg.toLowerCase();
  clearOldActivities();

  const base = [
    { icon: '🧠', label: 'NLU: Intent classified', detail: 'Extracting destination, constraints, and context', delay: 100 },
    { icon: '📡', label: 'OnStar: Vehicle state fetched', detail: 'Battery 73% · 212 mi range · Climate 70°F', delay: 280 },
  ];

  let contextual = [];

  if (lower.includes('milwaukee') || lower.includes('route') || lower.includes('navigate') || lower.includes('trip') || lower.includes('o\'hare') || lower.includes('ohare')) {
    contextual = [
      { icon: '🗺️', label: 'RAG: Road network loaded', detail: 'I-94 corridor · real-time traffic overlay', delay: 480 },
      { icon: '⚡', label: 'EV: Charging database queried', detail: 'Electrify America & ChargePoint along route', delay: 680 },
      { icon: '🔋', label: 'EV: Battery optimizer invoked', detail: 'Calculating arrival SoC vs. minimum threshold', delay: 880 },
      { icon: '📍', label: 'Route engine: Optimal path computed', detail: 'Charging stop sequenced into route', delay: 1080 },
    ];
  } else if (lower.includes('battery') || lower.includes('charge') || lower.includes('range') || lower.includes('low')) {
    contextual = [
      { icon: '🔋', label: 'EV: Real-time range model queried', detail: 'Factoring speed, climate, terrain, battery health', delay: 480 },
      { icon: '🗺️', label: 'Charging: Nearby stations scanned', detail: 'Electrify America · 3 stations within 5 miles', delay: 680 },
      { icon: '⏱️', label: 'EV: Session time estimate calculated', detail: 'Optimal stop: 18 min to reach 80%', delay: 880 },
    ];
  } else if (lower.includes('school') || lower.includes('groceries') || lower.includes('multi') || lower.includes('stop') || lower.includes('coffee') || lower.includes('pickup')) {
    contextual = [
      { icon: '📍', label: 'Multi-stop: Waypoints extracted', detail: 'Parsing all destinations and time constraints', delay: 480 },
      { icon: '🔄', label: 'Route: Stop sequence optimizer', detail: 'TSP solver: evaluating 6 orderings', delay: 680 },
      { icon: '🔋', label: 'EV: Range check across full route', detail: 'Verifying battery sufficient for all legs', delay: 880 },
      { icon: '🗺️', label: 'Route: Final itinerary compiled', detail: 'ETA, time per leg, and charging risk assessed', delay: 1080 },
    ];
  } else if (lower.includes('noise') || lower.includes('wrong') || lower.includes('hit') || lower.includes('accident') || lower.includes('pull') || lower.includes('incident') || lower.includes('safety')) {
    contextual = [
      { icon: '🚨', label: 'Safety: OnStar protocol engaged', detail: 'Checking if emergency dispatch required', delay: 200 },
      { icon: '🔧', label: 'Diagnostics: Vehicle telemetry pulled', detail: 'Tire pressure, suspension, alignment sensors', delay: 480 },
      { icon: '📍', label: 'Safety: Nearest safe stop identified', detail: 'Routing to closest service center or pull-off', delay: 680 },
      { icon: '📋', label: 'Incident: Case record created', detail: 'OnStar ID: OST-2024-JK9871 · timestamp logged', delay: 880 },
    ];
  } else if (lower.includes('weather') || lower.includes('cold') || lower.includes('heat') || lower.includes('climate') || lower.includes('snow') || lower.includes('rain')) {
    contextual = [
      { icon: '🌡️', label: 'Weather: Real-time conditions fetched', detail: 'Current temp, forecast, road conditions', delay: 480 },
      { icon: '🔋', label: 'EV: Climate impact model applied', detail: 'Cold weather range reduction: 10–25%', delay: 680 },
      { icon: '📊', label: 'EV: Adjusted range recalculated', detail: 'New estimate factors HVAC and battery temp', delay: 880 },
    ];
  } else if (lower.includes('super cruise') || lower.includes('supercruise') || lower.includes('hands free') || lower.includes('hands-free') || lower.includes('hd map')) {
    contextual = [
      { icon: '🗺️', label: 'HERE HD Live Map: Corridor data queried', detail: 'Lane-level map coverage along I-94 corridor', delay: 480 },
      { icon: '🛣️', label: 'Super Cruise: Eligible segments identified', detail: 'Scanning route for HD map–verified highway miles', delay: 680 },
      { icon: '📍', label: 'Transition points: Manual control zones flagged', detail: 'Interchanges, exits, and coverage gaps mapped', delay: 880 },
      { icon: '✅', label: 'Super Cruise summary: Route annotated', detail: 'Miles eligible, transitions, and handoff points', delay: 1080 },
    ];
  } else if (lower.includes('mychevrolet') || lower.includes('my chevrolet') || lower.includes('app') || lower.includes('planned') || lower.includes('pull that up') || lower.includes('load')) {
    contextual = [
      { icon: '📱', label: 'myChevrolet: Pre-planned trip retrieved', detail: 'Syncing trip context from app session', delay: 480 },
      { icon: '🔋', label: 'EV: Battery check against pre-planned route', detail: 'Validating range is sufficient since trip was planned', delay: 680 },
      { icon: '🌡️', label: 'Pre-conditioning: Status verified', detail: 'Cabin temperature and charging state confirmed', delay: 880 },
      { icon: '📍', label: 'Route: Loaded and ready to activate', detail: 'App trip transferred to in-vehicle navigation', delay: 1080 },
    ];
  } else {
    contextual = [
      { icon: '📚', label: 'RAG: Vehicle knowledge base queried', detail: 'Blazer EV specs, policies, and preferences', delay: 480 },
      { icon: '🔍', label: 'Context: Conversation history reviewed', detail: 'Maintaining trip continuity', delay: 680 },
    ];
  }

  const activities = [...base, ...contextual];
  activities.push({ icon: '✅', label: 'Response: Synthesizing reply', detail: 'Structuring for voice-first delivery', delay: activities[activities.length - 1].delay + 200 });

  activities.forEach(act => {
    setTimeout(() => {
      addActivityEvent(act);
    }, act.delay);
  });
}

function addActivityEvent(act) {
  // Remove empty placeholder
  const empty = activityFeed.querySelector('.activity-empty');
  if (empty) empty.remove();

  activityCount++;
  const countEl = document.getElementById('activity-count');
  countEl.style.display = 'inline-block';
  countEl.textContent = activityCount;

  const el = document.createElement('div');
  el.className = 'backend-event';
  el.innerHTML = `
    <div class="backend-event-icon">${act.icon}</div>
    <div class="backend-event-body">
      <div class="backend-event-label">${act.label}</div>
      <div class="backend-event-detail">${act.detail}</div>
      <div class="backend-event-status running">Processing...</div>
    </div>`;

  activityFeed.appendChild(el);
  activityFeed.scrollTop = activityFeed.scrollHeight;

  // Animate in
  setTimeout(() => el.classList.add('visible'), 20);

  // Mark done
  setTimeout(() => {
    const statusEl = el.querySelector('.backend-event-status');
    if (statusEl) {
      statusEl.textContent = 'Done';
      statusEl.className = 'backend-event-status done';
    }
  }, 400);
}

function clearOldActivities() {
  activityFeed.innerHTML = '';
  activityCount = 0;
  const countEl = document.getElementById('activity-count');
  if (countEl) { countEl.style.display = 'none'; countEl.textContent = '0'; }
}

// ── Update action card ─────────────────────────────────────────
function updateActionCard(data) {
  const action = data.action || 'info_response';
  const routeType = data.route_type || 'null';
  const conf = data.confidence || '—';
  const onstar = data.onstar_triggered ? 'Yes' : 'No';
  const emotion = data.driver_emotion || '—';

  const confClass = conf === 'high' ? 'green' : conf === 'medium' ? 'amber' : 'red';
  const onstarClass = data.onstar_triggered ? 'amber' : '';

  actionCard.className = 'action-card';
  actionCard.innerHTML = `
    <div class="action-card-row">
      <span class="action-card-key">Action</span>
      <span class="action-badge ${action}" style="font-size:10px">${action.replace(/_/g,' ')}</span>
    </div>
    <div class="action-card-row">
      <span class="action-card-key">Route Type</span>
      <span class="action-card-val">${routeType}</span>
    </div>
    <div class="action-card-row">
      <span class="action-card-key">Confidence</span>
      <span class="action-card-val ${confClass}">${conf}</span>
    </div>
    <div class="action-card-row">
      <span class="action-card-key">OnStar</span>
      <span class="action-card-val ${onstarClass}">${onstar}</span>
    </div>
    <div class="action-card-row">
      <span class="action-card-key">Driver Mood</span>
      <span class="action-card-val">${emotion}</span>
    </div>`;
}

// ── Stats ──────────────────────────────────────────────────────
function updateStats(data) {
  sessionStats.trips++;
  if (data.action === 'charging_optimized' || data.route_type === 'ev_optimized' || data.action === 'mobile_app_handoff') sessionStats.ev++;
  if (data.onstar_triggered || data.action === 'safety_alert') sessionStats.onstar++;
  sessionStats.tokens += data.token_estimate || Math.round((data.reply || '').length * 1.3);

  document.getElementById('stat-trips').textContent   = sessionStats.trips;
  document.getElementById('stat-ev').textContent      = sessionStats.ev;
  document.getElementById('stat-onstar').textContent  = sessionStats.onstar;
  document.getElementById('stat-tokens').textContent  = sessionStats.tokens;
}

// ── Interaction log ────────────────────────────────────────────
function addToLog(data) {
  interactionLog.push(data);
  const n = interactionLog.length;

  const action  = (data.action || 'info_response').replace(/_/g,' ');
  const route   = data.route_type || '—';
  const conf    = data.confidence || '—';
  const confClass = conf === 'high' ? 'conf-high' : conf === 'medium' ? 'conf-medium' : 'conf-low';

  if (logTbody.querySelector('.log-empty')) logTbody.innerHTML = '';

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${n}</td>
    <td>${action}</td>
    <td>${route}</td>
    <td class="${confClass}">${conf}</td>`;
  logTbody.appendChild(tr);
}

// ── Reset ──────────────────────────────────────────────────────
function resetChat() {
  conversationHistory = [];
  sessionStats = { trips: 0, ev: 0, onstar: 0, tokens: 0 };
  interactionLog = [];
  activityCount = 0;

  // Reset map
  if (navMap) {
    if (activeRouteLayer) { navMap.removeLayer(activeRouteLayer); activeRouteLayer = null; }
    navMap.setView([41.878, -87.630], 12, { animate: true });
    document.getElementById('map-route-label').style.display = 'none';
    document.querySelector('.map-overlay-text').textContent = 'Chicago, IL · Blazer EV ready';
  }

  messagesEl.innerHTML = `
    <div class="welcome-msg">
      <div class="welcome-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4da6ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="3 11 22 2 13 21 11 13 3 11"/>
        </svg>
      </div>
      <div class="welcome-title">Ready to navigate, Jordan.</div>
      <div class="welcome-sub">Your Blazer EV is at 73% — 212 miles range. Ask me anything, or try a scenario on the left.</div>
    </div>`;

  activityFeed.innerHTML = '<div class="activity-empty">Steps will appear here when you send a message</div>';
  document.getElementById('activity-count').style.display = 'none';
  actionCard.className = 'action-card action-empty';
  actionCard.innerHTML = '<div class="action-empty-text">Awaiting first request</div>';

  logTbody.innerHTML = '<tr><td colspan="4" class="log-empty">No interactions yet</td></tr>';

  document.getElementById('stat-trips').textContent   = '0';
  document.getElementById('stat-ev').textContent      = '0';
  document.getElementById('stat-onstar').textContent  = '0';
  document.getElementById('stat-tokens').textContent  = '0';
}

// ── Modals ─────────────────────────────────────────────────────
function openGuide()    { document.getElementById('guideModal').classList.add('open'); }
function openFeedback() { document.getElementById('feedbackModal').classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

let currentRatingVal = 0;
function setRating(val) {
  currentRatingVal = val;
  document.querySelectorAll('.star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= val);
  });
}

async function submitFeedback() {
  const text = document.getElementById('feedbackText').value.trim();
  if (!text) return;
  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: text, rating: currentRatingVal || null, conversation: conversationHistory.length })
    });
    document.getElementById('feedbackSuccess').style.display = 'block';
    setTimeout(() => closeModal('feedbackModal'), 1500);
  } catch (e) {
    console.error('Feedback error:', e);
  }
}

// ── Voice Input ────────────────────────────────────────────────
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

function initVoice() {
  if (!SpeechRecognition) return; // not supported

  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = false; // must be false for iOS Safari
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    const btn = document.querySelector('.voice-icon');
    btn.classList.add('listening');
    inputEl.placeholder = 'Listening...';
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    inputEl.value = transcript;
    autoResize(inputEl);
  };

  recognition.onend = () => {
    isListening = false;
    const btn = document.querySelector('.voice-icon');
    btn.classList.remove('listening');
    inputEl.placeholder = 'Where to, Jordan?';
    if (inputEl.value.trim()) sendMessage();
  };

  recognition.onerror = (e) => {
    isListening = false;
    document.querySelector('.voice-icon').classList.remove('listening');
    inputEl.placeholder = 'Where to, Jordan?';
    if (e.error === 'not-allowed') {
      alert('Microphone access denied. Please allow microphone access in your browser settings.');
    } else if (e.error !== 'no-speech') {
      console.warn('Speech error:', e.error);
    }
  };
}

function toggleVoice() {
  if (!SpeechRecognition) {
    alert('Voice input is not supported in this browser. Try Chrome or Safari.');
    return;
  }
  if (isListening) {
    recognition.stop();
    return;
  }
  try {
    recognition.start();
  } catch (e) {
    // iOS sometimes throws if recognition is already running
    recognition.stop();
    setTimeout(() => { try { recognition.start(); } catch(e2) {} }, 300);
  }
}

window.addEventListener('load', () => {
  setTimeout(initMap, 100);
  initTooltips();
  initVoice();
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
