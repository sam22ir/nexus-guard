import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  ArrowRight,
  Check,
  FolderSimple,
  Graph,
  LinkSimple,
  List,
  ListChecks,
  Moon,
  Sun,
  Plugs,
  Pulse,
  Rocket,
  Sparkle,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { flushSync } from "react-dom";
import {
  siAlgolia, siAsana, siAuth0, siClaude, siClerk, siCloudflare, siCloudinary, siConfluence,
  siConvex, siCursor, siDatadog, siDigitalocean, siDiscord, siElevenlabs, siFigma, siFirebase,
  siFlydotio, siGithub, siGithubcopilot, siGitlab, siGoogledrive, siGooglegemini, siGrafana,
  siHuggingface, siJira, siLemonsqueezy, siLinear, siMixpanel, siMongodb, siNeon, siNetlify,
  siNotion, siOpencode, siPaddle, siPaypal, siPlanetscale, siPosthog, siRailway, siRender,
  siReplicate, siResend, siSanity, siSentry, siStripe, siSupabase, siTurso, siUpstash, siVercel,
  siWindsurf,
} from "simple-icons";
import "./theme.css";
import "./App.css";

/* --------------------------------------------------------------------------
   Source of truth: Notion "Nexus — Product & Technical Strategy".
   Keep this page aligned with the paper. Where they differ, the paper wins.
   -------------------------------------------------------------------------- */

/* ---------- Theme: system by default, manual toggle (paper §11) ---------- */
type Theme = "light" | "dark";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const attr = document.documentElement.dataset.theme;
    return attr === "light" || attr === "dark" ? attr : systemTheme();
  });

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("nexus-theme");
    } catch {
      /* storage unavailable: follow the system */
    }
    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.theme = stored;
      setTheme(stored);
    }
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => {
      const attr = document.documentElement.dataset.theme;
      setTheme(attr === "light" || attr === "dark" ? attr : systemTheme());
    };
    /* Follow the system setting, and also follow the page itself if its
       data-theme attribute ever changes from outside React, so the logo and
       toggle icon can never disagree with what is on screen. */
    mq.addEventListener("change", sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", sync);
      observer.disconnect();
    };
  }, []);

  /* Circular reveal from the toggle (View Transitions API). Other browsers get
     a short colour cross-fade; reduced motion switches instantly. */
  function toggle(x?: number, y?: number) {
    const root = document.documentElement;
    const shown = root.dataset.theme === "light" || root.dataset.theme === "dark" ? root.dataset.theme : systemTheme();
    const next: Theme = shown === "dark" ? "light" : "dark";
    const apply = () => {
      root.dataset.theme = next;
      setTheme(next);
    };
    try {
      localStorage.setItem("nexus-theme", next);
    } catch {
      /* ignore */
    }

    if (REDUCED()) return apply();

    const start = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
    if (start && x !== undefined && y !== undefined) {
      root.style.setProperty("--tx", `${x}px`);
      root.style.setProperty("--ty", `${y}px`);
      start.call(document, () => flushSync(apply));
    } else {
      root.classList.add("theme-fade");
      apply();
      window.setTimeout(() => root.classList.remove("theme-fade"), 450);
    }
  }

  return { theme, toggle };
}

/* ---------- Motion helpers ---------- */
const REDUCED = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Scroll reveal: hidden state is only applied once JS runs, so the
   no-JS and pre-hydration page is fully visible. */
function useScrollReveal() {
  useEffect(() => {
    if (REDUCED() || !("IntersectionObserver" in window)) return;
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(
        "main > section:not(.hero) .section-head, main > section:not(.hero) .card, .prob-head, .prob-points > div, .chain, .neq div, .demo-left > *, .link-demo > *, .agent-facts > *, .plan-card, .sim-scenarios, .cat-toolbar, .chips, .term-table",
      ),
    );
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    els.forEach((el) => {
      const idx = el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : 0;
      el.style.setProperty("--d", `${Math.min(idx, 5) * 70}ms`);
      el.classList.add("reveal");
      io.observe(el);
    });
    return () => io.disconnect();
  }, []);
}

/* Which section is under the reading line, plus page scroll progress. */
function useScrollSpy(ids: string[], barRef: RefObject<HTMLDivElement | null>) {
  const [active, setActive] = useState<string>("");
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id);
        });
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const p = max > 0 ? window.scrollY / max : 0;
        if (barRef.current) barRef.current.style.transform = `scaleX(${p})`;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ids, barRef]);
  return active;
}

/* ---------- Small helpers ---------- */
const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#routing", label: "See it work" },
  { href: "#services", label: "Services" },
  { href: "#agents", label: "Agents" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

/* ---------- Nav ---------- */
function Navbar({
  theme,
  onToggleTheme,
  active,
  barRef,
}: {
  theme: Theme;
  onToggleTheme: (x?: number, y?: number) => void;
  active: string;
  barRef: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="nav">
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="container nav-inner">
        <a href="#" className="brand" aria-label="Nexus home">
          <img src={theme === "dark" ? "/nexus-symbol.png" : "/nexus-symbol-dark.png"} alt="" />
          <span>Nexus</span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={active === n.href.slice(1) ? "active" : ""}>{n.label}</a>
          ))}
        </nav>
        <div className="nav-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onToggleTheme(r.left + r.width / 2, r.top + r.height / 2);
            }}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <a href="#waitlist" className="btn btn-primary nav-cta">Get notified</a>
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={16} /> : <List size={16} />}
          </button>
        </div>
      </div>
      <div className="progress" ref={barRef} aria-hidden="true" />
      <nav className={`mobile-panel ${open ? "open" : ""}`} aria-label="Mobile">
        {NAV.map((n) => (
          <a key={n.href} href={n.href} onClick={() => setOpen(false)}>{n.label}</a>
        ))}
        <a href="#waitlist" onClick={() => setOpen(false)}>Get notified</a>
      </nav>
    </header>
  );
}

/* --------------------------------------------------------------------------
   Topology: fixed columns, agents | projects | service accounts (paper §12).
   Read-only illustration. Line colors are status only.
   -------------------------------------------------------------------------- */
type ProjectName = "Koupa" | "Nabdh";

const T_AGENTS: { id: string; name: string; sub: string; project: ProjectName; y: number }[] = [
  { id: "claude", name: "Claude Code", sub: "session 1", project: "Koupa", y: 70 },
  { id: "codex", name: "Codex", sub: "session 2", project: "Nabdh", y: 170 },
  { id: "opencode", name: "OpenCode", sub: "session 3", project: "Nabdh", y: 270 },
];
const T_PROJECTS: { name: ProjectName; sub: string; y: number }[] = [
  { name: "Koupa", sub: "production", y: 110 },
  { name: "Nabdh", sub: "development", y: 240 },
];
const T_SERVICES: { id: string; name: string; sub: string; tier: "BUILT-IN" | "CATALOG"; project: ProjectName; y: number }[] = [
  { id: "k-sb", name: "Supabase · Personal", sub: "koupa-production", tier: "BUILT-IN", project: "Koupa", y: 50 },
  { id: "k-gh", name: "GitHub · Personal", sub: "koupa", tier: "BUILT-IN", project: "Koupa", y: 130 },
  { id: "n-sb", name: "Supabase · Client", sub: "nabdh-development", tier: "BUILT-IN", project: "Nabdh", y: 210 },
  { id: "n-cv", name: "Convex · Personal", sub: "nabdh-backend", tier: "CATALOG", project: "Nabdh", y: 290 },
];

const AX = 10, PX = 240, SX = 470, W = 180, H = 56;

function edge(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

const FEED: { text: string; tone: "green" | "red" }[] = [
  { text: "Claude Code → Koupa → koupa-production · sent", tone: "green" },
  { text: "Codex → Nabdh → nabdh-development · sent", tone: "green" },
  { text: "Codex asked for koupa-production · refused, it belongs to Koupa", tone: "red" },
  { text: "OpenCode → Nabdh → nabdh-backend · sent", tone: "green" },
  { text: "Agent in an unknown folder · refused, not a registered project", tone: "red" },
];

/* One data packet travelling along an edge. Visible only during its window of
   the cycle so agent → project and project → service read as one journey. */
function Packet({ d, begin, from, to, color = "var(--green)" }: { d: string; begin: number; from: number; to: number; color?: string }) {
  return (
    <circle className="t-packet" r="3.5" fill={color} opacity="0">
      <animate attributeName="opacity" values="0;1;0" keyTimes={`0;${from};${to}`} calcMode="discrete" dur="3.6s" begin={`${begin}s`} repeatCount="indefinite" />
      <animateMotion
        dur="3.6s"
        begin={`${begin}s`}
        repeatCount="indefinite"
        path={d}
        keyPoints={`0;0;1;1`}
        keyTimes={`0;${from};${to};1`}
        calcMode="linear"
      />
    </circle>
  );
}

function Topology() {
  const [focus, setFocus] = useState<ProjectName | null>(null);
  const [attempt, setAttempt] = useState(false);
  const [feedIdx, setFeedIdx] = useState(0);

  useEffect(() => {
    if (REDUCED()) return;
    const id = setInterval(() => setFeedIdx((i) => (i + 1) % FEED.length), 2600);
    return () => clearInterval(id);
  }, []);

  const projY = (n: ProjectName) => T_PROJECTS.find((p) => p.name === n)!.y;
  const dimProject = (n: ProjectName) => focus !== null && focus !== n;
  const koupaSb = T_SERVICES[0];

  return (
    <div className="card topo">
      <div className="topo-bar">
        <span className="label">Example map</span>
        <div className="seg" role="group" aria-label="Scenario">
          <button type="button" aria-pressed={!attempt} onClick={() => setAttempt(false)}>Normal</button>
          <button type="button" aria-pressed={attempt} onClick={() => setAttempt(true)}>Wrong project</button>
        </div>
      </div>

      <div className="topo-scroll">
      <svg viewBox="0 0 660 340" role="img" aria-label="Three agents connect to two projects, each bound to its own service accounts. Nexus routes each agent to its own project's resources.">
        <text className="t-col" x={AX} y="16">AGENTS</text>
        <text className="t-col" x={PX} y="16">PROJECTS</text>
        <text className="t-col" x={SX} y="16">SERVICE ACCOUNTS</text>

        {T_AGENTS.map((a) => (
          <path
            key={a.id}
            className={`t-line green ${dimProject(a.project) ? "dim" : ""}`}
            d={edge(AX + W, a.y, PX, projY(a.project))}
          />
        ))}
        {T_SERVICES.map((s) => (
          <path
            key={s.id}
            className={`t-line green ${dimProject(s.project) ? "dim" : ""}`}
            d={edge(PX + W, projY(s.project), SX, s.y)}
          />
        ))}
        {T_AGENTS.filter((a) => !dimProject(a.project)).map((a, i) => (
          <Packet key={`pa-${a.id}`} d={edge(AX + W, a.y, PX, projY(a.project))} begin={i * 0.9} from={0.02} to={0.45} />
        ))}
        {T_SERVICES.filter((s) => !dimProject(s.project)).map((s, i) => (
          <Packet key={`ps-${s.id}`} d={edge(PX + W, projY(s.project), SX, s.y)} begin={i * 0.9} from={0.5} to={0.95} />
        ))}
        {attempt && (
          <g>
            <path id="refused-path" className="t-line red" d={edge(PX + W, projY("Nabdh"), SX, koupaSb.y + 12)} />
            <circle className="t-packet" r="3.5" fill="var(--red)" opacity="0">
              <animate attributeName="opacity" values="0;1;0" keyTimes="0;0.02;0.62" calcMode="discrete" dur="3.6s" repeatCount="indefinite" />
              <animateMotion dur="3.6s" repeatCount="indefinite" path={edge(PX + W, projY("Nabdh"), SX, koupaSb.y + 12)} keyPoints="0;0;0.55;0.55" keyTimes="0;0.02;0.55;1" calcMode="linear" />
            </circle>
            <text className="t-x" textAnchor="middle" dominantBaseline="central" opacity="0">
              ✕
              <animate attributeName="opacity" values="0;1;0" keyTimes="0;0.56;0.95" calcMode="discrete" dur="3.6s" repeatCount="indefinite" />
              <animateMotion dur="3.6s" repeatCount="indefinite" path={edge(PX + W, projY("Nabdh"), SX, koupaSb.y + 12)} keyPoints="0.56;0.56" keyTimes="0;1" calcMode="linear" />
            </text>
            <text className="t-tag red" x={PX + W + 26} y={172}>REFUSED BEFORE ANY CALL</text>
          </g>
        )}

        {T_AGENTS.map((a) => (
          <g key={a.id} className={`t-node ${dimProject(a.project) ? "dim" : ""}`}>
            <rect className="t-card" x={AX} y={a.y - H / 2} width={W} height={H} rx="12" />
            <rect className="t-ic-a" x={AX + 12} y={a.y - 12} width="24" height="24" rx="6" />
            <text className="t-name" x={AX + 46} y={a.y - 3}>{a.name}</text>
            <text className="t-sub" x={AX + 46} y={a.y + 13}>{a.sub} · {a.project}</text>
          </g>
        ))}

        {T_PROJECTS.map((p) => (
          <g
            key={p.name}
            className={`t-node ${dimProject(p.name) ? "dim" : ""}`}
            role="button"
            tabIndex={0}
            aria-pressed={focus === p.name}
            aria-label={`Focus ${p.name}`}
            style={{ cursor: "pointer" }}
            onClick={() => setFocus(focus === p.name ? null : p.name)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFocus(focus === p.name ? null : p.name);
              }
            }}
          >
            <rect className={`t-card ${focus === p.name ? "focus" : ""}`} x={PX} y={p.y - H / 2} width={W} height={H} rx="12" />
            <rect className="t-ic-p" x={PX + 12} y={p.y - 12} width="24" height="24" rx="6" />
            <text className="t-name" x={PX + 46} y={p.y - 3}>{p.name}</text>
            <text className="t-sub" x={PX + 46} y={p.y + 13}>{p.sub}</text>
          </g>
        ))}

        {T_SERVICES.map((s) => (
          <g key={s.id} className={`t-node ${dimProject(s.project) ? "dim" : ""}`}>
            <rect className="t-card" x={SX} y={s.y - H / 2} width={W} height={H} rx="12" />
            <rect className="t-ic-s" x={SX + 12} y={s.y - 12} width="24" height="24" rx="6" />
            <text className="t-name" x={SX + 46} y={s.y - 3}>{s.name}</text>
            <text className="t-sub" x={SX + 46} y={s.y + 13}>{s.sub}</text>
            <text className={`t-tag ${s.tier === "BUILT-IN" ? "green" : "faint"}`} x={SX + W - 8} y={s.y - H / 2 + 12} textAnchor="end">{s.tier}</text>
          </g>
        ))}
      </svg>
      </div>

      <div className="topo-foot">
        <span><i className="dot green" /> sent</span>
        <span><i className="dot" style={{ background: "var(--red)" }} /> refused</span>
        <span className="muted">Click a project to focus it.</span>
      </div>
      <div className="feed" aria-live="off">
        <span className="label">Activity</span>
        <span key={feedIdx} className={`feed-line ${FEED[feedIdx].tone}`}>
          <i className="dot" style={{ background: FEED[feedIdx].tone === "green" ? "var(--green)" : "var(--red)" }} />
          {FEED[feedIdx].text}
        </span>
      </div>
    </div>
  );
}

/* ---------- Flipping logos in the headline ---------- */
type Logo = { name: string; path: string; color?: string };

/* Use the real brand colour when it reads on both themes. Black and
   near-black brands fall back to the theme's text colour. */
function brand(name: string, icon: { path: string; hex: string }): Logo {
  const n = parseInt(icon.hex, 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return { name, path: icon.path, color: lum > 0.28 ? `#${icon.hex}` : undefined };
}

/* Codex has no mark in the icon set, so it gets a plain terminal prompt. */
const CODEX_PATH = "M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1.7 4.3a1 1 0 0 0-.1 1.4L8.2 11l-2.6 2.3a1 1 0 1 0 1.3 1.5l3.4-3a1 1 0 0 0 0-1.5l-3.4-3a1 1 0 0 0-1.2 0zM12 15a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2z";

const AGENT_LOGOS: Logo[] = [
  brand("Claude Code", siClaude),
  { name: "Codex", path: CODEX_PATH },
  brand("OpenCode", siOpencode),
  brand("Gemini", siGooglegemini),
  brand("Cursor", siCursor),
  brand("Windsurf", siWindsurf),
  brand("Copilot", siGithubcopilot),
];

const SERVICE_LOGOS: Logo[] = [
  brand("Supabase", siSupabase),
  brand("Stripe", siStripe),
  brand("Cloudflare", siCloudflare),
  brand("Convex", siConvex),
  brand("GitHub", siGithub),
  brand("Clerk", siClerk),
  brand("Linear", siLinear),
  brand("Vercel", siVercel),
  brand("Figma", siFigma),
  brand("Neon", siNeon),
];

function LogoFlip({ logos, label, offset = 0 }: { logos: Logo[]; label: string; offset?: number }) {
  const [i, setI] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);

  useEffect(() => {
    if (REDUCED()) return;
    let id = 0;
    const start = window.setTimeout(() => {
      id = window.setInterval(() => {
        setI((cur) => {
          setPrev(cur);
          return (cur + 1) % logos.length;
        });
      }, 2400);
    }, offset);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(id);
    };
  }, [logos.length, offset]);

  const face = (idx: number, cls: string) => (
    <span key={`${idx}-${cls}`} className={`flip-face ${cls}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" style={logos[idx].color ? { fill: logos[idx].color } : undefined}>
        <path d={logos[idx].path} />
      </svg>
    </span>
  );

  return (
    <span className="flip" role="img" aria-label={label} title={logos[i].name}>
      {prev !== null && face(prev, "out")}
      {face(i, prev !== null ? "in" : "")}
    </span>
  );
}

/* ---------- Hero ---------- */
function Hero() {
  return (
    <section className="hero" id="top">
      <div className="container hero-grid">
        <div>
          <h1 aria-label="Connect your agents once. Link your services once.">
            {["Connect your", "@agents", "Link your", "@services"].map((w, i) => (
              <span key={i} aria-hidden="true">
                <span className="word" style={{ ["--i" as string]: i }}>
                  {w === "@agents" ? <><LogoFlip logos={AGENT_LOGOS} label="agents" /> agents once.</> : w === "@services" ? <><LogoFlip logos={SERVICE_LOGOS} label="services" offset={1200} /> services once.</> : w}
                </span>{" "}
              </span>
            ))}
          </h1>
          <p className="lead">
            Nexus sits between your coding agents and your services. It sends each agent to its own project's account, so an agent working on one project can't touch another's.
          </p>
          <div className="cta-row">
            <a href="#waitlist" className="btn btn-primary">Get notified <ArrowRight size={14} weight="bold" /></a>
            <a href="#routing" className="btn">See how it works</a>
          </div>
          <p className="fine">
            Made for one developer running several agents across several projects.
          </p>
        </div>
        <Topology />
      </div>
    </section>
  );
}

/* ---------- Problem ---------- */
function Problem() {
  const today = [
    { k: "cmd", t: "$ cd ~/Projects/Koupa" },
    { k: "cmd", t: "agent › update the users table" },
    { k: "dim", t: "→ found SUPABASE_KEY in a nearby .env" },
    { k: "bad", t: "→ project: nabdh-development" },
    { k: "bad", t: "✕ Changed the wrong database. No warning." },
  ];
  const withNexus = [
    { k: "cmd", t: "$ cd ~/Projects/Koupa" },
    { k: "cmd", t: "agent › update the users table" },
    { k: "dim", t: "→ Nexus: project Koupa, stage production" },
    { k: "ok", t: "→ account Personal · koupa-production" },
    { k: "ok", t: "✓ Right database. The agent never saw a key." },
  ];
  const points = [
    ["Setup is copied into every project", "Each agent uses whatever keys happen to be nearby."],
    ["Nothing checks which project it is in", "An agent working on Koupa can change Nabdh's database."],
    ["The agent holds the keys", "Once it has them, nobody can stop a mistake."],
  ];
  const pane = (label: string, tone: "bad" | "ok", lines: { k: string; t: string }[]) => (
    <div className={`pane pane-${tone}`}>
      <div className="pane-bar"><i className={`dot ${tone === "ok" ? "green" : ""}`} style={tone === "bad" ? { background: "var(--red)" } : undefined} /><span className="label">{label}</span></div>
      <div className="pane-body">
        {lines.map((l, i) => (
          <div key={i} className={`ln ln-${l.k}`} style={{ ["--n" as string]: i }}>{l.t}</div>
        ))}
      </div>
    </div>
  );

  return (
    <section className="section problem" id="problem">
      <div className="container">
        <div className="prob-head">
          <span className="label">The problem</span>
          <h2>One agent. The wrong project's keys.</h2>
          <p>
            Every project has its own database, logins and keys. Agents grab whatever they find, so one wrong guess means the wrong database, or production instead of development.
          </p>
        </div>

        <div className="scene card">
          {pane("Today", "bad", today)}
          <span className="vs" aria-hidden="true">vs</span>
          {pane("With Nexus", "ok", withNexus)}
        </div>

        <div className="prob-points">
          {points.map(([t, d], i) => (
            <div key={t}>
              <span className="num">0{i + 1}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- How it works ---------- */
const CHAIN = ["Agent", "Project", "Account", "Resource"];

const HOW_STEPS = [
  { t: "The agent asks", d: "Your agent asks Nexus for a service, like Supabase. It doesn't pick the project or the keys." },
  { t: "Nexus checks", d: "Nexus works out which project the agent is in, then finds the account and resource linked to that project. If it can't tell, or the project isn't registered, it says no." },
  { t: "Nexus makes the call", d: "Nexus sends the request with that account's login and passes the result back. The agent never sees the key." },
];

function HowItWorks() {
  const [lit, setLit] = useState(-1);
  const chainRef = useRef<HTMLDivElement>(null);

  /* Walk the chain link by link while it is on screen, then rest, then repeat. */
  useEffect(() => {
    if (REDUCED() || !chainRef.current) return;
    let timer = 0;
    const tick = () => setLit((n) => (n >= CHAIN.length + 2 ? -1 : n + 1));
    const io = new IntersectionObserver(([e]) => {
      window.clearInterval(timer);
      if (e.isIntersecting) timer = window.setInterval(tick, 480);
    });
    io.observe(chainRef.current);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="section" id="how">
      <div className="container">
        <div className="section-head">
          <span className="label">How it works</span>
          <h2>Nexus picks the right account for you.</h2>
          <p className="lead">
            Every agent talks only to Nexus. Nexus follows one short path for each request.
          </p>
        </div>

        <div className="chain" aria-label="Agent, then project, then account, then resource" ref={chainRef}>
          {CHAIN.map((c, i) => (
            <span key={c} style={{ display: "contents" }}>
              <span className={`chip ${i <= lit ? "lit" : ""}`}>{c}</span>
              {i < CHAIN.length - 1 && <span className={`arrow ${i < lit ? "lit" : ""}`} aria-hidden="true">→</span>}
            </span>
          ))}
        </div>
        <p className="fine" style={{ marginTop: -4, marginBottom: 28 }}>
          A resource is the exact thing inside an account, like one Supabase project.
        </p>

        <div className="grid grid-3">
          {HOW_STEPS.map((s, i) => (
            <div className="card" key={s.t}>
              <span className="step-num">0{i + 1}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3>Same service, different project, different account</h3>
          <p>
            Koupa and Nabdh can both use Supabase and still get separate accounts. Production and development stay separate too, even inside one project.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------- Get started ---------- */
function Setup() {
  const steps = [
    { t: "Add a project", d: "Pick its folder. Nexus saves a small file, .nexus/project.json, with no secrets in it." },
    { t: "Link an account", d: "Sign in to Supabase or GitHub once. Your login is kept in your computer's secure storage." },
    { t: "Connect an agent", d: "Run one command so the agent talks to Nexus. Nexus tests the connection." },
    { t: "Watch it work", d: "Make a test call and see it reach the right place on the live map." },
  ];
  return (
    <section className="section" id="setup">
      <div className="container">
        <div className="section-head">
          <span className="label">Get started</span>
          <h2>Four steps to your first call.</h2>
          <p className="lead">The app walks you through these the first time you open it.</p>
        </div>
        <div className="grid grid-4">
          {steps.map((s, i) => (
            <div className="card" key={s.t}>
              <span className="step-num">0{i + 1}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Routing examples ---------- */
type NodeState = "ok" | "fail" | "warn";
type Scenario = {
  id: string;
  title: string;
  blurb: string;
  tone: "green" | "red" | "amber";
  badge: string;
  /* The four stops on the path. The first node that is not "ok" stops the
     request, so anything after it is never reached. */
  nodes: { label: string; name: string; sub: string; s: NodeState }[];
  outcome: string;
  why: string;
  request: string;
  response: string;
};

const SCENARIOS: Scenario[] = [
  {
    id: "ok",
    title: "Right project",
    blurb: "Claude Code in the Koupa folder asks for Supabase.",
    tone: "green",
    badge: "Sent",
    nodes: [
      { label: "Agent", name: "Claude Code", sub: "Koupa folder", s: "ok" },
      { label: "Project", name: "Koupa", sub: "production", s: "ok" },
      { label: "Account", name: "Personal", sub: "Supabase", s: "ok" },
      { label: "Resource", name: "koupa-production", sub: "database", s: "ok" },
    ],
    outcome: "Sent to koupa-production",
    why: "The agent only named the service. Nexus found Koupa's own account and resource and made the call. The key never reached the agent.",
    request: `{
  "method": "nexus.request_access",
  "params": { "service": "supabase" }
}`,
    response: `{
  "result": {
    "project": "koupa",
    "account": "Personal",
    "resource": "koupa-production",
    "sent": true,
    "key_shown_to_agent": false
  }
}`,
  },
  {
    id: "cross",
    title: "Wrong project",
    blurb: "Codex in the Nabdh folder asks for Koupa's database.",
    tone: "red",
    badge: "Refused",
    nodes: [
      { label: "Agent", name: "Codex", sub: "Nabdh folder", s: "ok" },
      { label: "Project", name: "Nabdh", sub: "development", s: "ok" },
      { label: "Account", name: "Client", sub: "Supabase", s: "ok" },
      { label: "Resource", name: "koupa-production", sub: "belongs to Koupa", s: "fail" },
    ],
    outcome: "Refused before it reached Supabase",
    why: "koupa-production belongs to Koupa, and this agent is in Nabdh. Nexus says no right away.",
    request: `{
  "method": "nexus.execute",
  "params": {
    "service": "supabase",
    "resource": "koupa-production"
  }
}`,
    response: `{
  "error": {
    "message": "Refused",
    "reason": "That resource belongs to Koupa",
    "this_project": "nabdh"
  }
}`,
  },
  {
    id: "unregistered",
    title: "Unknown folder",
    blurb: "An agent in a folder that isn't a registered project.",
    tone: "red",
    badge: "Refused",
    nodes: [
      { label: "Agent", name: "Any agent", sub: "~/Projects/scratch", s: "ok" },
      { label: "Project", name: "None found", sub: "not registered", s: "fail" },
      { label: "Account", name: "Account", sub: "", s: "ok" },
      { label: "Resource", name: "Resource", sub: "", s: "ok" },
    ],
    outcome: "Refused, nothing was guessed",
    why: "Only you can add a project. Nexus never creates one on its own or guesses.",
    request: `{
  "method": "nexus.request_access",
  "params": { "service": "supabase" }
}`,
    response: `{
  "error": {
    "message": "Refused",
    "reason": "This folder isn't a registered project",
    "hint": "Add it in Nexus first"
  }
}`,
  },
  {
    id: "conflict",
    title: "Mixed signals",
    blurb: "The project file says Koupa, but the Git remote says Nabdh.",
    tone: "amber",
    badge: "Asks you",
    nodes: [
      { label: "Agent", name: "Claude Code", sub: "~/Projects/app", s: "ok" },
      { label: "Project", name: "Koupa or Nabdh?", sub: "the clues disagree", s: "warn" },
      { label: "Account", name: "Account", sub: "", s: "ok" },
      { label: "Resource", name: "Resource", sub: "", s: "ok" },
    ],
    outcome: "Waiting for you to decide",
    why: "When the clues disagree, Nexus asks you instead of guessing. Nothing is sent until you decide.",
    request: `{
  "method": "nexus.context",
  "params": {}
}`,
    response: `{
  "result": {
    "status": "conflict",
    "project_file_says": "koupa",
    "git_remote_says": "nabdh",
    "sent": false
  }
}`,
  },
];

const MARK: Record<NodeState, string> = { ok: "✓", fail: "✕", warn: "!" };

function Routing() {
  const [id, setId] = useState("ok");
  const s = useMemo(() => SCENARIOS.find((x) => x.id === id)!, [id]);
  /* how many nodes are reached before the request stops */
  const stopAt = useMemo(() => {
    const i = s.nodes.findIndex((n) => n.s !== "ok");
    return i === -1 ? s.nodes.length : i + 1;
  }, [s]);
  const [shown, setShown] = useState(0);
  const done = shown >= stopAt;
  const last = s.nodes[stopAt - 1];

  /* Scroll-driven on roomy screens: the section pins, and scrolling steps
     through the situations. Phones, short screens and reduced motion keep the
     plain click-to-select version. */
  const trackRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const check = () => setPinned(!REDUCED() && window.innerWidth > 960 && window.innerHeight >= 680);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!pinned) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      if (travel <= 0) return;
      const p = Math.min(0.9999, Math.max(0, -rect.top / travel));
      const next = SCENARIOS[Math.floor(p * SCENARIOS.length)].id;
      setId((cur) => (cur === next ? cur : next));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pinned]);

  /* Clicking a situation: when pinned, scroll to its slice of the track. */
  function pick(i: number) {
    if (!pinned || !trackRef.current) {
      setId(SCENARIOS[i].id);
      return;
    }
    const rect = trackRef.current.getBoundingClientRect();
    const travel = rect.height - window.innerHeight;
    window.scrollTo({ top: window.scrollY + rect.top + ((i + 0.5) / SCENARIOS.length) * travel, behavior: "smooth" });
  }
  const verdict: NodeState = last.s;

  /* Walk the request along the path, one stop at a time. */
  useEffect(() => {
    if (REDUCED()) {
      setShown(stopAt);
      return;
    }
    setShown(0);
    const timer = window.setInterval(() => {
      setShown((n) => {
        if (n + 1 >= stopAt) window.clearInterval(timer);
        return n + 1;
      });
    }, 520);
    return () => window.clearInterval(timer);
  }, [stopAt, s]);

  return (
    <section className="section" id="routing">
      <div className="container">
      <div
        className={`demo-track ${pinned ? "pinned" : ""}`}
        ref={trackRef}
        style={{ ["--steps" as string]: SCENARIOS.length }}
      >
      <div className="demo-pin demo-split">
        <div className="demo-left">
          <span className="label">See it work</span>
          <h2>Wrong-project mistakes stop before they start.</h2>
          <p className="lead">Pick a situation to see what Nexus does.</p>
          <div className="sit-list" role="group" aria-label="Situations">
            {SCENARIOS.map((x, i) => (
              <button key={x.id} type="button" className="sit" aria-pressed={x.id === id} onClick={() => pick(i)}>
                <span className="sit-top">
                  <strong>{x.title}</strong>
                  <span className={`badge ${x.tone}`}>{x.badge}</span>
                </span>
                <span className="sit-sub">{x.blurb}</span>
              </button>
            ))}
          </div>
          {pinned && <p className="demo-hint">Keep scrolling to step through them</p>}
        </div>

        <div className="card stage">
          <span className="label">The request's path</span>
          <div className="nodes">
            {s.nodes.map((n, i) => {
              const reached = i < shown;
              const skipped = done && i >= stopAt;
              return (
                <div key={`${s.id}-${i}`} className="node-wrap">
                  {i > 0 && <span className={`link ${i < shown ? `on ${n.s}` : ""}`} aria-hidden="true" />}
                  <div className={`node ${reached ? `on ${n.s}` : ""} ${skipped ? "skip" : ""}`}>
                    <span className="node-mark" aria-hidden="true">{reached ? MARK[n.s] : skipped ? "–" : ""}</span>
                    <span className="label">{n.label}</span>
                    <strong>{n.name}</strong>
                    <span className="node-sub">{skipped ? "not reached" : n.sub}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={`outcome ${done ? `on ${verdict}` : ""}`} aria-live="polite">
            <strong>{done ? s.outcome : "Checking…"}</strong>
            <p>{done ? s.why : "\u00a0"}</p>
          </div>

          <details className="raw">
            <summary>Show the request and answer</summary>
            <div className="raw-cols">
              <div>
                <span className="label">Agent asks</span>
                <pre className="code"><code>{s.request}</code></pre>
              </div>
              <div>
                <span className="label">Nexus answers</span>
                <pre className="code"><code>{s.response}</code></pre>
              </div>
            </div>
          </details>
        </div>
      </div>
      </div>
      </div>
    </section>
  );
}

/* ---------- Service catalog (paper §13, proposed list) ---------- */
type Tier = "Native" | "Curated";
type Svc = { name: string; cats: string[]; tier?: Tier };

const CATS = [
  "Database & backend", "Auth & identity", "Source control & CI", "Hosting & deployment",
  "Monitoring & analytics", "Payments", "Email & messaging", "Project management",
  "Docs & knowledge", "Team communication", "Design", "AI & generation",
  "Search, media & vectors", "Content management",
] as const;

const [DB, AUTH, SCM, HOST, MON, PAY, MAIL, PM, DOCS, CHAT, DESIGN, AI, SEARCH, CMS] = CATS;

const CATALOG: Svc[] = [
  { name: "Supabase", cats: [DB, AUTH], tier: "Native" },
  { name: "Firebase", cats: [DB, AUTH, HOST] },
  { name: "Convex", cats: [DB] },
  { name: "Neon", cats: [DB] },
  { name: "PlanetScale", cats: [DB] },
  { name: "Turso", cats: [DB] },
  { name: "MongoDB Atlas", cats: [DB] },
  { name: "Upstash", cats: [DB] },
  { name: "Clerk", cats: [AUTH] },
  { name: "Auth0", cats: [AUTH] },
  { name: "GitHub", cats: [SCM], tier: "Native" },
  { name: "GitLab", cats: [SCM] },
  { name: "Vercel", cats: [HOST] },
  { name: "Netlify", cats: [HOST] },
  { name: "Cloudflare", cats: [HOST] },
  { name: "Railway", cats: [HOST] },
  { name: "Render", cats: [HOST] },
  { name: "Fly.io", cats: [HOST] },
  { name: "DigitalOcean", cats: [HOST] },
  { name: "Sentry", cats: [MON] },
  { name: "PostHog", cats: [MON] },
  { name: "Datadog", cats: [MON] },
  { name: "Grafana", cats: [MON] },
  { name: "Mixpanel", cats: [MON] },
  { name: "Stripe", cats: [PAY] },
  { name: "Paddle", cats: [PAY] },
  { name: "Lemon Squeezy", cats: [PAY] },
  { name: "PayPal", cats: [PAY] },
  { name: "Resend", cats: [MAIL] },
  { name: "SendGrid", cats: [MAIL] },
  { name: "Twilio", cats: [MAIL] },
  { name: "Postmark", cats: [MAIL] },
  { name: "Linear", cats: [PM] },
  { name: "Jira", cats: [PM] },
  { name: "Asana", cats: [PM] },
  { name: "Notion", cats: [DOCS, DB] },
  { name: "Confluence", cats: [DOCS] },
  { name: "Google Drive", cats: [DOCS] },
  { name: "Slack", cats: [CHAT] },
  { name: "Discord", cats: [CHAT] },
  { name: "Figma", cats: [DESIGN] },
  { name: "OpenAI", cats: [AI] },
  { name: "Replicate", cats: [AI] },
  { name: "ElevenLabs", cats: [AI] },
  { name: "Hugging Face", cats: [AI] },
  { name: "Higgsfield", cats: [AI] },
  { name: "Algolia", cats: [SEARCH] },
  { name: "Cloudinary", cats: [SEARCH] },
  { name: "Pinecone", cats: [SEARCH, DB] },
  { name: "Sanity", cats: [CMS] },
];

const SERVICE_ICON: Record<string, Logo> = {
  "Supabase": brand("Supabase", siSupabase),
  "Firebase": brand("Firebase", siFirebase),
  "Convex": brand("Convex", siConvex),
  "Neon": brand("Neon", siNeon),
  "PlanetScale": brand("PlanetScale", siPlanetscale),
  "Turso": brand("Turso", siTurso),
  "MongoDB Atlas": brand("MongoDB Atlas", siMongodb),
  "Upstash": brand("Upstash", siUpstash),
  "Clerk": brand("Clerk", siClerk),
  "Auth0": brand("Auth0", siAuth0),
  "GitHub": brand("GitHub", siGithub),
  "GitLab": brand("GitLab", siGitlab),
  "Vercel": brand("Vercel", siVercel),
  "Netlify": brand("Netlify", siNetlify),
  "Cloudflare": brand("Cloudflare", siCloudflare),
  "Railway": brand("Railway", siRailway),
  "Render": brand("Render", siRender),
  "Fly.io": brand("Fly.io", siFlydotio),
  "DigitalOcean": brand("DigitalOcean", siDigitalocean),
  "Sentry": brand("Sentry", siSentry),
  "PostHog": brand("PostHog", siPosthog),
  "Datadog": brand("Datadog", siDatadog),
  "Grafana": brand("Grafana", siGrafana),
  "Mixpanel": brand("Mixpanel", siMixpanel),
  "Stripe": brand("Stripe", siStripe),
  "Paddle": brand("Paddle", siPaddle),
  "Lemon Squeezy": brand("Lemon Squeezy", siLemonsqueezy),
  "PayPal": brand("PayPal", siPaypal),
  "Resend": brand("Resend", siResend),
  "Linear": brand("Linear", siLinear),
  "Jira": brand("Jira", siJira),
  "Asana": brand("Asana", siAsana),
  "Notion": brand("Notion", siNotion),
  "Confluence": brand("Confluence", siConfluence),
  "Google Drive": brand("Google Drive", siGoogledrive),
  "Discord": brand("Discord", siDiscord),
  "Figma": brand("Figma", siFigma),
  "Replicate": brand("Replicate", siReplicate),
  "ElevenLabs": brand("ElevenLabs", siElevenlabs),
  "Hugging Face": brand("Hugging Face", siHuggingface),
  "Algolia": brand("Algolia", siAlgolia),
  "Cloudinary": brand("Cloudinary", siCloudinary),
  "Sanity": brand("Sanity", siSanity),
};

/* Logo tile for a service. A few services have no mark in the icon set, so
   they get a plain letter tile instead of an invented logo. */
function ServiceLogo({ name, size = 40 }: { name: string; size?: number }) {
  const logo = SERVICE_ICON[name];
  const color = logo?.color;
  return (
    <span
      className="svc-ic"
      style={{
        width: size,
        height: size,
        background: color ? `color-mix(in srgb, ${color} 15%, transparent)` : "var(--raised)",
      }}
      aria-hidden="true"
    >
      {logo ? (
        <svg viewBox="0 0 24 24" style={{ width: size * 0.55, height: size * 0.55, fill: color ?? "currentColor" }}>
          <path d={logo.path} />
        </svg>
      ) : (
        <b style={{ fontSize: size * 0.42 }}>{name.charAt(0)}</b>
      )}
    </span>
  );
}

/* Plausible resource names per category, so the demo reads like a real project. */
const RESOURCES: Record<string, [string, string]> = {
  [DB]: ["koupa-production", "nabdh-development"],
  [AUTH]: ["koupa-auth", "nabdh-auth"],
  [SCM]: ["koupa", "nabdh"],
  [HOST]: ["koupa-web", "nabdh-web"],
  [MON]: ["koupa", "nabdh"],
  [PAY]: ["koupa-live", "nabdh-test"],
  [MAIL]: ["koupa-mail", "nabdh-mail"],
  [PM]: ["Koupa board", "Nabdh board"],
  [DOCS]: ["Koupa wiki", "Nabdh wiki"],
  [CHAT]: ["#koupa", "#nabdh"],
  [DESIGN]: ["Koupa app", "Nabdh app"],
  [AI]: ["koupa-key", "nabdh-key"],
  [SEARCH]: ["koupa-index", "nabdh-index"],
  [CMS]: ["koupa-studio", "nabdh-studio"],
};

/* The stage: one service, linked as two accounts, each bound to its own project. */
function LinkStage({ svc }: { svc: Svc }) {
  const logo = SERVICE_ICON[svc.name];
  const color = logo?.color ?? "var(--text)";
  const [koupa, nabdh] = RESOURCES[svc.cats[0]] ?? ["koupa", "nabdh"];
  const rows = [
    { y: 56, account: "Personal", project: "Koupa", resource: koupa },
    { y: 156, account: "Client", project: "Nabdh", resource: nabdh },
  ];
  const mark = (x: number, y: number, size: number) =>
    logo ? (
      <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24">
        <path d={logo.path} fill={color} />
      </svg>
    ) : (
      <text x={x + size / 2} y={y + size * 0.72} textAnchor="middle" className="t-name" style={{ fontSize: size * 0.7 }}>{svc.name.charAt(0)}</text>
    );

  return (
    <svg className="link-svg" viewBox="0 0 450 212" role="img" aria-label={`${svc.name} linked as two accounts, each bound to its own project`}>
      <text className="t-col" x="0" y="14">LINKED ONCE</text>
      <text className="t-col" x="276" y="14">BOUND PER PROJECT</text>
      {rows.map((r, i) => (
        <g key={r.project}>
          <path className="t-line green" d={`M 184 ${r.y} L 276 ${r.y}`} />
          <circle className="t-packet" r="3.5" fill="var(--green)" opacity="0">
            <animate attributeName="opacity" values="0;1;0" keyTimes="0;0.02;0.98" calcMode="discrete" dur="2.4s" begin={`${i * 0.6}s`} repeatCount="indefinite" />
            <animateMotion dur="2.4s" begin={`${i * 0.6}s`} repeatCount="indefinite" path={`M 184 ${r.y} L 276 ${r.y}`} />
          </circle>
          <rect className="t-card" x="0" y={r.y - 32} width="184" height="64" rx="12" />
          <rect x="12" y={r.y - 20} width="40" height="40" rx="10" fill={logo?.color ? `color-mix(in srgb, ${logo.color} 15%, transparent)` : "var(--raised)"} />
          {mark(20, r.y - 12, 24)}
          <text className="t-name" x="62" y={r.y - 3}>{r.account}</text>
          <text className="t-sub" x="62" y={r.y + 14}>{svc.name}</text>
          <rect className="t-card" x="276" y={r.y - 32} width="174" height="64" rx="12" />
          <text className="t-name" x="292" y={r.y - 3}>{r.project}</text>
          <text className="t-sub" x="292" y={r.y + 14}>{r.resource}</text>
        </g>
      ))}
    </svg>
  );
}

function Catalog() {
  const [sel, setSel] = useState("Supabase");
  const [auto, setAuto] = useState(true);
  const [q, setQ] = useState("");

  /* Until the visitor picks something, walk through the catalog so the
     stage shows the idea on its own. */
  useEffect(() => {
    if (!auto || REDUCED()) return;
    const id = window.setInterval(() => {
      setSel((cur) => {
        const i = CATALOG.findIndex((c) => c.name === cur);
        return CATALOG[(i + 1) % CATALOG.length].name;
      });
    }, 3200);
    return () => window.clearInterval(id);
  }, [auto]);

  const svc = CATALOG.find((c) => c.name === sel)!;
  const needle = q.trim().toLowerCase();
  const builtIn = svc.tier === "Native";

  return (
    <section className="section" id="services">
      <div className="container">
        <div className="section-head stack">
          <h2>Link a service once. Use it in every project.</h2>
          <p className="lead">50 popular services to start. Pick one to see how Nexus links it.</p>
        </div>

        <div className="link-demo">
          <div className="dock-wrap">
            <input
              className="search"
              type="search"
              placeholder={`Search ${CATALOG.length} services`}
              aria-label="Search services"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="dock" role="group" aria-label="Services">
              {CATALOG.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className={`dock-btn ${needle && !c.name.toLowerCase().includes(needle) ? "faded" : ""}`}
                  aria-pressed={c.name === sel}
                  aria-label={c.name}
                  title={c.name}
                  onClick={() => {
                    setAuto(false);
                    setSel(c.name);
                  }}
                >
                  <ServiceLogo name={c.name} size={40} />
                </button>
              ))}
            </div>
            <div className="dock-legend">
              <span><b className="badge green">Built-in</b>Supabase and GitHub, reviewed action by action.</span>
              <span><b className="badge">Catalog</b>The other 48, through each service's MCP server.</span>
              <span><b className="badge amber">Your own</b>Add anything else.</span>
            </div>
          </div>

          <div className="card link-stage" aria-live="polite">
            <div className="link-head" key={svc.name}>
              <ServiceLogo name={svc.name} size={56} />
              <div>
                <h3>{svc.name}</h3>
                <p>{svc.cats.join(", ")}</p>
              </div>
              <span className={`badge ${builtIn ? "green" : ""}`}>{builtIn ? "Built-in" : "Catalog"}</span>
            </div>
            <div className="link-body" key={`${svc.name}-svg`}>
              <LinkStage svc={svc} />
            </div>
            <p className="link-note">
              Link each account once, with a label. Every project then picks its own account and resource.
              {builtIn
                ? " Nexus pins every call to that project's resource."
                : " Nexus keeps the right account. Use one account per project for this one."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Agents ---------- */
type KvKey = "agent" | "connection" | "folder" | "project";
type AgentLine = {
  k: "cmd" | "dim" | "ok" | "warn" | "add";
  t: string;
  set?: Partial<Record<KvKey, { v: string; tone: "ok" | "warn" }>>;
};
type AgentDemo = { id: string; name: string; logo: Logo; how: string; lines: AgentLine[] };

const AGENT_DEMOS: AgentDemo[] = [
  {
    id: "claude",
    name: "Claude Code",
    logo: AGENT_LOGOS[0],
    how: "One command",
    lines: [
      { k: "cmd", t: "$ claude mcp add --transport http nexus http://localhost:3939/mcp" },
      { k: "dim", t: "Testing the connection..." },
      { k: "ok", t: "Connected", set: { agent: { v: "Claude Code", tone: "ok" }, connection: { v: "Connected", tone: "ok" } } },
      { k: "dim", t: "Asking which folder it was started in..." },
      { k: "ok", t: "Folder reported: ~/Projects/Koupa", set: { folder: { v: "Reported by the agent", tone: "ok" } } },
      { k: "ok", t: "Project: Koupa", set: { project: { v: "Koupa", tone: "ok" } } },
    ],
  },
  {
    id: "codex",
    name: "Codex",
    logo: AGENT_LOGOS[1],
    how: "One command",
    lines: [
      { k: "cmd", t: "$ codex mcp add --url http://localhost:3939/mcp nexus" },
      { k: "dim", t: "Testing the connection..." },
      { k: "ok", t: "Connected", set: { agent: { v: "Codex", tone: "ok" }, connection: { v: "Connected", tone: "ok" } } },
      { k: "warn", t: "Codex doesn't report its folder", set: { folder: { v: "Not reported", tone: "warn" } } },
      { k: "dim", t: "Pinning the folder in the project's Codex config..." },
      { k: "ok", t: "Folder pinned: ~/Projects/Koupa", set: { folder: { v: "Pinned in config", tone: "ok" } } },
      { k: "ok", t: "Project: Koupa", set: { project: { v: "Koupa", tone: "ok" } } },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    logo: AGENT_LOGOS[2],
    how: "Config edit",
    lines: [
      { k: "dim", t: "Preview of the change to the agent's config:" },
      { k: "add", t: "+ nexus  http://localhost:3939/mcp" },
      { k: "dim", t: "A backup is saved before anything is written." },
      { k: "ok", t: "You confirmed. Config updated." },
      { k: "dim", t: "Testing the connection..." },
      { k: "ok", t: "Connected", set: { agent: { v: "OpenCode", tone: "ok" }, connection: { v: "Connected", tone: "ok" } } },
      { k: "ok", t: "Folder reported: ~/Projects/Koupa", set: { folder: { v: "Reported by the agent", tone: "ok" } } },
      { k: "ok", t: "Project: Koupa", set: { project: { v: "Koupa", tone: "ok" } } },
    ],
  },
];

const KV_ROWS: { key: KvKey; label: string }[] = [
  { key: "agent", label: "Agent" },
  { key: "connection", label: "Connection" },
  { key: "folder", label: "Folder" },
  { key: "project", label: "Project" },
];

function Agents() {
  const [id, setId] = useState("claude");
  const demo = useMemo(() => AGENT_DEMOS.find((d) => d.id === id)!, [id]);
  const [shown, setShown] = useState(0);

  /* Play the connection step by step each time an agent is picked. */
  useEffect(() => {
    if (REDUCED()) {
      setShown(demo.lines.length);
      return;
    }
    setShown(0);
    const timer = window.setInterval(() => {
      setShown((n) => {
        if (n + 1 >= demo.lines.length) window.clearInterval(timer);
        return n + 1;
      });
    }, 560);
    return () => window.clearInterval(timer);
  }, [demo]);

  /* The panel on the right fills in as lines are reached. */
  const kv = useMemo(() => {
    const out: Partial<Record<KvKey, { v: string; tone: "ok" | "warn" }>> = {};
    demo.lines.slice(0, shown).forEach((l) => l.set && Object.assign(out, l.set));
    return out;
  }, [demo, shown]);

  return (
    <section className="section" id="agents">
      <div className="container">
        <div className="section-head stack">
          <h2>One Nexus on your computer. Every agent connects to it.</h2>
          <p className="lead">Pick an agent to see how it connects.</p>
        </div>

        <div className="agent-tabs" role="group" aria-label="Agents">
          {AGENT_DEMOS.map((d) => {
            const color = d.logo.color;
            return (
              <button key={d.id} type="button" className="agent-tab" aria-pressed={d.id === id} onClick={() => setId(d.id)}>
                <span className="svc-ic" style={{ width: 40, height: 40, background: color ? `color-mix(in srgb, ${color} 15%, transparent)` : "var(--raised)" }} aria-hidden="true">
                  <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, fill: color ?? "currentColor" }}><path d={d.logo.path} /></svg>
                </span>
                <span className="agent-tab-text">
                  <strong>{d.name}</strong>
                  <small>{d.how}</small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="card term">
          <div className="term-log" aria-live="polite">
            <span className="label">Example</span>
            <div className="term-lines">
              {demo.lines.map((l, i) => (
                <div key={`${demo.id}-${i}`} className={`tl tl-${l.k} ${i < shown ? "on" : ""}`}>{l.k === "ok" ? "✓ " : l.k === "warn" ? "! " : ""}{l.t}</div>
              ))}
            </div>
          </div>
          <div className="term-kv">
            <span className="label">What Nexus sees</span>
            <dl>
              {KV_ROWS.map((r) => {
                const v = kv[r.key];
                return (
                  <div key={r.key} className={`kv ${v ? `set ${v.tone}` : ""}`}>
                    <dt>{r.label}</dt>
                    <dd key={v?.v ?? "none"}>{v ? v.v : "Waiting"}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>

        <div className="agent-facts">
          <div>
            <h3>Always the same Nexus</h3>
            <p>Every agent connects to the one Nexus on your computer, never a separate copy per agent. That is what keeps their sessions apart.</p>
          </div>
          <div>
            <h3>Already using MCP servers?</h3>
            <p>Nexus finds them and offers to move them over, with a diff and a backup first. Anything it can't handle is listed as "found, not managed".</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- What you get ---------- */
function MiniMap() {
  const agents = [28, 75, 122];
  const projects = [50, 102];
  const services = [22, 58, 94, 130];
  const link = (x1: number, y1: number, x2: number, y2: number) => `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
  return (
    <svg className="mini-map" viewBox="0 0 360 152" role="img" aria-label="Agents connected to projects, each linked to its own service accounts">
      {agents.map((y, i) => <path key={`a${i}`} className="t-line green" d={link(70, y, 150, projects[i === 0 ? 0 : 1])} />)}
      {services.map((y, i) => <path key={`s${i}`} className="t-line green" d={link(210, projects[i < 2 ? 0 : 1], 290, y)} />)}
      <path className="t-line red" d={link(210, projects[1], 290, services[0] + 6)} />
      {agents.map((y, i) => <rect key={`ar${i}`} className="t-card" x="4" y={y - 12} width="66" height="24" rx="8" />)}
      {projects.map((y, i) => <rect key={`pr${i}`} className="t-card" x="150" y={y - 14} width="60" height="28" rx="9" />)}
      {services.map((y, i) => <rect key={`sr${i}`} className="t-card" x="290" y={y - 12} width="66" height="24" rx="8" />)}
      <text className="t-sub" x="14" y="31">Claude</text><text className="t-sub" x="14" y="78">Codex</text><text className="t-sub" x="14" y="125">OpenCode</text>
      <text className="t-name" x="162" y="54" style={{ fontSize: 11 }}>Koupa</text><text className="t-name" x="162" y="106" style={{ fontSize: 11 }}>Nabdh</text>
      <text className="t-sub" x="300" y="25">Supabase</text><text className="t-sub" x="300" y="61">GitHub</text><text className="t-sub" x="300" y="97">Supabase</text><text className="t-sub" x="300" y="133">Convex</text>
    </svg>
  );
}

function Inside() {
  return (
    <section className="section" id="inside">
      <div className="container">
        <div className="section-head stack">
          <h2>What you get.</h2>
          <p className="lead">One app on your computer keeps your agents, projects and accounts in one place.</p>
        </div>

        <div className="bento">
          <article className="card tile t-map">
            <header><span className="tint tint-green"><Graph size={20} weight="bold" /></span><div><h3>A live map</h3><p>See every agent, project and account, and which calls are going through.</p></div></header>
            <MiniMap />
          </article>

          <article className="card tile t-proj">
            <header><span className="tint tint-blue"><FolderSimple size={20} weight="bold" /></span><div><h3>Add a project</h3><p>Pick a folder. Nexus remembers which project it is.</p></div></header>
            <div className="mini-row">
              <code>~/Projects/Koupa</code>
              <span className="mini-arrow" aria-hidden="true">→</span>
              <span className="badge green">Project: Koupa</span>
            </div>
          </article>

          <article className="card tile t-acct">
            <header><span className="tint tint-violet"><LinkSimple size={20} weight="bold" /></span><div><h3>Link accounts once</h3><p>Sign in once, with a label like Personal or Client.</p></div></header>
            <div className="mini-chips">
              <span className="mini-chip"><ServiceLogo name="Supabase" size={22} />Personal</span>
              <span className="mini-chip"><ServiceLogo name="Supabase" size={22} />Client</span>
              <span className="mini-chip"><ServiceLogo name="GitHub" size={22} />Personal</span>
            </div>
          </article>

          <article className="card tile t-pick">
            <header><span className="tint tint-amber"><ListChecks size={20} weight="bold" /></span><div><h3>Pick, never type</h3><p>Choose each project's resource from a list fetched live.</p></div></header>
            <ul className="mini-list">
              <li className="sel"><Check size={14} weight="bold" /> koupa-production</li>
              <li>koupa-staging</li>
              <li>koupa-test</li>
            </ul>
          </article>

          <article className="card tile t-agents">
            <header><span className="tint tint-violet"><Plugs size={20} weight="bold" /></span><div><h3>Connect your agents</h3><p>Claude Code, Codex and OpenCode.</p></div></header>
            <div className="mini-agents">
              {AGENT_LOGOS.slice(0, 3).map((l, i) => (
                <span key={l.name} className="mini-agent" style={{ ["--n" as string]: i }}>
                  <span className="svc-ic" style={{ width: 34, height: 34, background: l.color ? `color-mix(in srgb, ${l.color} 15%, transparent)` : "var(--raised)" }} aria-hidden="true">
                    <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: l.color ?? "currentColor" }}><path d={l.path} /></svg>
                  </span>
                  <Check size={14} weight="bold" className="mini-tick" />
                </span>
              ))}
            </div>
          </article>

          <article className="card tile t-log">
            <header><span className="tint tint-red"><Pulse size={20} weight="bold" /></span><div><h3>An activity log</h3><p>Every request and what happened. Never your keys.</p></div></header>
            <div className="mini-log">
              <div className="ok" style={{ ["--n" as string]: 0 }}>Claude Code → koupa-production · sent</div>
              <div className="bad" style={{ ["--n" as string]: 1 }}>Codex → koupa-production · refused</div>
              <div className="warn" style={{ ["--n" as string]: 2 }}>Claude Code · mixed signals · waiting</div>
            </div>
          </article>
        </div>
        <p className="fine">Previews are examples of what the app shows. Coming next: Guard, an optional layer that reviews risky actions before they run.</p>
      </div>
    </section>
  );
}

/* ---------- Pricing ---------- */
const FREE_LIMIT = 2;
const PROJECT_SLOTS = ["Koupa", "Nabdh", "Project 3", "Project 4", "Project 5", "Project 6", "Project 7", "Project 8"];

function Pricing() {
  const [count, setCount] = useState(2);
  const [yearly, setYearly] = useState(false);
  const fitsFree = count <= FREE_LIMIT;
  const rec: "free" | "pro" = fitsFree ? "free" : "pro";

  return (
    <section className="section" id="pricing">
      <div className="container">
        <div className="section-head stack">
          <h2>Free until you outgrow two projects.</h2>
          <p className="lead">The core stays free. Slide to match how many projects you run.</p>
        </div>

        <div className="card price-lab">
          <div className="lab-top">
            <label htmlFor="proj-count" className="lab-q">How many projects do you run?</label>
            <span className="lab-num" key={count}>{count}{count === 8 ? "+" : ""}</span>
          </div>
          <input
            id="proj-count"
            className="range"
            type="range"
            min={1}
            max={8}
            step={1}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            aria-valuetext={`${count} projects`}
          />
          <div className="slots" aria-hidden="true">
            {PROJECT_SLOTS.map((name, i) => {
              const on = i < count;
              const tone = i < FREE_LIMIT ? "free" : "pro";
              return (
                <span key={name} className={`slot ${on ? `on ${tone}` : ""}`}>
                  <FolderSimple size={16} weight="bold" />
                  {name}
                </span>
              );
            })}
          </div>
          <p className="lab-result" aria-live="polite" key={rec}>
            {fitsFree
              ? `${count === 1 ? "One project fits" : "Two projects fit"} on Free. You pay nothing.`
              : `Beyond two projects, Pro keeps it flat: unlimited projects for one price.`}
          </p>
        </div>

        <div className="bill-row">
          <span className="muted">Billing</span>
          <div className="seg" role="group" aria-label="Billing period">
            <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>Monthly</button>
            <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>Yearly</button>
          </div>
          {yearly && <span className="badge green">Cheaper than monthly</span>}
        </div>

        <div className="plans">
          <article className={`plan-card ${rec === "free" ? "rec" : ""}`}>
            {rec === "free" && <span className="rec-badge">Fits your setup</span>}
            <header className="plan-head"><span className="tint tint-green"><Sparkle size={20} weight="bold" /></span><h3>Free</h3></header>
            <div className="plan-price"><b>$0</b></div>
            <p className="plan-sub">For getting started.</p>
            <ul className="plan-list">
              <li><span className="chk"><Check size={12} weight="bold" /></span>Up to 2 projects</li>
              <li><span className="chk"><Check size={12} weight="bold" /></span>Core linking and routing</li>
            </ul>
            <a href="#waitlist" className={`btn ${rec === "free" ? "btn-primary" : ""}`}>Join the waitlist</a>
          </article>

          <article className={`plan-card ${rec === "pro" ? "rec" : ""}`}>
            {rec === "pro" && <span className="rec-badge">Fits your setup</span>}
            <header className="plan-head"><span className="tint tint-violet"><Rocket size={20} weight="bold" /></span><h3>Pro</h3></header>
            <div className="plan-price" key={yearly ? "y" : "m"}>
              <b>{yearly ? "~$99" : "~$10-12"}</b>
              <span>{yearly ? "/ year" : "/ month"}</span>
            </div>
            <p className="plan-sub">{yearly ? "About $8 a month, billed once a year." : "Or about $99 a year."}</p>
            <ul className="plan-list">
              <li><span className="chk"><Check size={12} weight="bold" /></span>Unlimited projects and accounts</li>
              <li><span className="chk"><Check size={12} weight="bold" /></span>Longer activity history</li>
              <li><span className="chk"><Check size={12} weight="bold" /></span>Guard, when it launches</li>
            </ul>
            <a href="#waitlist" className={`btn ${rec === "pro" ? "btn-primary" : ""}`}>Join the waitlist</a>
          </article>

          <article className="plan-card muted-plan">
            <header className="plan-head"><span className="tint tint-blue"><UsersThree size={20} weight="bold" /></span><h3>Team and Agency</h3></header>
            <div className="plan-price"><b>Later</b></div>
            <p className="plan-sub">For small teams and client work.</p>
            <ul className="plan-list">
              <li><span className="chk"><Check size={12} weight="bold" /></span>Shared projects and bindings</li>
              <li><span className="chk"><Check size={12} weight="bold" /></span>Per-client logs you can show a client</li>
            </ul>
            <span className="later">Coming later</span>
          </article>
        </div>

        <p className="fine">Prices are approximate and may change at launch. Nothing is charged today.</p>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
const FAQ: [string, string][] = [
  ["Does my agent ever see my keys?", "No. The agent asks Nexus, and Nexus makes the call with the right account's login. Your logins are kept in your computer's secure storage."],
  ["What if an agent skips Nexus?", "Then Nexus can't see or stop what it does. Nexus only protects what goes through it. It can find direct connections and offer to move them over."],
  ["How does Nexus know which project an agent is in?", "It reads the project file in the folder and checks the Git remote. Claude Code and OpenCode tell Nexus their folder. Codex doesn't, so its folder is pinned in config. If Nexus can't tell, or the clues disagree, it asks you instead of guessing."],
  ["Is every service protected equally?", "Supabase and GitHub get the deepest protection: Nexus checks each action against the project's own resource. For the other services it keeps the right account, but it can't see which resource inside that account the agent names. For those, use one account per project."],
  ["Is it a password manager or a file sandbox?", "No. Nexus sends requests to the right account. It doesn't manage all your secrets, enforce company rules, or limit what an agent does to your files."],
  ["Which computers does it run on?", "Linux first."],
  ["What does it cost?", "The core stays free. Paid plans add unlimited projects and longer history. Prices may change at launch."],
  ["Can I try it now?", "Join the list below and you'll get an email as soon as the Linux build is ready to download."],
];

function Faq() {
  return (
    <section className="section" id="faq">
      <div className="container">
        <div className="section-head">
          <span className="label">FAQ</span>
          <h2>Questions people ask first.</h2>
        </div>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q} className="faq-item">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Waitlist ---------- */
function Waitlist() {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "duplicate" | "error">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (status === "sending" || !email) return;
    setStatus("sending");
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, website: honeypot }),
      });
      const data = (await res.json()) as { ok: boolean; duplicate?: boolean; error?: string };
      if (data.ok) {
        setStatus(data.duplicate ? "duplicate" : "success");
      } else {
        setStatus("error");
        setError(data.error ?? "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setError("Could not reach the server. Try again later.");
    }
  }

  const done = status === "success" || status === "duplicate";

  return (
    <section className="section" id="waitlist">
      <div className="container waitlist">
        <span className="label">Get notified</span>
        <h2>Be first to try it.</h2>
        <p className="lead">
          One email, used only for launch news.
        </p>
        {done ? (
          <p className="wl-msg ok" role="status">
            {status === "duplicate" ? "You are already on the list." : "You are on the list."} We will email {email} when the first Linux build is ready.
          </p>
        ) : (
          <form className="wl-form" onSubmit={onSubmit}>
            <input
              type="email"
              placeholder="you@example.com"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              disabled={status === "sending"}
            />
            <input
              className="hp"
              type="text"
              name="website"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
            />
            <button type="submit" className="btn btn-primary" disabled={status === "sending" || !email}>
              {status === "sending" ? "Joining…" : "Notify me"} <ArrowRight size={14} weight="bold" />
            </button>
          </form>
        )}
        {status === "error" && <p className="wl-msg err" role="alert">{error}</p>}
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */
function Footer({ theme }: { theme: Theme }) {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <a href="#" className="brand">
              <img src={theme === "dark" ? "/nexus-symbol.png" : "/nexus-symbol-dark.png"} alt="" />
              <span>Nexus</span>
            </a>
            <p style={{ marginTop: 12, maxWidth: 340 }}>
              Connect your agents once. Link your services once.
            </p>
          </div>
          <div className="footer-cols">
            <div>
              <span className="label">Product</span>
              <a href="#how">How it works</a>
              <a href="#routing">See it work</a>
              <a href="#services">Services</a>
              <a href="#agents">Agents</a>
            </div>
            <div>
              <span className="label">Project</span>
              <a href="#inside">What's inside</a>
              <a href="#pricing">Pricing</a>
              <a href="#faq">FAQ</a>
              <a href="/llms.txt">llms.txt</a>
            </div>
          </div>
        </div>
        <p className="footer-bottom">
          Linux first. Maps and examples on this page are illustrations.
        </p>
      </div>
    </footer>
  );
}

/* ---------- Root ---------- */
const SPY_IDS = NAV.map((n) => n.href.slice(1));

export default function App() {
  const { theme, toggle } = useTheme();
  const barRef = useRef<HTMLDivElement>(null);
  const active = useScrollSpy(SPY_IDS, barRef);
  useScrollReveal();
  return (
    <>
      <Navbar theme={theme} onToggleTheme={toggle} active={active} barRef={barRef} />
      <main id="main">
        <Hero />
        <Problem />
        <HowItWorks />
        <Setup />
        <Routing />
        <Catalog />
        <Agents />
        <Inside />
        <Pricing />
        <Faq />
        <Waitlist />
      </main>
      <Footer theme={theme} />
    </>
  );
}
