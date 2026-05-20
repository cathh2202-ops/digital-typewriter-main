// ============================================================
// CONFIGURATION — fill these in before opening index.html
// ============================================================
const CONFIG = {
  // 1. Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web)
  //    Add http://localhost:PORT and your live URL to "Authorised JavaScript origins"
  GOOGLE_CLIENT_ID: '372466667296-aqnhhvh35ftg5o0o3jirbdui5g3bsrmv.apps.googleusercontent.com',

  // 2. Google Cloud Console → APIs & Services → Credentials → Create API Key
  //    Restrict it to "Google Calendar API"
  GOOGLE_API_KEY: 'AIzaSyBKnjkGHHuFN0h5eIemaXu2qYk6zVYyEMU',

  // 3. Your Cloudflare Worker URL (after deploying notion-worker.js)
  //    e.g. 'https://notion-proxy.yourname.workers.dev'
  NOTION_WORKER_URL: 'https://digital-typewriter-main.cathh2202.workers.dev',

  // 4. Your Notion database ID — the long hex string in the URL when you open the DB view
  //    e.g. notion.so/yourname/DATABASE_ID?v=...
  //    For a plain page with to-do checkboxes, use the PAGE ID instead and set IS_DATABASE = false
  NOTION_DATABASE_ID: '2c2e88308912806b9e30e9846a93fd78',

  // Set to false if your Notion page uses inline to-do blocks (not a full Database)
  IS_DATABASE: true,
};
// ============================================================

const stage = document.getElementById('stage');
const receipt = document.getElementById('receipt');
const printBtn = document.getElementById('printBtn');
const printerText = document.querySelector('.printer-text');
const receiptDate = document.getElementById('receiptDate');

const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

// --- Receipt date stamp ---
const today = new Date();
function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

receiptDate.textContent = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
const todayKey = formatDateKey(today);

// ============================================================
// GOOGLE CALENDAR INTEGRATION
// ============================================================

function loadGoogleAPI() {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

function loadGoogleIdentity() {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = resolve;
    document.head.appendChild(script);
  });
}
async function initGoogleCalendar() {
  console.log('1. Loading Google API...');
  await Promise.all([loadGoogleAPI(), loadGoogleIdentity()]);
  console.log('2. Google API loaded');

  await new Promise((resolve) => gapi.load('client', resolve));
  console.log('3. gapi client loaded');

  await gapi.client.init({
    apiKey: CONFIG.GOOGLE_API_KEY,
    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
  });
  console.log('4. gapi client initialized');

  const savedToken = sessionStorage.getItem('gcal_token');
  console.log('5. Saved token:', savedToken ? 'found' : 'not found');
  
  if (savedToken) {
    gapi.client.setToken(JSON.parse(savedToken));
    return fetchTodayEvents();
  }

  return new Promise((resolve) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      callback: (tokenResponse) => {
        console.log('6. Token response:', tokenResponse);
        if (tokenResponse.error) { resolve([]); return; }
        sessionStorage.setItem('gcal_token', JSON.stringify(gapi.client.getToken()));
        fetchTodayEvents().then(resolve);
      },
    });

    console.log('7. Requesting access token...');
    showCalendarSignInPrompt(() => tokenClient.requestAccessToken({ prompt: '' }));
    resolve([]);
  });
}

function showCalendarSignInPrompt(onClick) {
  const eventsUl = document.querySelector('.events');
  const existing = eventsUl.querySelectorAll('li');
  if (existing.length) return; // already has hardcoded events, skip nudge

  const li = document.createElement('li');
  li.innerHTML = `<span class="event-icon event-personal"></span>
    <span class="label" style="color:#EC6E9E;cursor:pointer;text-decoration:underline" id="gcal-signin">
      sign in to load today's events
    </span>`;
  eventsUl.appendChild(li);
  document.getElementById('gcal-signin').addEventListener('click', onClick);
}

async function fetchTodayEvents() {
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const response = await gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (response.result.items || []).map((ev) => ({
      title: ev.summary || '(no title)',
      start: ev.start?.dateTime ? formatTime(ev.start.dateTime) : 'all day',
      end: ev.end?.dateTime ? formatTime(ev.end.dateTime) : '',
      link: ev.hangoutLink || ev.htmlLink || null,
      type: detectEventType(ev),
    }));
  } catch (err) {
    console.warn('Google Calendar fetch failed:', err);
    return [];
  }
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function detectEventType(ev) {
  const title = (ev.summary || '').toLowerCase();
  const workKeywords = ['standup', 'sync', 'meeting', 'review', 'sprint', 'planning', 'retro', '1:1', 'demo', 'work'];
  return workKeywords.some((k) => title.includes(k)) ? 'work' : 'personal';
}

function renderEvents(events) {
  const eventsUl = document.querySelector('.events');
  eventsUl.innerHTML = ''; // clear hardcoded placeholder HTML

  if (!events.length) {
    eventsUl.innerHTML = '<li><span class="label" style="opacity:0.5">nothing scheduled today ✧</span></li>';
    return;
  }

  events.forEach((ev) => {
    const li = document.createElement('li');
    const timeStr = ev.end ? `${ev.start}–${ev.end}` : ev.start;
    li.innerHTML = `
      <span class="event-icon event-${ev.type}">${ev.type}</span>
      <span class="label">${ev.title}</span>
      <span class="time">${timeStr}</span>
      ${ev.link ? `<a href="${ev.link}" target="_blank" rel="noopener">link</a>` : ''}
    `;
    eventsUl.appendChild(li);
  });

  // Re-run the printer idle frame count with the actual event count
  updatePrinterReaction(events.length);
}

// ============================================================
// NOTION INTEGRATION
// ============================================================

function getNotionIds() {
  return Array.isArray(CONFIG.NOTION_DATABASE_ID)
    ? CONFIG.NOTION_DATABASE_ID
    : [CONFIG.NOTION_DATABASE_ID];
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();

  if (!res.ok) {
    console.warn('Notion request failed:', res.status, url, data);
    return null;
  }

  return data;
}

async function fetchNotionTodos() {
  try {
    const workerBase = CONFIG.NOTION_WORKER_URL.replace(/\/+$/, '');
    const dateStr = todayKey; // "2026-05-18"

    // Step 1: find today's page
    const res = await fetch(
      `${workerBase}/notion/query?database_id=${CONFIG.NOTION_DATABASE_ID}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: {
            property: 'Date',
            date: { equals: dateStr },
          },
        }),
      }
    );
    const data = await res.json();
    if (!data.results || !data.results.length) {
      console.warn('No Notion page found for today:', dateStr);
      return [];
    }

    // Step 2: get the page ID and fetch its blocks
    const pageId = data.results[0].id;
    const blocksRes = await fetch(
      `${workerBase}/notion/page?page_id=${pageId}`
    );
    const blocksData = await blocksRes.json();
    return parseNotionPageTodos(blocksData);

  } catch (err) {
    console.warn('Notion fetch failed:', err);
    return [];
  }
}

function parseNotionPageTodos(data) {
  if (!data.results) return [];
  return data.results
    .filter((block) => block.type === 'to_do' && !block.to_do?.checked)
    .map((block) => {
      const title = block.to_do?.rich_text?.[0]?.plain_text || 'Untitled';
      return { id: block.id, title, type: 'personal' };
    });
}
function parseNotionDatabaseTodos(data) {
  if (!data.results) return [];
  return data.results.map((page) => {
    // Adjust property names below to match YOUR database columns
    const titleProp = page.properties?.Name || page.properties?.Title;
    const typeProp = page.properties?.Type || page.properties?.Category;

    const title = titleProp?.title?.[0]?.plain_text || 'Untitled';
    const rawType = typeProp?.select?.name || typeProp?.multi_select?.[0]?.name || '';
    const type = rawType.toLowerCase().includes('work') ? 'work' : 'personal';

    return { id: page.id, title, type };
  });
}

const TODO_STORAGE_KEY = `digital-typewriter:done-todos:${todayKey}`;

function getStoredDoneTodos() {
  try {
    return new Set(JSON.parse(localStorage.getItem(TODO_STORAGE_KEY)) || []);
  } catch (err) {
    console.warn('Could not read saved todos:', err);
    return new Set();
  }
}

function saveStoredDoneTodos(doneTodos) {
  try {
    localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify([...doneTodos]));
  } catch (err) {
    console.warn('Could not save todos:', err);
  }
}

function getTodoStorageId(todo) {
  return todo.id || `${todo.type}:${todo.title}`.toLowerCase();
}

function renderTodos(todos) {
  const todosUl = document.querySelector('.todos');
  todosUl.innerHTML = ''; // clear hardcoded placeholder HTML
  const doneTodos = getStoredDoneTodos();

  if (!todos.length) {
    todosUl.innerHTML = '<li class="todo"><span class="label" style="opacity:0.5">all done! ✧</span></li>';
    return;
  }

  todos.forEach((todo) => {
    const li = document.createElement('li');
    li.className = 'todo';
    li.dataset.todoId = getTodoStorageId(todo);
    if (doneTodos.has(li.dataset.todoId)) li.classList.add('done');
    li.innerHTML = `
      <span class="todo-icon todo-${todo.type}">${todo.type}</span>
      <span class="label">${todo.title}</span>
    `;
    todosUl.appendChild(li);
  });

  // Re-attach sparkle click listeners after dynamic render
  attachTodoClickListeners();
}

function attachTodoClickListeners() {
  document.querySelectorAll('.todos .todo').forEach((todo) => {
    if (todo.dataset.todoListenerAttached) return;

    if (!todo.dataset.todoId) {
      const label = todo.querySelector('.label')?.textContent || '';
      const type = todo.querySelector('.todo-icon')?.textContent || 'personal';
      todo.dataset.todoId = `${type}:${label}`.toLowerCase();
      if (getStoredDoneTodos().has(todo.dataset.todoId)) todo.classList.add('done');
    }

    todo.addEventListener('click', (e) => {
      const doneTodos = getStoredDoneTodos();
      const willBeDone = !todo.classList.contains('done');
      todo.classList.toggle('done');
      if (willBeDone) {
        doneTodos.add(todo.dataset.todoId);
      } else {
        doneTodos.delete(todo.dataset.todoId);
      }
      saveStoredDoneTodos(doneTodos);
      if (willBeDone) spawnSparkles(e.clientX, e.clientY);
    });
    todo.dataset.todoListenerAttached = 'true';
  });
}

function updatePrinterReaction(count) {
  const reaction = count > 3 ? '૮(˶ㅠ︿ㅠ)ა ' : count < 3 ? '( ˶ˆᗜˆ˵ )' : null;
  if (reaction && !IDLE_FRAMES.includes(reaction)) {
    IDLE_FRAMES.push(reaction);
  }
}

// ============================================================
// BOOT — fetch both sources in parallel
// ============================================================

async function loadDailyData() {
  const [events, todos] = await Promise.allSettled([
    initGoogleCalendar(),
    fetchNotionTodos(),
  ]);

  if (events.status === 'fulfilled' && events.value.length) {
    renderEvents(events.value);
  }

  if (todos.status === 'fulfilled' && todos.value.length) {
    renderTodos(todos.value);
  }
}

loadDailyData();

// --- Typewriter heading ---
const HEADING_PREFIX = "Nasha's Daily ";
const ROTATING_WORDS = ['Hell :,(', 'Tasks', 'Summary'];
const TYPE_DELAY = 90;
const DELETE_DELAY = 60;
const HOLD_AFTER_TYPE = 1400;
const HOLD_AFTER_DELETE = 300;

const heading = document.querySelector('.intro h1');
const headingText = heading.textContent;
heading.textContent = '';

const caret = document.createElement('span');
caret.className = 'caret';
caret.textContent = '|';
heading.appendChild(caret);

function typeString(str, i, done) {
  if (i >= str.length) return done();
  caret.before(str[i]);
  setTimeout(() => typeString(str, i + 1, done), TYPE_DELAY);
}

function deleteChars(n, done) {
  if (n <= 0) return done();
  const prev = caret.previousSibling;
  if (prev) {
    if (prev.nodeType === Node.TEXT_NODE && prev.data.length > 1) {
      prev.data = prev.data.slice(0, -1);
    } else {
      prev.remove();
    }
  }
  setTimeout(() => deleteChars(n - 1, done), DELETE_DELAY);
}

function loopWord(idx) {
  const word = ROTATING_WORDS[idx % ROTATING_WORDS.length];
  typeString(word, 0, () => {
    setTimeout(() => {
      deleteChars(word.length, () => {
        setTimeout(() => loopWord(idx + 1), HOLD_AFTER_DELETE);
      });
    }, HOLD_AFTER_TYPE);
  });
}

setTimeout(() => {
  typeString(headingText, 0, () => {
    setTimeout(() => {
      const trailing = headingText.length - HEADING_PREFIX.length;
      deleteChars(trailing, () => {
        setTimeout(() => loopWord(0), HOLD_AFTER_DELETE);
      });
    }, HOLD_AFTER_TYPE);
  });
}, 2000);

// --- Printer idle / printing text ---
const eventCount = document.querySelectorAll('.events li').length;
const reactionFrame = eventCount > 3 ? '૮(˶ㅠ︿ㅠ)ა ' : eventCount < 3 ? '( ˶ˆᗜˆ˵ )' : null;
const IDLE_FRAMES = ['₊✩‧₊˚print me₊✩‧₊˚', '₊˚₊✩‧print me₊˚₊✩‧'];
if (reactionFrame) IDLE_FRAMES.push(reactionFrame);
const PRINTING_FRAMES = ['₊ ⊹ . ݁printing₊ ⊹ . ݁˖', '⊹ . ݁₊ printing₊ . ݁˖⊹ '];

let idleFrame = 0;
printerText.textContent = IDLE_FRAMES[0];
const idleInterval = setInterval(() => {
  idleFrame = (idleFrame + 1) % IDLE_FRAMES.length;
  printerText.textContent = IDLE_FRAMES[idleFrame];
}, 450);

// --- Todo sparkle effect lolll ---
const SPARKLE_GLYPHS = ['✦', '✧', '⋆', '✩', '✶'];
const SPARKLE_COLORS = ['#EC6E9E', '#9E6EDA', '#C76EAB', '#FFD978'];
const SPARKLES_PER_BURST = 8;

function spawnSparkles(x, y) {
  for (let i = 0; i < SPARKLES_PER_BURST; i++) {
    const sparkle = document.createElement('span');
    sparkle.className = 'sparkle';
    sparkle.textContent = randomItem(SPARKLE_GLYPHS);
    sparkle.style.left = `${x}px`;
    sparkle.style.top = `${y}px`;
    sparkle.style.color = randomItem(SPARKLE_COLORS);
    sparkle.style.fontSize = `${12 + Math.random() * 12}px`;

    const angle = (i / SPARKLES_PER_BURST) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 32 + Math.random() * 28;
    sparkle.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    sparkle.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);

    document.body.appendChild(sparkle);
    sparkle.addEventListener('animationend', () => sparkle.remove());
  }
}

attachTodoClickListeners();

// --- Receipt wiggle ---
function wiggleReceipt() {
  receipt.classList.remove('is-wiggle');
  void receipt.offsetWidth;
  receipt.classList.add('is-wiggle');
}

receipt.addEventListener('click', (e) => {
  if (e.target.closest('.todo')) return;
  wiggleReceipt();
});

receipt.addEventListener('animationend', (e) => {
  if (e.animationName === 'receipt-wiggle') receipt.classList.remove('is-wiggle');
});

// --- Print button flow ---
printBtn.addEventListener('click', () => {
  clearInterval(idleInterval);
  stage.classList.add('is-printing');

  let frame = 0;
  printerText.textContent = PRINTING_FRAMES[0];
  const textInterval = setInterval(() => {
    frame = 1 - frame;
    printerText.textContent = PRINTING_FRAMES[frame];
  }, 400);

  receipt.addEventListener('transitionend', function onPrintEnd(e) {
    if (e.propertyName !== 'transform') return;
    receipt.removeEventListener('transitionend', onPrintEnd);
    clearInterval(textInterval);
    stage.classList.add('is-done');

    receipt.addEventListener('transitionend', function onSettle(e2) {
      if (e2.propertyName !== 'transform') return;
      receipt.removeEventListener('transitionend', onSettle);
      wiggleReceipt();
    });
  });
});

// --- Background sparkles ---
const BG_SPARKLE_COUNT = 90;
const bgSparkleContainer = document.querySelector('.bg-sparkles');

for (let i = 0; i < BG_SPARKLE_COUNT; i++) {
  const sparkle = document.createElement('span');
  sparkle.className = 'bg-sparkle';
  const size = 2 + Math.floor(Math.random() * 3);
  sparkle.style.width = `${size}px`;
  sparkle.style.height = `${size}px`;
  sparkle.style.left = `${Math.random() * 100}%`;
  sparkle.style.top = `${Math.random() * 100}%`;
  sparkle.style.setProperty('--dur', `${2 + Math.random() * 3}s`);
  sparkle.style.setProperty('--delay', `${Math.random() * 4}s`);
  bgSparkleContainer.appendChild(sparkle);
}

// --- Drifting decor images ---
const DECOR_IMAGES = [
  { src: 'assets/background-decors/big1.png', size: 45 },
  { src: 'assets/background-decors/big1.png', size: 65 },
  { src: 'assets/background-decors/big1.png', size: 55 },
  { src: 'assets/background-decors/big2.png', size: 40 },
  { src: 'assets/background-decors/big2.png', size: 60 },
  { src: 'assets/background-decors/big2.png', size: 70 },
  { src: 'assets/background-decors/big3.png', size: 50 },
  { src: 'assets/background-decors/big4.png', size: 35 },
  { src: 'assets/background-decors/big4.png', size: 58 },
  { src: 'assets/background-decors/big4.png', size: 66 },
  { src: 'assets/background-decors/big5.png', size: 42 },
  { src: 'assets/background-decors/Layer 5.png', size: 22, wander: true },
  { src: 'assets/background-decors/Layer 5.png', size: 18, wander: true },
  { src: 'assets/background-decors/Layer 6.png', size: 24, wander: true },
  { src: 'assets/background-decors/Layer 6.png', size: 20, wander: true },
  { src: 'assets/background-decors/Layer 7.png', size: 20, wander: true },
  { src: 'assets/background-decors/Layer 7.png', size: 26, wander: true },
  { src: 'assets/background-decors/Layer 9.png', size: 22, wander: true },
  { src: 'assets/background-decors/Layer 9.png', size: 17, wander: true },
  { src: 'assets/background-decors/Layer 10.png', size: 18, wander: true },
  { src: 'assets/background-decors/Layer 10.png', size: 24, wander: true },
  { src: 'assets/background-decors/Layer 12.png', size: 20, wander: true },
  { src: 'assets/background-decors/Layer 12.png', size: 26, wander: true },
  { src: 'assets/background-decors/Layer 13.png', size: 22, wander: true },
  { src: 'assets/background-decors/Layer 13.png', size: 18, wander: true },
  { src: 'assets/background-decors/Layer 14.png', size: 16, wander: true },
  { src: 'assets/background-decors/Layer 14.png', size: 22, wander: true },
  { src: 'assets/background-decors/Layer 15.png', size: 16, wander: true },
  { src: 'assets/background-decors/Layer 15.png', size: 20, wander: true },
  { src: 'assets/background-decors/Layer 16.png', size: 24, wander: true },
  { src: 'assets/background-decors/Layer 16.png', size: 18, wander: true },
  { src: 'assets/background-decors/Layer 17.png', size: 20, wander: true },
  { src: 'assets/background-decors/Layer 17.png', size: 25, wander: true },
  { src: 'assets/background-decors/Layer 18.png', size: 26, wander: true },
  { src: 'assets/background-decors/Layer 18.png', size: 18, wander: true },
];

const KICK_SPEED = 45;
const BOUNCE_DURATION = 0.35;
const BOUNCE_AMPLITUDE = 0.22;
const MAX_FRAME_DT = 0.05;

const viewportWidth = () => window.innerWidth;
const viewportHeight = () => window.innerHeight;

const decorContainer = document.querySelector('.bg-decors');
const decors = [];

DECOR_IMAGES.forEach((config) => {
  const el = document.createElement('img');
  el.src = config.src;
  el.alt = '';
  el.className = 'bg-decor';
  el.draggable = false;
  el.style.width = `${config.size}px`;
  el.style.height = `${config.size}px`;
  decorContainer.appendChild(el);

  const speed = 12 + Math.random() * 14;
  const angle = Math.random() * Math.PI * 2;
  const decor = {
    el,
    x: Math.random() * Math.max(0, viewportWidth() - config.size),
    y: Math.random() * Math.max(0, viewportHeight() - config.size),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: config.size / 2,
    size: config.size,
    wander: !!config.wander,
    bounceTime: 0,
  };
  decors.push(decor);

  el.addEventListener('click', (e) => {
    const cx = decor.x + decor.r;
    const cy = decor.y + decor.r;
    let dx = cx - e.clientX;
    let dy = cy - e.clientY;
    let len = Math.hypot(dx, dy);
    if (len < 0.001) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
      len = 1;
    }
    decor.vx = (dx / len) * KICK_SPEED;
    decor.vy = (dy / len) * KICK_SPEED;
    decor.bounceTime = BOUNCE_DURATION;
  });
});

function stepMotion(decor, dt, w, h) {
  decor.x += decor.vx * dt;
  decor.y += decor.vy * dt;

  if (decor.wander) {
    if (decor.x > w) decor.x = -decor.size;
    else if (decor.x + decor.size < 0) decor.x = w;
    if (decor.y > h) decor.y = -decor.size;
    else if (decor.y + decor.size < 0) decor.y = h;
    return;
  }

  if (decor.x < 0) { decor.x = 0; decor.vx = -decor.vx; }
  else if (decor.x + decor.size > w) { decor.x = w - decor.size; decor.vx = -decor.vx; }
  if (decor.y < 0) { decor.y = 0; decor.vy = -decor.vy; }
  else if (decor.y + decor.size > h) { decor.y = h - decor.size; decor.vy = -decor.vy; }
}

function resolveCollision(a, b) {
  const dx = (b.x + b.r) - (a.x + a.r);
  const dy = (b.y + b.r) - (a.y + a.r);
  const minD = a.r + b.r;
  const distSq = dx * dx + dy * dy;
  if (distSq >= minD * minD || distSq <= 0.0001) return;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = (minD - dist) / 2;
  a.x -= nx * overlap; a.y -= ny * overlap;
  b.x += nx * overlap; b.y += ny * overlap;

  const dot = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (dot < 0) {
    a.vx += dot * nx; a.vy += dot * ny;
    b.vx -= dot * nx; b.vy -= dot * ny;
  }
}

function renderDecor(decor, dt) {
  let scale = 1;
  if (decor.bounceTime > 0) {
    decor.bounceTime = Math.max(0, decor.bounceTime - dt);
    const t = 1 - decor.bounceTime / BOUNCE_DURATION;
    scale = 1 + BOUNCE_AMPLITUDE * Math.sin(t * Math.PI);
  }
  decor.el.style.transform = `translate(${decor.x}px, ${decor.y}px) scale(${scale})`;
}

let decorLastTime = performance.now();
function tickDecors(now) {
  const dt = Math.min(MAX_FRAME_DT, (now - decorLastTime) / 1000);
  decorLastTime = now;
  const w = viewportWidth();
  const h = viewportHeight();

  for (const decor of decors) stepMotion(decor, dt, w, h);

  for (let i = 0; i < decors.length; i++) {
    const a = decors[i];
    if (!a.wander) {
      for (let j = i + 1; j < decors.length; j++) {
        const b = decors[j];
        if (!b.wander) resolveCollision(a, b);
      }
    }
    renderDecor(a, dt);
  }

  requestAnimationFrame(tickDecors);
}

requestAnimationFrame((t) => {
  decorLastTime = t;
  tickDecors(t);
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
