// ─────────────────────────────────────────────
// SUPABASE — replace these two values with your project's URL and anon key
// from https://supabase.com → Project Settings → API
// ─────────────────────────────────────────────
const SUPABASE_URL  = "https://jomzkkkldwfjhclybjmr.supabase.co";
const SUPABASE_ANON = "sb_publishable_fnt9otLn88io2XIBhZBspw_ib5RG-k3";

/*
  ── SUPABASE SETUP ──────────────────────────────────────────────────────────
  Run this SQL once in Supabase → SQL Editor:

  create table profiles (
    id uuid references auth.users primary key,
    goal_minutes int default 0,
    goal_pages   int default 0,
    streak       int default 0,
    last_read_date text default ''
  );

  create table sessions (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid references auth.users not null,
    book         jsonb,
    time_secs    int,
    pages_read   int,
    current_page int,
    finished     boolean default false,
    photo_url    text,
    date_str     text,
    created_at   timestamptz default now()
  );

  -- Storage bucket: Supabase dashboard → Storage → New bucket → "reading_photos" (public)

  alter table profiles enable row level security;
  alter table sessions enable row level security;
  create policy "own profile" on profiles for all using (auth.uid() = id);
  create policy "own sessions" on sessions for all using (auth.uid() = user_id);
  create policy "own photos" on storage.objects for all
    using (auth.uid()::text = (storage.foldername(name))[1]);
  ────────────────────────────────────────────────────────────────────────── */

const { useState, useEffect, useRef, useCallback } = React;
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── Constants ───────────────────────────────
const SCREENS = { AUTH:"auth", HOME:"home", TIMER:"timer", CAMERA:"camera", COMPOSE:"compose", GOALS:"goals" };

const QUOTES = [
  { text:"A reader lives a thousand lives before he dies. The man who never reads lives only one.", author:"George R.R. Martin" },
  { text:"A book is a dream that you hold in your hands.", author:"Neil Gaiman" },
  { text:"There is no friend as loyal as a book.", author:"Ernest Hemingway" },
  { text:"Reading is to the mind what exercise is to the body.", author:"Joseph Addison" },
  { text:"Books are a uniquely portable magic.", author:"Stephen King" },
  { text:"The more that you read, the more things you will know.", author:"Dr. Seuss" },
  { text:"One must always be careful of books, and what is inside them.", author:"Cassandra Clare" },
  { text:"Not all those who wander are lost.", author:"J.R.R. Tolkien" },
  { text:"She is too fond of books, and it has turned her brain.", author:"Louisa May Alcott" },
  { text:"I am not afraid of storms, for I am learning how to sail my ship.", author:"Louisa May Alcott" },
];

const STREAK_MSGS = [
  n => `${n} days in a row. Keep the momentum.`,
  n => `${n}-day streak. You're building something real.`,
  n => `${n} consecutive days. Habits compound.`,
  n => `Day ${n}. Every page is a step forward.`,
  n => `${n} days straight. Readers like you are rare.`,
];

const PRESET_MINUTES = [5, 10, 15, 20, 30, 45, 60];
const CARD_W = 200;
const CARD_H = Math.round(CARD_W * 4 / 3);

// ─── Helpers ─────────────────────────────────
const fmt = s => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
};

const fmtLabel = s => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return h + "h " + m + "m";
  if (h > 0) return h + "h";
  if (m > 0) return m + "m";
  return s + "s";
};

const todayStr = () => new Date().toISOString().slice(0, 10);

async function claudeSearchBooks(query) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: "You are a book database. Return a JSON array of up to 5 real books matching: " + JSON.stringify(query) + ". Each object: title (string), author_name (array of strings), first_publish_year (string), open_library_cover_id (integer or null). ONLY raw JSON array."
      }]
    })
  });
  const d = await r.json();
  return JSON.parse((d.content?.[0]?.text || "[]").replace(/```json|```/g, "").trim());
}

function playAlarm() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1100, 880, 1100].forEach((freq, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination); o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0, ac.currentTime + i * 0.25);
      g.gain.linearRampToValueAtTime(0.3, ac.currentTime + i * 0.25 + 0.02);
      g.gain.linearRampToValueAtTime(0, ac.currentTime + i * 0.25 + 0.2);
      o.start(ac.currentTime + i * 0.25); o.stop(ac.currentTime + i * 0.25 + 0.25);
    });
  } catch(e) {}
}

// ─── Shared style objects ─────────────────────
const S = {
  app:      { fontFamily:"'Times New Roman',Times,serif", background:"#07070f", minHeight:"100vh", maxWidth:430, margin:"0 auto", color:"#fff" },
  hdr:      { padding:"22px 22px 10px", display:"flex", alignItems:"center", justifyContent:"space-between" },
  logoText: { fontSize:20, fontWeight:700, letterSpacing:3, background:"linear-gradient(90deg,#fff,rgba(255,255,255,0.5))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" },
  sub:      { fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:3, textTransform:"uppercase" },
  back:     { background:"none", border:"none", color:"rgba(255,255,255,0.45)", cursor:"pointer", fontSize:14, fontFamily:"inherit" },
  pBtn:     { display:"block", width:"100%", padding:"17px", borderRadius:14, border:"none", cursor:"pointer", fontSize:16, fontFamily:"inherit", fontWeight:700, background:"linear-gradient(135deg,#fff,#888)", color:"#000", marginTop:12 },
  gBtn:     { display:"block", width:"100%", padding:"17px", borderRadius:14, border:"none", cursor:"pointer", fontSize:16, fontFamily:"inherit", fontWeight:600, background:"rgba(255,255,255,0.06)", color:"rgba(255,255,255,0.8)", marginTop:10 },
  card:     { background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:18, padding:"18px 22px", marginBottom:10 },
  inp:      { width:"100%", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, padding:"14px 16px", color:"#fff", fontSize:15, fontFamily:"inherit", outline:"none", boxSizing:"border-box" },
  label:    { fontSize:10, letterSpacing:3, color:"rgba(255,255,255,0.3)", marginBottom:8, display:"block" },
};

// ─── LogoMark ─────────────────────────────────
function LogoMark({ size = 28, color = "white" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <path d="M14 3 C13 3 7 3.5 7 8 L7 25 C9.5 23.5 12 23 14 25 C16 23 18.5 23.5 21 25 L21 8 C21 3.5 15 3 14 3Z"
        stroke={color} strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <path d="M14 3 L14 25" stroke={color} strokeWidth="1.2" strokeDasharray="2 2" opacity="0.5"/>
      <path d="M9 10 L12.5 10 M9 13.5 L12.5 13.5 M9 17 L12.5 17"
        stroke={color} strokeWidth="1.4" strokeLinecap="round" opacity="0.6"/>
    </svg>
  );
}

// ─── FitnessRings ─────────────────────────────
function FitnessRings({ minutesPct, pagesPct, size = 90 }) {
  const cx = size / 2, cy = size / 2, r1 = size * 0.42, r2 = size * 0.29, sw = size * 0.085;
  const arc = (r, pct) => { const c = 2 * Math.PI * r; return { da: c, do: c * (1 - Math.min(pct, 1)) }; };
  const a1 = arc(r1, minutesPct), a2 = arc(r2, pagesPct);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={cx} cy={cy} r={r1} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={sw}/>
      <circle cx={cx} cy={cy} r={r1} fill="none" stroke="#fff" strokeWidth={sw}
        strokeDasharray={a1.da} strokeDashoffset={a1.do} strokeLinecap="round"/>
      <circle cx={cx} cy={cy} r={r2} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={sw}/>
      <circle cx={cx} cy={cy} r={r2} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={sw}
        strokeDasharray={a2.da} strokeDashoffset={a2.do} strokeLinecap="round"/>
    </svg>
  );
}

// ─── StreakModal ──────────────────────────────
function StreakModal({ streak, onClose }) {
  const msg = STREAK_MSGS[Math.min(streak - 1, STREAK_MSGS.length - 1)](streak);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:24, backdropFilter:"blur(4px)" }}>
      <div style={{ background:"#0e0e18", border:"1px solid rgba(255,255,255,0.1)", borderRadius:24, padding:"44px 32px", maxWidth:340, width:"100%", textAlign:"center", fontFamily:"'Times New Roman',Times,serif" }}>
        <div style={{ fontSize:72, fontWeight:800, lineHeight:1, letterSpacing:-4, marginBottom:4 }}>{streak}</div>
        <div style={{ fontSize:10, letterSpacing:5, color:"rgba(255,255,255,0.35)", marginBottom:20, textTransform:"uppercase" }}>day streak</div>
        <div style={{ width:40, height:1, background:"rgba(255,255,255,0.2)", margin:"0 auto 20px" }}/>
        <div style={{ fontSize:15, color:"rgba(255,255,255,0.7)", lineHeight:1.7, marginBottom:36, fontStyle:"italic" }}>{msg}</div>
        <button onClick={onClose} style={{ background:"linear-gradient(135deg,#fff,#888)", color:"#000", border:"none", borderRadius:14, padding:"16px", fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"inherit", width:"100%" }}>
          Keep Going
        </button>
      </div>
    </div>
  );
}

// ─── Card Templates ───────────────────────────
function CardBalanced({ book, sessionTime, pagesRead, currentPage, bookFinished, scale }) {
  const pad = 16;
  return (
    <div style={{ transform:`scale(${scale})`, transformOrigin:"center center", width:CARD_W, height:CARD_H, borderRadius:18, overflow:"hidden", background:"rgba(0,0,0,0.20)", fontFamily:"'Helvetica Neue',Arial,sans-serif", userSelect:"none", position:"relative", boxSizing:"border-box" }}>
      <div style={{ position:"absolute", top:pad, left:pad, right:pad, display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ fontSize:34, fontWeight:800, color:"#fff", lineHeight:1, letterSpacing:-1 }}>{pagesRead || "—"}</div>
          <div style={{ fontSize:8, fontWeight:600, color:"rgba(255,255,255,0.55)", letterSpacing:1.5, marginTop:2, textTransform:"uppercase" }}>pages</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:34, fontWeight:800, color:"#fff", lineHeight:1, letterSpacing:-1 }}>{fmtLabel(sessionTime)}</div>
          <div style={{ fontSize:8, fontWeight:600, color:"rgba(255,255,255,0.55)", letterSpacing:1.5, marginTop:2, textTransform:"uppercase" }}>read</div>
        </div>
      </div>
      <div style={{ position:"absolute", top:0, bottom:0, left:pad, right:pad, display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"center", textAlign:"center" }}>
        {bookFinished && <div style={{ fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.85)", letterSpacing:1.5, marginBottom:8, textTransform:"uppercase" }}>Finished</div>}
        <div style={{ fontSize:21, fontWeight:800, color:"#fff", lineHeight:1.2, letterSpacing:-0.5, marginBottom:6, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical" }}>{book?.title || ""}</div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.7)", letterSpacing:0.2, marginBottom:currentPage ? 8 : 0 }}>{book?.author_name?.[0] || ""}</div>
        {currentPage && <div style={{ fontSize:9, color:"rgba(255,255,255,0.45)", letterSpacing:0.5 }}>page {currentPage}</div>}
      </div>
      <div style={{ position:"absolute", bottom:pad, left:0, right:0, display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
        <svg width={11} height={11} viewBox="0 0 28 28" fill="none">
          <path d="M14 3 C13 3 7 3.5 7 8 L7 25 C9.5 23.5 12 23 14 25 C16 23 18.5 23.5 21 25 L21 8 C21 3.5 15 3 14 3Z" stroke="rgba(255,255,255,0.65)" strokeWidth="2.2" strokeLinejoin="round"/>
          <path d="M14 3 L14 25" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" strokeDasharray="2 2"/>
        </svg>
        <span style={{ fontSize:8, fontWeight:800, letterSpacing:3, color:"rgba(255,255,255,0.65)", textTransform:"uppercase" }}>Bookmark</span>
      </div>
    </div>
  );
}

function CardEditorial({ book, sessionTime, pagesRead, currentPage, bookFinished, scale }) {
  const pad = 18;
  return (
    <div style={{ transform:`scale(${scale})`, transformOrigin:"center center", width:CARD_W, height:CARD_H, borderRadius:18, overflow:"hidden", background:"rgba(0,0,0,0.20)", fontFamily:"Georgia,'Times New Roman',serif", userSelect:"none", position:"relative", boxSizing:"border-box" }}>
      <div style={{ position:"absolute", top:pad, left:pad, right:pad, height:1, background:"rgba(255,255,255,0.35)" }}/>
      <div style={{ position:"absolute", top:0, bottom:0, left:pad, right:pad, display:"flex", flexDirection:"column", justifyContent:"center" }}>
        {bookFinished && <div style={{ fontSize:8, letterSpacing:3, color:"rgba(255,255,255,0.6)", marginBottom:10, fontFamily:"'Helvetica Neue',Arial,sans-serif", fontWeight:600, textTransform:"uppercase" }}>finished</div>}
        <div style={{ fontSize:24, fontWeight:700, color:"#fff", lineHeight:1.15, marginBottom:10, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:4, WebkitBoxOrient:"vertical", fontStyle:"italic" }}>{book?.title || ""}</div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.65)", letterSpacing:0.5, marginBottom:14, fontStyle:"normal", fontFamily:"'Helvetica Neue',Arial,sans-serif" }}>{book?.author_name?.[0] || ""}</div>
        <div style={{ height:1, background:"rgba(255,255,255,0.2)", marginBottom:12 }}/>
        <div style={{ display:"flex", gap:16, fontFamily:"'Helvetica Neue',Arial,sans-serif" }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:"#fff", letterSpacing:-0.5, lineHeight:1 }}>{fmtLabel(sessionTime)}</div>
            <div style={{ fontSize:7, color:"rgba(255,255,255,0.45)", letterSpacing:1.5, marginTop:3, textTransform:"uppercase" }}>time read</div>
          </div>
          {pagesRead && <div>
            <div style={{ fontSize:16, fontWeight:700, color:"#fff", letterSpacing:-0.5, lineHeight:1 }}>{pagesRead}</div>
            <div style={{ fontSize:7, color:"rgba(255,255,255,0.45)", letterSpacing:1.5, marginTop:3, textTransform:"uppercase" }}>pages</div>
          </div>}
          {currentPage && <div>
            <div style={{ fontSize:16, fontWeight:700, color:"#fff", letterSpacing:-0.5, lineHeight:1 }}>p.{currentPage}</div>
            <div style={{ fontSize:7, color:"rgba(255,255,255,0.45)", letterSpacing:1.5, marginTop:3, textTransform:"uppercase" }}>now on</div>
          </div>}
        </div>
      </div>
      <div style={{ position:"absolute", bottom:pad, left:pad, right:pad, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:7, letterSpacing:2.5, color:"rgba(255,255,255,0.4)", fontFamily:"'Helvetica Neue',Arial,sans-serif", textTransform:"uppercase" }}>Bookmark</span>
        <span style={{ fontSize:7, color:"rgba(255,255,255,0.3)", fontFamily:"'Helvetica Neue',Arial,sans-serif" }}>{new Date().toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}</span>
      </div>
    </div>
  );
}

function CardBlock({ book, sessionTime, pagesRead, currentPage, bookFinished, scale }) {
  const pad = 14;
  return (
    <div style={{ transform:`scale(${scale})`, transformOrigin:"center center", width:CARD_W, height:CARD_H, borderRadius:18, overflow:"hidden", background:"rgba(0,0,0,0.20)", fontFamily:"'Helvetica Neue',Arial,sans-serif", userSelect:"none", position:"relative", boxSizing:"border-box" }}>
      <div style={{ position:"absolute", top:pad, left:pad, fontSize:7, fontWeight:900, letterSpacing:3, color:"rgba(255,255,255,0.5)", textTransform:"uppercase" }}>Bookmark</div>
      <div style={{ position:"absolute", top:0, bottom:0, left:pad, right:pad, display:"flex", flexDirection:"column", justifyContent:"center" }}>
        {bookFinished && <div style={{ fontSize:8, fontWeight:900, color:"rgba(255,255,255,0.7)", letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>Finished</div>}
        <div style={{ fontSize:20, fontWeight:900, color:"#fff", lineHeight:1.05, letterSpacing:-0.5, textTransform:"uppercase", overflow:"hidden", display:"-webkit-box", WebkitLineClamp:4, WebkitBoxOrient:"vertical" }}>{book?.title || ""}</div>
        <div style={{ fontSize:9, fontWeight:500, color:"rgba(255,255,255,0.6)", letterSpacing:1, marginTop:6, textTransform:"uppercase" }}>{book?.author_name?.[0] || ""}</div>
      </div>
      <div style={{ position:"absolute", bottom:pad, left:pad, right:pad }}>
        <div style={{ width:24, height:2, background:"rgba(255,255,255,0.7)", marginBottom:8 }}/>
        <div style={{ fontSize:11, fontWeight:900, color:"#fff", letterSpacing:-0.5, lineHeight:1.1, textTransform:"uppercase" }}>
          {fmtLabel(sessionTime)}{pagesRead ? " · " + pagesRead + " PG" : ""}{currentPage ? " · P." + currentPage : ""}
        </div>
        <div style={{ fontSize:7, fontWeight:600, color:"rgba(255,255,255,0.4)", letterSpacing:2, marginTop:4, textTransform:"uppercase" }}>
          {new Date().toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}
        </div>
      </div>
    </div>
  );
}

const TEMPLATES = [
  { id:"balanced",  label:"Balanced",  Component:CardBalanced  },
  { id:"editorial", label:"Editorial", Component:CardEditorial },
  { id:"block",     label:"Block",     Component:CardBlock     },
];

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
function Bookmark() {
  // ── Auth state ──
  const [user, setUser]               = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode]       = useState("signin");
  const [authEmail, setAuthEmail]     = useState("");
  const [authPass, setAuthPass]       = useState("");
  const [authError, setAuthError]     = useState(null);
  const [authBusy, setAuthBusy]       = useState(false);

  // ── Profile state ──
  const [profile, setProfile]                   = useState({ goal_minutes:0, goal_pages:0, streak:0, last_read_date:"" });
  const [showStreakModal, setShowStreakModal]     = useState(false);
  const [newStreak, setNewStreak]               = useState(0);
  const [newStreak, setNewStreak]               = useState(0);
  const [gMin, setGMin] = useState("");
  const [gPg, setGPg] = useState("");
  const [goalsSaving, setGoalsSaving] = useState(false);

  // ── Sessions state ──
  const [sessions, setSessions]                 = useState([]);
  const [sessionsLoading, setSessionsLoading]   = useState(false);

  // ── Navigation ──
  const [screen, setScreen] = useState(SCREENS.HOME);

  // ── Timer state ──
  const [timerMode, setTimerMode]         = useState("stopwatch");
  const [timerRunning, setTimerRunning]   = useState(false);
  const [elapsed, setElapsed]             = useState(0);
  const [countdownSet, setCountdownSet]   = useState(20 * 60);
  const [countdownLeft, setCountdownLeft] = useState(20 * 60);
  const [countdownDone, setCountdownDone] = useState(false);
  const [countdownInput, setCountdownInput] = useState("20");
  const [sessionTime, setSessionTime]     = useState(0);
  const [quoteIdx]                        = useState(() => Math.floor(Math.random() * QUOTES.length));

  // ── Book state ──
  const [bookExpanded, setBookExpanded]     = useState(false);
  const [searchQuery, setSearchQuery]       = useState("");
  const [searchResults, setSearchResults]   = useState([]);
  const [searchLoading, setSearchLoading]   = useState(false);
  const [searchError, setSearchError]       = useState(null);
  const [selectedBook, setSelectedBook]     = useState(null);
  const [startingPage, setStartingPage]     = useState("");
  const [currentPage, setCurrentPage]       = useState("");
  const [bookFinished, setBookFinished]     = useState(false);
  const [manualPages, setManualPages]       = useState("");

  const pagesRead = (() => {
    const end = parseInt(currentPage), start = parseInt(startingPage);
    if (!isNaN(end) && !isNaN(start) && end > start) return String(end - start);
    return manualPages;
  })();

  // ── Compose state ──
  const [photo, setPhoto]                   = useState(null);
  const [photoFile, setPhotoFile]           = useState(null);
  const [cardFormat, setCardFormat]         = useState("square");
  const [selectedTemplate, setSelectedTemplate] = useState("balanced");
  const [exporting, setExporting]           = useState(false);
  const [savingSession, setSavingSession]   = useState(false);
  const [cardPos, setCardPos]               = useState({ x:0.5, y:0.65 });
  const [cardScale, setCardScale]           = useState(1.0);
  const [showSwipeTip, setShowSwipeTip]     = useState(false);

  // ── Refs ──
  const intervalRef    = useRef(null);
  const startTimeRef   = useRef(null);
  const elapsedAtStart = useRef(0);
  const fileInputRef   = useRef(null);
  const cameraInputRef = useRef(null);
  const exportCanvasRef = useRef(null);
  const previewRef     = useRef(null);
  const gestureRef     = useRef({ dragging:false, pinching:false, lastX:0, lastY:0, startDist:0, startScale:1, startPos:{x:0.5,y:0.65}, pinchCenter:{x:0.5,y:0.65} });
  const mouseRef       = useRef({ down:false, lx:0, ly:0 });
  const swipeStartX    = useRef(null);

  // ── Auth effects ──
  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange((_, session) => setUser(session?.user || null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setSessions([]); setProfile({ goal_minutes:0, goal_pages:0, streak:0, last_read_date:"" }); return; }
    loadProfile();
    loadSessions();
  }, [user]);

  // ── Swipe tip timeout ──
  useEffect(() => {
    if (showSwipeTip) {
      const t = setTimeout(() => setShowSwipeTip(false), 3000);
      return () => clearTimeout(t);
    }
  }, [showSwipeTip]);

  // ── Data loaders ──
  const loadProfile = async () => {
    const { data } = await sb.from("profiles").select("*").eq("id", user.id).single();
    if (data) setProfile(data);
    else await sb.from("profiles").insert({ id: user.id });
  };

  const loadSessions = async () => {
    setSessionsLoading(true);
    const { data } = await sb.from("sessions").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setSessions(data || []);
    setSessionsLoading(false);
  };

  // ── Auth handlers ──
  const handleAuth = async () => {
    setAuthBusy(true); setAuthError(null);
    const { data, error } = authMode === "signup"
      ? await sb.auth.signUp({ email: authEmail, password: authPass })
      : await sb.auth.signInWithPassword({ email: authEmail, password: authPass });
    if (error) setAuthError(error.message);
    else if (data?.user) setUser(data.user);
    setAuthBusy(false);
  };

  const handleSignOut = async () => { await sb.auth.signOut(); setScreen(SCREENS.AUTH); };

  // ── Timer effect ──
  useEffect(() => {
    if (timerRunning) {
      startTimeRef.current = Date.now(); elapsedAtStart.current = elapsed;
      intervalRef.current = setInterval(() => {
        const delta = Math.floor((Date.now() - startTimeRef.current) / 1000);
        const ne = elapsedAtStart.current + delta;
        setElapsed(ne);
        if (timerMode === "countdown") {
          const left = Math.max(0, countdownSet - ne);
          setCountdownLeft(left);
          if (left === 0 && !countdownDone) { setCountdownDone(true); setTimerRunning(false); playAlarm(); }
        }
      }, 1000);
    } else clearInterval(intervalRef.current);
    return () => clearInterval(intervalRef.current);
  }, [timerRunning]);

  // ── Timer helpers ──
  const applyCountdown = () => {
    const m = Math.max(1, parseInt(countdownInput) || 20), s = m * 60;
    setCountdownSet(s); setCountdownLeft(s); setElapsed(0); setCountdownDone(false); setTimerRunning(false);
  };
  const extendCountdown = m => {
    const e = m * 60; setCountdownSet(p => p + e); setCountdownLeft(e); setCountdownDone(false); setTimerRunning(true);
  };
  const switchMode = mode => {
    setTimerMode(mode); setTimerRunning(false); setElapsed(0); setCountdownDone(false);
    if (mode === "countdown") { const m = parseInt(countdownInput) || 20; setCountdownSet(m * 60); setCountdownLeft(m * 60); }
  };
  const stopSession = () => { setTimerRunning(false); setSessionTime(elapsed); setScreen(SCREENS.CAMERA); };

  // ── Book search ──
  const searchBooks = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true); setSearchError(null); setSearchResults([]);
    try { setSearchResults(await claudeSearchBooks(searchQuery)); }
    catch { setSearchError("Search failed."); }
    setSearchLoading(false);
  };

  // ── Photo upload ──
  const handlePhotoUpload = e => {
    const file = e.target.files[0]; if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = ev => { setPhoto(ev.target.result); setCardPos({ x:0.5, y:0.65 }); setCardScale(1.0); setShowSwipeTip(true); setScreen(SCREENS.COMPOSE); };
    reader.readAsDataURL(file);
  };

  // ── Streak ──
  const computeStreak = (currentStreak, lastDate) => {
    const today = todayStr();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (lastDate === today) return currentStreak;
    if (lastDate === yesterday) return currentStreak + 1;
    return 1;
  };

  // ── Save session ──
  const saveSession = async () => {
    if (!user) { setScreen(SCREENS.HOME); return; }
    setSavingSession(true);
    let photoUrl = null;
    if (photoFile) {
      const path = `${user.id}/${Date.now()}.jpg`;
      const { data: up } = await sb.storage.from("reading_photos").upload(path, photoFile, { contentType:"image/jpeg", upsert:false });
      if (up) { const { data: { publicUrl } } = sb.storage.from("reading_photos").getPublicUrl(path); photoUrl = publicUrl; }
    }
    await sb.from("sessions").insert({
      user_id: user.id, book: selectedBook || null, time_secs: sessionTime,
      pages_read: parseInt(pagesRead) || 0, current_page: parseInt(currentPage) || 0,
      finished: bookFinished, photo_url: photoUrl,
      date_str: new Date().toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })
    });
    const newS = computeStreak(profile.streak, profile.last_read_date);
    await sb.from("profiles").upsert({ id: user.id, streak: newS, last_read_date: todayStr() });
    await loadSessions(); await loadProfile();
    setElapsed(0); setSessionTime(0); setSelectedBook(null); setManualPages(""); setCurrentPage("");
    setStartingPage(""); setBookFinished(false); setPhoto(null); setPhotoFile(null);
    setSearchQuery(""); setSearchResults([]); setCountdownDone(false); setBookExpanded(false);
    setSavingSession(false);
    setNewStreak(newS); setShowStreakModal(true);
    setScreen(SCREENS.HOME);
  };

  // ── Today totals ──
  const todayTotals = (() => {
    const today = todayStr(); let mins = 0, pgs = 0;
    sessions.forEach(s => { if (s.created_at?.slice(0, 10) === today) { mins += Math.round((s.time_secs || 0) / 60); pgs += (s.pages_read || 0); } });
    return { mins, pgs };
  })();
  const minutesPct = profile.goal_minutes > 0 ? todayTotals.mins / profile.goal_minutes : 0;
  const pagesPct   = profile.goal_pages   > 0 ? todayTotals.pgs  / profile.goal_pages   : 0;

  // ── Template index ──
  const tIdx = TEMPLATES.findIndex(t => t.id === selectedTemplate);

  // ── Gesture handlers ──
  const getTwoTouchDist = t => { const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); };
  const getTwoTouchCenter = (t, rect) => ({ x: ((t[0].clientX + t[1].clientX) / 2 - rect.left) / rect.width, y: ((t[0].clientY + t[1].clientY) / 2 - rect.top) / rect.height });

  const onTouchStart = useCallback(e => {
    const g = gestureRef.current;
    if (e.touches.length === 1) { g.dragging = true; g.pinching = false; g.lastX = e.touches[0].clientX; g.lastY = e.touches[0].clientY; g.startPos = { ...cardPos }; }
    else if (e.touches.length === 2) { g.dragging = false; g.pinching = true; g.startDist = getTwoTouchDist(e.touches); g.startScale = cardScale; g.startPos = { ...cardPos }; const rect = previewRef.current?.getBoundingClientRect(); if (rect) g.pinchCenter = getTwoTouchCenter(e.touches, rect); }
  }, [cardPos, cardScale]);

  const onTouchMove = useCallback(e => {
    e.preventDefault();
    const g = gestureRef.current; const rect = previewRef.current?.getBoundingClientRect(); if (!rect) return;
    if (g.pinching && e.touches.length === 2) {
      setCardScale(Math.min(3, Math.max(0.3, g.startScale * (getTwoTouchDist(e.touches) / g.startDist))));
      const center = getTwoTouchCenter(e.touches, rect);
      setCardPos({ x: Math.max(0, Math.min(1, g.startPos.x + (center.x - g.pinchCenter.x))), y: Math.max(0, Math.min(1, g.startPos.y + (center.y - g.pinchCenter.y))) });
    } else if (g.dragging && e.touches.length === 1) {
      const dx = (e.touches[0].clientX - g.lastX) / rect.width, dy = (e.touches[0].clientY - g.lastY) / rect.height;
      g.lastX = e.touches[0].clientX; g.lastY = e.touches[0].clientY;
      setCardPos(p => ({ x: Math.max(0, Math.min(1, p.x + dx)), y: Math.max(0, Math.min(1, p.y + dy)) }));
    }
  }, []);

  const onTouchEnd = useCallback(e => {
    const g = gestureRef.current;
    if (e.touches.length < 2) g.pinching = false;
    if (e.touches.length === 0) g.dragging = false;
  }, []);

  const onMouseDown = e => { mouseRef.current = { down:true, lx:e.clientX, ly:e.clientY }; };
  const onMouseMove = useCallback(e => {
    if (!mouseRef.current.down) return;
    const rect = previewRef.current?.getBoundingClientRect(); if (!rect) return;
    const dx = (e.clientX - mouseRef.current.lx) / rect.width, dy = (e.clientY - mouseRef.current.ly) / rect.height;
    mouseRef.current.lx = e.clientX; mouseRef.current.ly = e.clientY;
    setCardPos(p => ({ x: Math.max(0, Math.min(1, p.x + dx)), y: Math.max(0, Math.min(1, p.y + dy)) }));
  }, []);
  const onMouseUp = () => { mouseRef.current.down = false; };
  const onWheel = useCallback(e => { e.preventDefault(); setCardScale(s => Math.min(3, Math.max(0.3, s * (e.deltaY < 0 ? 1.08 : 0.93)))); }, []);

  // ── Carousel swipe ──
  const onCarouselTouchStart = e => { swipeStartX.current = e.touches[0].clientX; };
  const onCarouselTouchEnd = e => {
    if (swipeStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - swipeStartX.current; swipeStartX.current = null;
    if (Math.abs(dx) < 30) return;
    if (dx < 0 && tIdx < TEMPLATES.length - 1) setSelectedTemplate(TEMPLATES[tIdx + 1].id);
    else if (dx > 0 && tIdx > 0) setSelectedTemplate(TEMPLATES[tIdx - 1].id);
  };
  const onCarouselMouseDown = e => { swipeStartX.current = e.clientX; };
  const onCarouselMouseUp = e => {
    if (swipeStartX.current === null) return;
    const dx = e.clientX - swipeStartX.current; swipeStartX.current = null;
    if (Math.abs(dx) < 30) return;
    if (dx < 0 && tIdx < TEMPLATES.length - 1) setSelectedTemplate(TEMPLATES[tIdx + 1].id);
    else if (dx > 0 && tIdx > 0) setSelectedTemplate(TEMPLATES[tIdx - 1].id);
  };

  // ── Canvas export ──
  const exportCard = useCallback(async () => {
    setExporting(true);
    const W = 1080, H = cardFormat === "story" ? 1920 : 1080;
    const canvas = exportCanvasRef.current; canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const previewEl = previewRef.current;
    const pW = previewEl ? previewEl.offsetWidth : 382, pH = previewEl ? previewEl.offsetHeight : (cardFormat === "story" ? 679 : 382);
    const avgS = ((W / pW) + (H / pH)) / 2;
    const cw = CARD_W * cardScale * avgS, ch = CARD_H * cardScale * avgS;
    const rx = cardPos.x * W - cw / 2, ry = cardPos.y * H - ch / 2;
    const radius = 18 * cardScale * avgS, fs = n => n * cardScale * avgS, pad = fs(16);
    const doRender = bgImg => {
      ctx.clearRect(0, 0, W, H);
      if (bgImg) {
        const sc = Math.max(W / bgImg.width, H / bgImg.height);
        ctx.drawImage(bgImg, (W - bgImg.width * sc) / 2, (H - bgImg.height * sc) / 2, bgImg.width * sc, bgImg.height * sc);
      } else {
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, "#0f0c29"); bg.addColorStop(0.5, "#302b63"); bg.addColorStop(1, "#24243e");
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      }
      ctx.save(); ctx.beginPath(); ctx.roundRect(rx, ry, cw, ch, radius); ctx.fillStyle = "rgba(0,0,0,0.20)"; ctx.fill(); ctx.restore();

      if (selectedTemplate === "balanced") {
        ctx.textAlign = "left"; ctx.font = "800 " + fs(34) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "#fff"; ctx.fillText(pagesRead || "—", rx + pad, ry + pad + fs(34));
        ctx.font = "600 " + fs(8) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillText("PAGES", rx + pad, ry + pad + fs(34) + fs(13));
        ctx.textAlign = "right"; ctx.font = "800 " + fs(34) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "#fff"; ctx.fillText(fmtLabel(sessionTime), rx + cw - pad, ry + pad + fs(34));
        ctx.font = "600 " + fs(8) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillText("READ", rx + cw - pad, ry + pad + fs(34) + fs(13));
        ctx.textAlign = "center"; const midX = rx + cw / 2, midY = ry + ch / 2;
        ctx.font = "800 " + fs(21) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "#fff";
        const words = (selectedBook?.title || "").split(" "); const lines = []; let cur = "";
        for (const w of words) { const t = cur ? cur + " " + w : w; if (ctx.measureText(t).width <= cw - pad * 2) { cur = t; } else { if (cur) lines.push(cur); cur = w; } if (lines.length === 2) break; }
        if (cur) lines.push(cur);
        const tsy = midY - lines.length * fs(26) / 2 - (currentPage ? fs(16) : fs(10));
        lines.forEach((l, i) => ctx.fillText(l, midX, tsy + i * fs(26)));
        ctx.font = "400 " + fs(10) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillText(selectedBook?.author_name?.[0] || "", midX, tsy + lines.length * fs(26) + fs(14));
        if (currentPage) { ctx.font = "400 " + fs(9) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fillText("page " + currentPage, midX, tsy + lines.length * fs(26) + fs(28)); }
        ctx.font = "800 " + fs(8) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillText("BOOKMARK", midX, ry + ch - pad);

      } else if (selectedTemplate === "editorial") {
        ctx.textAlign = "left"; ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(rx + pad, ry + pad); ctx.lineTo(rx + cw - pad, ry + pad); ctx.stroke();
        ctx.font = "700 " + fs(24) + "px Georgia,'Times New Roman',serif"; ctx.fillStyle = "#fff";
        const words2 = (selectedBook?.title || "").split(" "); const lines2 = []; let cur2 = "";
        for (const w of words2) { const t = cur2 ? cur2 + " " + w : w; if (ctx.measureText(t).width <= cw - pad * 2) { cur2 = t; } else { if (cur2) lines2.push(cur2); cur2 = w; } if (lines2.length === 3) break; }
        if (cur2) lines2.push(cur2);
        const cy2 = ry + ch * 0.38; lines2.forEach((l, i) => ctx.fillText(l, rx + pad, cy2 + i * fs(30)));
        ctx.font = "400 " + fs(10) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.65)"; ctx.fillText(selectedBook?.author_name?.[0] || "", rx + pad, cy2 + lines2.length * fs(30) + fs(16));
        const ruleY = cy2 + lines2.length * fs(30) + fs(30); ctx.beginPath(); ctx.moveTo(rx + pad, ruleY); ctx.lineTo(rx + cw - pad, ruleY); ctx.stroke();
        let sx = rx + pad; const sy = ruleY + fs(22);
        for (const [val, lbl] of [[fmtLabel(sessionTime), "TIME READ"], [pagesRead, "PAGES"], [currentPage ? "p." + currentPage : "", "NOW ON"]].filter(([v]) => v)) {
          ctx.font = "700 " + fs(16) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "#fff"; ctx.fillText(val, sx, sy);
          ctx.font = "600 " + fs(7) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fillText(lbl, sx, sy + fs(13)); sx += fs(55);
        }
        ctx.font = "600 " + fs(7) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillText("BOOKMARK", rx + pad, ry + ch - pad);
        ctx.textAlign = "right"; ctx.fillText(new Date().toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }), rx + cw - pad, ry + ch - pad);

      } else if (selectedTemplate === "block") {
        ctx.textAlign = "left"; ctx.font = "900 " + fs(7) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillText("BOOKMARK", rx + pad, ry + pad + fs(7));
        ctx.font = "900 " + fs(20) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "#fff";
        const words3 = (selectedBook?.title || "").toUpperCase().split(" "); const lines3 = []; let cur3 = "";
        for (const w of words3) { const t = cur3 ? cur3 + " " + w : w; if (ctx.measureText(t).width <= cw - pad * 2) { cur3 = t; } else { if (cur3) lines3.push(cur3); cur3 = w; } if (lines3.length === 3) break; }
        if (cur3) lines3.push(cur3);
        const bty = ry + ch * 0.32; lines3.forEach((l, i) => ctx.fillText(l, rx + pad, bty + i * fs(24)));
        ctx.font = "500 " + fs(9) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillText((selectedBook?.author_name?.[0] || "").toUpperCase(), rx + pad, bty + lines3.length * fs(24) + fs(14));
        ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillRect(rx + pad, ry + ch - pad - fs(28), fs(24), fs(2));
        const statStr = [fmtLabel(sessionTime), pagesRead ? pagesRead + " PG" : null, currentPage ? "P." + currentPage : null].filter(Boolean).join(" · ");
        ctx.font = "900 " + fs(11) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "#fff"; ctx.fillText(statStr, rx + pad, ry + ch - pad - fs(12));
        ctx.font = "600 " + fs(7) + "px 'Helvetica Neue',Arial,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillText(new Date().toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }).toUpperCase(), rx + pad, ry + ch - pad);
      }

      const link = document.createElement("a");
      link.download = "bookmark-" + (selectedBook?.title?.replace(/\s+/g, "-") || "session") + ".png";
      link.href = canvas.toDataURL("image/png"); link.click(); setExporting(false);
    };
    const loadImg = src => new Promise(res => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    doRender(photo ? await loadImg(photo) : null);
  }, [photo, cardFormat, cardPos, cardScale, selectedTemplate, selectedBook, sessionTime, pagesRead, currentPage, bookFinished]);

  // ══════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════

  // ── Loading splash ──
  if (authLoading) return (
    <div style={{ ...S.app, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ textAlign:"center" }}>
        <LogoMark size={40} color="rgba(255,255,255,0.25)"/>
        <div style={{ fontSize:10, letterSpacing:4, color:"rgba(255,255,255,0.15)", marginTop:14 }}>BOOKMARK</div>
      </div>
    </div>
  );

  // ── Auth screen ──
  if (!user || screen === SCREENS.AUTH) return (
    <div style={S.app}>
      <div style={{ padding:"64px 32px 0", textAlign:"center" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:18 }}><LogoMark size={48} color="rgba(255,255,255,0.8)"/></div>
        <div style={{ ...S.logoText, display:"block", fontSize:22 }}>BOOKMARK</div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.3)", marginTop:8, letterSpacing:1 }}>Your reading life, tracked.</div>
      </div>
      <div style={{ padding:"40px 28px" }}>
        <div style={{ display:"flex", gap:0, marginBottom:28, background:"rgba(255,255,255,0.05)", borderRadius:12, padding:4 }}>
          {[["signin","Sign In"],["signup","Create Account"]].map(([m, lbl]) => (
            <button key={m} onClick={() => { setAuthMode(m); setAuthError(null); }}
              style={{ flex:1, padding:"10px 0", borderRadius:10, border:"none", cursor:"pointer", fontSize:14, fontFamily:"inherit", fontWeight:600,
                background: authMode === m ? "linear-gradient(135deg,#fff,#aaa)" : "transparent",
                color: authMode === m ? "#000" : "rgba(255,255,255,0.4)" }}>
              {lbl}
            </button>
          ))}
        </div>
        <div style={{ marginBottom:14 }}>
          <label style={S.label}>EMAIL</label>
          <input style={S.inp} type="email" placeholder="you@example.com" value={authEmail} onChange={e => setAuthEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAuth()}/>
        </div>
        <div style={{ marginBottom:20 }}>
          <label style={S.label}>PASSWORD</label>
          <input style={S.inp} type="password" placeholder="••••••••" value={authPass} onChange={e => setAuthPass(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAuth()}/>
        </div>
        {authError && <div style={{ fontSize:13, color:"#f87171", marginBottom:14, textAlign:"center", lineHeight:1.5 }}>{authError}</div>}
        <button style={{ ...S.pBtn, marginTop:0, opacity: authBusy ? 0.6 : 1 }} onClick={handleAuth} disabled={authBusy}>
          {authBusy ? "…" : authMode === "signup" ? "Create Account" : "Sign In"}
        </button>
        {authMode === "signup" && <p style={{ fontSize:11, color:"rgba(255,255,255,0.2)", textAlign:"center", marginTop:16, lineHeight:1.7 }}>Your data is private and only accessible to you.</p>}
      </div>
    </div>
  );

  // ── Home screen ──
  if (screen === SCREENS.HOME) {
    const hasGoals = profile.goal_minutes > 0 || profile.goal_pages > 0;
    return (
      <div style={S.app}>
        {showStreakModal && <StreakModal streak={newStreak} onClose={() => setShowStreakModal(false)}/>}
        <div style={S.hdr}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <LogoMark size={22} color="rgba(255,255,255,0.7)"/>
            <span style={S.logoText}>BOOKMARK</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            {profile.streak > 0 && <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", letterSpacing:0.5 }}>{profile.streak}d</div>}
            <button onClick={() => setScreen(SCREENS.GOALS)} style={{ background:"none", border:"1px solid rgba(255,255,255,0.12)", borderRadius:8, cursor:"pointer", color:"rgba(255,255,255,0.5)", fontSize:11, fontFamily:"inherit", padding:"5px 10px", letterSpacing:1 }}>GOALS</button>
            <button onClick={handleSignOut} style={{ ...S.back, fontSize:12 }}>Sign out</button>
          </div>
        </div>

        <div style={{ padding:"0 22px 50px" }}>
          {hasGoals ? (
            <div style={{ ...S.card, display:"flex", alignItems:"center", gap:18, padding:"16px 18px", marginBottom:18 }}>
              <div style={{ position:"relative", flexShrink:0, width:90, height:90 }}>
                <FitnessRings minutesPct={minutesPct} pagesPct={pagesPct} size={90}/>
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" }}>
                  <div style={{ fontSize:12, fontWeight:700, color:"#fff", lineHeight:1 }}>{todayTotals.mins}m</div>
                  <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:2 }}>{todayTotals.pgs}pg</div>
                </div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, letterSpacing:2, color:"rgba(255,255,255,0.25)", marginBottom:10 }}>TODAY</div>
                {profile.goal_minutes > 0 && (
                  <div style={{ marginBottom:9 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:4 }}>
                      <span style={{ color:"rgba(255,255,255,0.5)" }}>Time</span>
                      <span style={{ color:"#fff", fontWeight:600 }}>{todayTotals.mins} / {profile.goal_minutes} min</span>
                    </div>
                    <div style={{ height:2, background:"rgba(255,255,255,0.07)", borderRadius:2 }}>
                      <div style={{ height:"100%", width: Math.min(100, minutesPct * 100) + "%", background:"#fff", borderRadius:2, transition:"width 0.6s" }}/>
                    </div>
                  </div>
                )}
                {profile.goal_pages > 0 && (
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:4 }}>
                      <span style={{ color:"rgba(255,255,255,0.5)" }}>Pages</span>
                      <span style={{ color:"rgba(255,255,255,0.5)", fontWeight:600 }}>{todayTotals.pgs} / {profile.goal_pages} pg</span>
                    </div>
                    <div style={{ height:2, background:"rgba(255,255,255,0.07)", borderRadius:2 }}>
                      <div style={{ height:"100%", width: Math.min(100, pagesPct * 100) + "%", background:"rgba(255,255,255,0.45)", borderRadius:2, transition:"width 0.6s" }}/>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : <div style={{ marginBottom:16 }}/>}

          <button style={{ ...S.pBtn, marginTop:0, marginBottom:28, padding:"19px", fontSize:17 }}
            onClick={() => { setElapsed(0); setTimerRunning(false); setCountdownDone(false); setScreen(SCREENS.TIMER); }}>
            Begin Reading Session
          </button>

          {sessionsLoading ? (
            <div style={{ textAlign:"center", color:"rgba(255,255,255,0.2)", fontSize:13, padding:"40px 0" }}>Loading…</div>
          ) : sessions.length > 0 ? (
            <>
              <div style={{ fontSize:10, letterSpacing:3, color:"rgba(255,255,255,0.2)", marginBottom:14 }}>READING HISTORY</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {sessions.map((s, i) => (
                  <div key={s.id || i} style={{ borderRadius:14, overflow:"hidden", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.05)", aspectRatio:"3/4", position:"relative" }}>
                    {s.photo_url
                      ? <img src={s.photo_url} style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }}/>
                      : s.book?.open_library_cover_id
                        ? <img src={"https://covers.openlibrary.org/b/id/" + s.book.open_library_cover_id + "-M.jpg"} crossOrigin="anonymous" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", opacity:0.45 }}/>
                        : <div style={{ position:"absolute", inset:0, background:"#111", display:"flex", alignItems:"center", justifyContent:"center" }}><LogoMark size={24} color="rgba(255,255,255,0.1)"/></div>
                    }
                    <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top,rgba(0,0,0,0.88) 0%,transparent 55%)" }}/>
                    <div style={{ position:"absolute", bottom:10, left:10, right:10 }}>
                      {s.book?.title && <div style={{ fontSize:11, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:2 }}>{s.book.title}</div>}
                      <div style={{ fontSize:10, color:"rgba(255,255,255,0.55)" }}>{fmtLabel(s.time_secs || 0)}{s.pages_read ? ` · ${s.pages_read}pg` : ""}</div>
                      <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:1 }}>{s.date_str}</div>
                    </div>
                    {s.finished && <div style={{ position:"absolute", top:8, right:8, background:"rgba(0,0,0,0.5)", borderRadius:6, padding:"2px 7px", fontSize:9, color:"rgba(255,255,255,0.7)", backdropFilter:"blur(6px)" }}>Finished</div>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign:"center", padding:"50px 0", color:"rgba(255,255,255,0.15)", fontSize:14, fontStyle:"italic", lineHeight:1.7 }}>
              Your reading history<br/>will appear here.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Goals screen ──
  if (screen === SCREENS.GOALS) {
    const [gMin, setGMin] = useState(String(profile.goal_minutes || ""));
    const [gPg,  setGPg]  = useState(String(profile.goal_pages   || ""));
    const [saving, setSaving] = useState(false);
    const saveGoals = async () => {
      setSaving(true);
      await sb.from("profiles").upsert({ id: user.id, goal_minutes: parseInt(gMin) || 0, goal_pages: parseInt(gPg) || 0 });
      await loadProfile(); setSaving(false); setScreen(SCREENS.HOME);
    };
    return (
      <div style={S.app}>
        <div style={S.hdr}>
          <button style={S.back} onClick={() => setScreen(SCREENS.HOME)}>← Back</button>
          <span style={S.sub}>Daily Goals</span>
          <div style={{ width:56 }}/>
        </div>
        <div style={{ padding:"20px 28px 40px" }}>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.35)", marginBottom:32, lineHeight:1.8 }}>
            Set a daily reading goal. The rings on your home screen update as you read each day.
          </div>
          <div style={{ marginBottom:22 }}>
            <label style={S.label}>DAILY TIME GOAL (MINUTES)</label>
            <input style={S.inp} type="number" placeholder="e.g. 30" value={gMin} onChange={e => setGMin(e.target.value)}/>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", marginTop:6 }}>Set to 0 to disable.</div>
          </div>
          <div style={{ marginBottom:32 }}>
            <label style={S.label}>DAILY PAGES GOAL</label>
            <input style={S.inp} type="number" placeholder="e.g. 20" value={gPg} onChange={e => setGPg(e.target.value)}/>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", marginTop:6 }}>Set to 0 to disable.</div>
          </div>
          <div style={{ padding:"20px 20px", background:"rgba(255,255,255,0.03)", borderRadius:14, border:"1px solid rgba(255,255,255,0.06)", marginBottom:28 }}>
            <div style={{ fontSize:10, letterSpacing:3, color:"rgba(255,255,255,0.25)", marginBottom:10 }}>CURRENT STREAK</div>
            <div style={{ fontSize:42, fontWeight:800, letterSpacing:-2, lineHeight:1 }}>{profile.streak}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", marginTop:5 }}>consecutive day{profile.streak !== 1 ? "s" : ""} read</div>
          </div>
          <button style={{ ...S.pBtn, marginTop:0, opacity: saving ? 0.6 : 1 }} onClick={saveGoals} disabled={saving}>{saving ? "Saving…" : "Save Goals"}</button>
        </div>
      </div>
    );
  }

  // ── Timer screen ──
  if (screen === SCREENS.TIMER) {
    const isCD = timerMode === "countdown";
    const dispSec = isCD ? countdownLeft : elapsed;
    const progress = isCD ? (countdownSet > 0 ? 1 - (countdownLeft / countdownSet) : 0) : (elapsed % 3600) / 3600;
    const quote = QUOTES[quoteIdx];
    const sessionActive = timerRunning || elapsed > 0;
    return (
      <div style={S.app}>
        <div style={S.hdr}>
          <button style={S.back} onClick={() => setScreen(SCREENS.HOME)}>← Back</button>
          <span style={S.sub}>Reading Timer</span>
          <div style={{ width:56 }}/>
        </div>
        <div style={{ padding:"0 22px 40px", display:"flex", flexDirection:"column", minHeight:"calc(100vh - 70px)" }}>

          {!sessionActive && !countdownDone && (
            <div style={{ display:"flex", gap:6, marginBottom:20, background:"rgba(255,255,255,0.05)", borderRadius:12, padding:4 }}>
              {[["stopwatch","Stopwatch"],["countdown","Countdown"]].map(([m, label]) => (
                <button key={m} onClick={() => switchMode(m)}
                  style={{ flex:1, padding:"10px 0", borderRadius:10, border:"none", cursor:"pointer", fontSize:13, fontFamily:"inherit", fontWeight:600,
                    background: timerMode === m ? "linear-gradient(135deg,#fff,#aaa)" : "transparent",
                    color: timerMode === m ? "#000" : "rgba(255,255,255,0.4)" }}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {isCD && !sessionActive && !countdownDone && (
            <div style={{ marginBottom:20 }}>
              <div style={{ ...S.label, textAlign:"center" }}>SET DURATION (MINUTES)</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", marginBottom:14 }}>
                {PRESET_MINUTES.map(m => (
                  <button key={m} onClick={() => { setCountdownInput(String(m)); const s = m * 60; setCountdownSet(s); setCountdownLeft(s); }}
                    style={{ padding:"8px 16px", borderRadius:20,
                      border: "1px solid " + (parseInt(countdownInput) === m ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.1)"),
                      background: parseInt(countdownInput) === m ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.04)",
                      color: parseInt(countdownInput) === m ? "#fff" : "rgba(255,255,255,0.6)",
                      cursor:"pointer", fontSize:14, fontFamily:"inherit", fontWeight:600 }}>
                    {m}m
                  </button>
                ))}
              </div>
              <div style={{ display:"flex", gap:8, alignItems:"center", justifyContent:"center" }}>
                <input type="number" value={countdownInput} min="1" max="240"
                  onChange={e => setCountdownInput(e.target.value)} onBlur={applyCountdown}
                  style={{ ...S.inp, width:90, textAlign:"center", padding:"12px 8px", fontSize:20, fontWeight:700 }}/>
                <span style={{ color:"rgba(255,255,255,0.4)", fontSize:15 }}>minutes</span>
              </div>
            </div>
          )}

          {!sessionActive && !countdownDone && (
            <div style={{ marginBottom:20 }}>
              <div style={{ borderRadius:14, border:"1px solid rgba(255,255,255,0.07)", overflow:"hidden", marginBottom:12 }}>
                <button onClick={() => setBookExpanded(!bookExpanded)}
                  style={{ width:"100%", padding:"14px 18px", background:"rgba(255,255,255,0.04)", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", color:"#fff", fontFamily:"inherit" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    {selectedBook?.open_library_cover_id
                      ? <img src={"https://covers.openlibrary.org/b/id/" + selectedBook.open_library_cover_id + "-S.jpg"} crossOrigin="anonymous" style={{ width:28, height:36, borderRadius:4, objectFit:"cover" }}/>
                      : <LogoMark size={20} color="rgba(255,255,255,0.35)"/>}
                    <div style={{ textAlign:"left" }}>
                      <div style={{ fontSize:13, fontWeight:600, color: selectedBook ? "#fff" : "rgba(255,255,255,0.4)" }}>{selectedBook ? selectedBook.title : "Add a book (optional)"}</div>
                      {selectedBook && <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginTop:1 }}>{selectedBook.author_name?.[0]}</div>}
                    </div>
                  </div>
                  <span style={{ color:"rgba(255,255,255,0.3)", fontSize:16, transform: bookExpanded ? "rotate(90deg)" : "none", transition:"transform 0.2s" }}>›</span>
                </button>
                {bookExpanded && (
                  <div style={{ padding:"14px 16px", background:"rgba(0,0,0,0.2)" }}>
                    <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                      <input style={{ ...S.inp, flex:1, padding:"12px 14px" }} placeholder="Search by title or author…"
                        value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && searchBooks()}/>
                      <button onClick={searchBooks} disabled={searchLoading}
                        style={{ padding:"0 16px", borderRadius:12, border:"none",
                          background: searchLoading ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg,#fff,#888)",
                          color: searchLoading ? "#fff" : "#000", cursor: searchLoading ? "default" : "pointer", fontSize:18, flexShrink:0 }}>
                        {searchLoading ? "…" : "→"}
                      </button>
                    </div>
                    {searchLoading && <div style={{ textAlign:"center", color:"rgba(255,255,255,0.4)", fontSize:13, padding:"12px 0" }}>Searching…</div>}
                    {searchError && <div style={{ color:"#f87171", fontSize:13, padding:"8px 0" }}>{searchError}</div>}
                    {searchResults.map((book, i) => (
                      <div key={i} onClick={() => { setSelectedBook(book); setBookExpanded(false); }}
                        style={{ display:"flex", gap:12, alignItems:"center", padding:"10px 0", borderBottom:"1px solid rgba(255,255,255,0.05)", cursor:"pointer" }}>
                        {book.open_library_cover_id
                          ? <img src={"https://covers.openlibrary.org/b/id/" + book.open_library_cover_id + "-S.jpg"} crossOrigin="anonymous" style={{ width:32, height:42, borderRadius:4, objectFit:"cover", flexShrink:0 }}/>
                          : <div style={{ width:32, height:42, borderRadius:4, background:"rgba(255,255,255,0.08)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><LogoMark size={14} color="rgba(255,255,255,0.5)"/></div>}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{book.title}</div>
                          <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginTop:2 }}>{book.author_name?.[0]}</div>
                        </div>
                        <span style={{ color:"rgba(255,255,255,0.2)", fontSize:16 }}>›</span>
                      </div>
                    ))}
                    {selectedBook && <button onClick={() => { setSelectedBook(null); setSearchResults([]); setSearchQuery(""); }}
                      style={{ marginTop:10, background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", fontFamily:"inherit", padding:0 }}>Remove book</button>}
                  </div>
                )}
              </div>
              <label style={S.label}>STARTING PAGE (OPTIONAL)</label>
              <input style={S.inp} type="number" placeholder="What page are you starting on?" value={startingPage} onChange={e => setStartingPage(e.target.value)}/>
            </div>
          )}

          {countdownDone && (
            <div style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:16, padding:"16px 20px", marginBottom:20, textAlign:"center" }}>
              <div style={{ fontWeight:700, fontSize:17, marginBottom:4 }}>Time's up!</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginBottom:14 }}>You read for {fmtLabel(elapsed)}. Keep going?</div>
              <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
                {[5,10,15,20].map(m => (
                  <button key={m} onClick={() => extendCountdown(m)}
                    style={{ padding:"10px 18px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#fff,#aaa)", color:"#000", cursor:"pointer", fontSize:14, fontFamily:"inherit", fontWeight:700 }}>
                    +{m}m
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display:"flex", justifyContent:"center", alignItems:"center", flex:1, marginBottom:24, marginTop: sessionActive ? 0 : 8 }}>
            <div style={{ position:"relative", display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
              <svg width={240} height={240} style={{ transform:"rotate(-90deg)" }}>
                <circle cx={120} cy={120} r={104} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={7}/>
                <circle cx={120} cy={120} r={104} fill="none" stroke="url(#tg)" strokeWidth={7}
                  strokeDasharray={2 * Math.PI * 104} strokeDashoffset={2 * Math.PI * 104 * (1 - Math.min(progress, 1))} strokeLinecap="round"/>
                <defs><linearGradient id="tg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#fff"/><stop offset="100%" stopColor="#444"/></linearGradient></defs>
              </svg>
              <div style={{ position:"absolute", textAlign:"center" }}>
                <div style={{ fontSize:42, fontWeight:700, letterSpacing:-2, lineHeight:1, fontFamily:"'Times New Roman',Times,serif", color:"#fff" }}>{fmt(dispSec)}</div>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", letterSpacing:3, marginTop:6 }}>
                  {countdownDone ? "COMPLETE" : timerRunning ? (isCD ? "COUNTING DOWN" : "READING") : elapsed > 0 ? "PAUSED" : "READY"}
                </div>
                {selectedBook && <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", marginTop:4, maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{selectedBook.title}</div>}
              </div>
            </div>
          </div>

          {!countdownDone && (
            <div style={{ display:"flex", gap:12, marginBottom:12 }}>
              <button onClick={() => setTimerRunning(!timerRunning)}
                style={{ flex:1, padding:"17px", borderRadius:14, border:"none", cursor:"pointer", fontSize:16, fontFamily:"inherit", fontWeight:700,
                  background: timerRunning ? "rgba(255,255,255,0.07)" : "linear-gradient(135deg,#fff,#888)",
                  color: timerRunning ? "#fff" : "#000" }}>
                {timerRunning ? "Pause" : elapsed > 0 ? "Resume" : "Start"}
              </button>
              {elapsed > 0 && (
                <button onClick={stopSession}
                  style={{ flex:1, padding:"17px", borderRadius:14, border:"1px solid rgba(255,255,255,0.1)", cursor:"pointer", fontSize:16, fontFamily:"inherit", fontWeight:700, background:"none", color:"#fff" }}>
                  Finish
                </button>
              )}
            </div>
          )}
          {countdownDone && <button onClick={stopSession} style={{ ...S.pBtn, marginTop:0 }}>Log This Session</button>}
          {elapsed > 0 && !timerRunning && !countdownDone && (
            <button style={{ ...S.gBtn, marginTop:0, color:"rgba(255,255,255,0.3)", fontSize:13 }}
              onClick={() => { setElapsed(0); setTimerRunning(false); if (isCD) setCountdownLeft(countdownSet); }}>Reset</button>
          )}

          {!sessionActive && (
            <div style={{ marginTop:24, padding:"16px 18px", background:"rgba(255,255,255,0.03)", borderRadius:14, border:"1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", lineHeight:1.7, fontStyle:"italic", marginBottom:6 }}>"{quote.text}"</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", letterSpacing:1 }}>— {quote.author}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Camera / Log screen ──
  if (screen === SCREENS.CAMERA) return (
    <div style={S.app}>
      <div style={S.hdr}>
        <button style={S.back} onClick={() => setScreen(SCREENS.TIMER)}>← Back</button>
        <span style={S.sub}>Log & Share</span>
        <div style={{ width:56 }}/>
      </div>
      <div style={{ padding:"8px 22px 36px" }}>
        <div style={{ textAlign:"center", marginBottom:28, paddingTop:8 }}>
          <div style={{ fontWeight:700, fontSize:32, fontFamily:"'Times New Roman',Times,serif", lineHeight:1 }}>{fmtLabel(sessionTime)}</div>
          <div style={{ color:"rgba(255,255,255,0.4)", fontSize:13, marginTop:6, letterSpacing:1 }}>reading session complete</div>
        </div>
        <div style={{ marginBottom:14 }}>
          <label style={S.label}>{startingPage ? "ENDING PAGE (started on p." + startingPage + ")" : "ENDING PAGE"}</label>
          <input style={{ ...S.inp, maxWidth:200 }} type="number" placeholder="Ending page" value={currentPage} onChange={e => setCurrentPage(e.target.value)}/>
          {pagesRead && parseInt(currentPage) > parseInt(startingPage) && (
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", marginTop:6, paddingLeft:4 }}>{pagesRead} pages read this session</div>
          )}
        </div>
        {!startingPage && (
          <div style={{ marginBottom:14 }}>
            <label style={S.label}>PAGES READ (OPTIONAL)</label>
            <input style={S.inp} type="number" placeholder="How many pages did you read?" value={manualPages} onChange={e => setManualPages(e.target.value)}/>
          </div>
        )}
        <div onClick={() => setBookFinished(!bookFinished)}
          style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 18px", borderRadius:14, marginBottom:22, cursor:"pointer", userSelect:"none",
            border: "1px solid " + (bookFinished ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.08)"),
            background: bookFinished ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)" }}>
          <div style={{ width:24, height:24, borderRadius:6, border: "2px solid " + (bookFinished ? "#fff" : "rgba(255,255,255,0.2)"),
            background: bookFinished ? "#fff" : "transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            {bookFinished && <span style={{ fontSize:13, lineHeight:1, color:"#000", fontWeight:700 }}>✓</span>}
          </div>
          <div>
            <div style={{ fontWeight:600, fontSize:15 }}>I finished this book!</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", marginTop:2 }}>This will be called out on your share card</div>
          </div>
        </div>
        <label style={{ ...S.label, marginBottom:12 }}>BACKGROUND PHOTO</label>
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} style={{ display:"none" }}/>
        <input ref={fileInputRef}   type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display:"none" }}/>
        <button style={{ ...S.pBtn, marginTop:0 }} onClick={() => cameraInputRef.current.click()}>Take Photo</button>
        <button style={S.gBtn} onClick={() => fileInputRef.current.click()}>Choose from Library</button>
        <button style={{ ...S.gBtn, color:"rgba(255,255,255,0.35)", fontSize:13 }}
          onClick={() => { setPhoto(null); setPhotoFile(null); setShowSwipeTip(true); setScreen(SCREENS.COMPOSE); }}>
          Skip — use gradient background
        </button>
      </div>
    </div>
  );

  // ── Compose screen ──
  if (screen === SCREENS.COMPOSE) {
    const isStory = cardFormat === "story";
    const previewW = 382, previewH = isStory ? Math.round(previewW * (16 / 9)) : previewW;
    const ActiveCard = TEMPLATES[tIdx]?.Component || CardBalanced;
    return (
      <div style={S.app}>
        <div style={S.hdr}>
          <button style={S.back} onClick={() => setScreen(SCREENS.CAMERA)}>← Back</button>
          <span style={S.sub}>Compose Card</span>
          <div style={{ width:56 }}/>
        </div>
        <div style={{ padding:"8px 22px 40px" }}>
          <div style={{ display:"flex", gap:6, marginBottom:14, background:"rgba(255,255,255,0.05)", borderRadius:12, padding:4 }}>
            {[["square","Square (1:1)"],["story","Story (9:16)"]].map(([val, label]) => (
              <button key={val} onClick={() => setCardFormat(val)}
                style={{ flex:1, padding:"9px 0", borderRadius:10, border:"none", cursor:"pointer", fontSize:13, fontFamily:"inherit", fontWeight:600,
                  background: cardFormat === val ? "linear-gradient(135deg,#fff,#888)" : "transparent",
                  color: cardFormat === val ? "#000" : "rgba(255,255,255,0.4)" }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <span style={{ fontSize:10, letterSpacing:3, color:"rgba(255,255,255,0.3)" }}>TEMPLATE</span>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              {TEMPLATES.map((t, i) => (
                <div key={t.id} onClick={() => setSelectedTemplate(t.id)}
                  style={{ width: i === tIdx ? 18 : 6, height:6, borderRadius:3, background: i === tIdx ? "#fff" : "rgba(255,255,255,0.25)", cursor:"pointer", transition:"all 0.2s" }}/>
              ))}
            </div>
            <span style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontStyle:"italic" }}>{TEMPLATES[tIdx]?.label}</span>
          </div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", textAlign:"center", marginBottom:10 }}>Drag to reposition · Pinch or scroll to resize</div>
          <div ref={el => { previewRef.current = el; }}
            style={{ position:"relative", width:previewW, height:previewH, borderRadius:16, overflow:"hidden", border:"1px solid rgba(255,255,255,0.08)", cursor:"grab", touchAction:"none", background:"#0a0a14" }}
            onTouchStart={e => { onTouchStart(e); onCarouselTouchStart(e); }}
            onTouchEnd={e => { onTouchEnd(e); onCarouselTouchEnd(e); }}
            onTouchMove={onTouchMove}
            onMouseDown={e => { onMouseDown(e); onCarouselMouseDown(e); }}
            onMouseUp={e => { onMouseUp(); onCarouselMouseUp(e); }}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}>
            {photo
              ? <img src={photo} style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none", userSelect:"none" }} draggable={false}/>
              : <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg,#0f0c29,#302b63,#24243e)", pointerEvents:"none" }}/>
            }
            <div style={{ position:"absolute", left: cardPos.x * previewW, top: cardPos.y * previewH, transform:"translate(-50%,-50%)", pointerEvents:"none", willChange:"transform" }}>
              <ActiveCard book={selectedBook} sessionTime={sessionTime} pagesRead={pagesRead} currentPage={currentPage} bookFinished={bookFinished} scale={cardScale}/>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:12, padding:"0 2px" }}>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }}>A</span>
            <input type="range" min="0.4" max="2.5" step="0.05" value={cardScale} onChange={e => setCardScale(parseFloat(e.target.value))} style={{ flex:1, accentColor:"#fff" }}/>
            <span style={{ fontSize:16, color:"rgba(255,255,255,0.3)" }}>A</span>
          </div>
          <canvas ref={exportCanvasRef} style={{ display:"none" }}/>
          <button style={S.pBtn} onClick={exportCard} disabled={exporting}>{exporting ? "Rendering…" : "Export Image"}</button>
          <button style={{ ...S.gBtn, opacity: savingSession ? 0.6 : 1 }} onClick={saveSession} disabled={savingSession}>{savingSession ? "Saving…" : "Log My Reading"}</button>
          <p style={{ textAlign:"center", marginTop:16, fontSize:12, color:"rgba(255,255,255,0.2)" }}>Export and share on Instagram, Twitter, or anywhere</p>
        </div>
        {showSwipeTip && (
          <div style={{ position:"fixed", bottom:32, left:"50%", transform:"translateX(-50%)", background:"rgba(255,255,255,0.12)", backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)", borderRadius:24, padding:"10px 20px", fontSize:13, color:"#fff", whiteSpace:"nowrap", pointerEvents:"none", letterSpacing:0.3 }}>
            Swipe the preview to change templates
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ── Goals screen ──
  if (screen === SCREENS.GOALS) {
    const saveGoals = async () => {
      setGoalsSaving(true);
      await sb.from("profiles").upsert({ id: user.id, goal_minutes: parseInt(gMin) || 0, goal_pages: parseInt(gPg) || 0 });
      await loadProfile(); setGoalsSaving(false); setScreen(SCREENS.HOME);
    };
    return (
      <div style={S.app}>
        <div style={S.hdr}>
          <button style={S.back} onClick={() => setScreen(SCREENS.HOME)}>← Back</button>
          <span style={S.sub}>Daily Goals</span>
          <div style={{ width:56 }}/>
        </div>
        <div style={{ padding:"20px 28px 40px" }}>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.35)", marginBottom:32, lineHeight:1.8 }}>
            Set a daily reading goal. The rings on your home screen update as you read each day.
          </div>
          <div style={{ marginBottom:22 }}>
            <label style={S.label}>DAILY TIME GOAL (MINUTES)</label>
            <input style={S.inp} type="number" placeholder="e.g. 30" value={gMin} onChange={e => setGMin(e.target.value)}/>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", marginTop:6 }}>Set to 0 to disable.</div>
          </div>
          <div style={{ marginBottom:32 }}>
            <label style={S.label}>DAILY PAGES GOAL</label>
            <input style={S.inp} type="number" placeholder="e.g. 20" value={gPg} onChange={e => setGPg(e.target.value)}/>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", marginTop:6 }}>Set to 0 to disable.</div>
          </div>
          <div style={{ padding:"20px 20px", background:"rgba(255,255,255,0.03)", borderRadius:14, border:"1px solid rgba(255,255,255,0.06)", marginBottom:28 }}>
            <div style={{ fontSize:10, letterSpacing:3, color:"rgba(255,255,255,0.25)", marginBottom:10 }}>CURRENT STREAK</div>
            <div style={{ fontSize:42, fontWeight:800, letterSpacing:-2, lineHeight:1 }}>{profile.streak}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", marginTop:5 }}>consecutive day{profile.streak !== 1 ? "s" : ""} read</div>
          </div>
          <button style={{ ...S.pBtn, marginTop:0, opacity: goalsSaving ? 0.6 : 1 }} onClick={saveGoals} disabled={goalsSaving}>
            {goalsSaving ? "Saving…" : "Save Goals"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
ReactDOM.createRoot(document.getElementById("root")).render(<Bookmark/>);
