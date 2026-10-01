import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  List,
  Moon,
  Sun,
  X,
} from "@phosphor-icons/react";
import { flushSync } from "react-dom";
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
    const onChange = () => {
      if (!document.documentElement.dataset.theme) setTheme(systemTheme());
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* Circular reveal from the toggle (View Transitions API). Other browsers get
     a short colour cross-fade; reduced motion switches instantly. */
  function toggle(x?: number, y?: number) {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
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
        "main > section:not(.hero) .section-head, main > section:not(.hero) .card, .chain, .neq div, .sim-scenarios, .cat-toolbar, .chips, .term-table",
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
function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return { copied, copy };
}

function CommandLine({ command }: { command: string }) {
  const { copied, copy } = useCopy(command);
  return (
    <div className="cmd">
      <code>{command}</code>
      <button type="button" onClick={copy} aria-label="Copy command">
        {copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

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
const T_SERVICES: { id: string; name: string; sub: string; tier: "NATIVE" | "CURATED"; project: ProjectName; y: number }[] = [
  { id: "k-sb", name: "Supabase · Personal", sub: "koupa-production", tier: "NATIVE", project: "Koupa", y: 50 },
  { id: "k-gh", name: "GitHub · Personal", sub: "koupa", tier: "NATIVE", project: "Koupa", y: 130 },
  { id: "n-sb", name: "Supabase · Client", sub: "nabdh-development", tier: "NATIVE", project: "Nabdh", y: 210 },
  { id: "n-cv", name: "Convex · Personal", sub: "nabdh-backend", tier: "CURATED", project: "Nabdh", y: 290 },
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
        <span className="label">Illustration · not live</span>
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
            <text className={`t-tag ${s.tier === "NATIVE" ? "green" : "faint"}`} x={SX + W - 8} y={s.y - H / 2 + 12} textAnchor="end">{s.tier}</text>
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

/* ---------- Hero ---------- */
function Hero() {
  return (
    <section className="hero" id="top">
      <div className="container hero-grid">
        <div>
          <span className="status-line">
            <i className="dot" /> Early build · Linux first
          </span>
          <h1 aria-label="Connect your agents once. Link your services once.">
            {"Connect your agents once. Link your services once.".split(" ").map((w, i) => (
              <span key={i} aria-hidden="true">
                <span className="word" style={{ ["--i" as string]: i }}>{w}</span>{" "}
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
  return (
    <section className="section" id="problem">
      <div className="container">
        <div className="section-head">
          <span className="label">The problem</span>
          <h2>Agents keep grabbing the wrong project's account.</h2>
          <p className="lead">
            You have several projects, and each has its own database, logins and keys. When an AI agent works on one, it can end up using another's: the wrong database, or production instead of development.
          </p>
        </div>
        <div className="grid grid-2">
          <div className="card compare-card">
            <h3><span className="badge red">Today</span></h3>
            <ul className="list">
              <li><span className="x">✕</span><span><strong>Setup is copied into every project.</strong> Each agent uses whatever keys happen to be nearby.</span></li>
              <li><span className="x">✕</span><span><strong>Nothing checks the project.</strong> An agent working on Koupa can change Nabdh's database.</span></li>
              <li><span className="x">✕</span><span><strong>The agent holds the keys.</strong> Once it has them, nobody can stop a mistake.</span></li>
            </ul>
            <pre className="code"><code><span className="t">$ cd ~/Projects/Koupa</span>{"\n"}<span className="t">agent → update the database</span>{"\n"}<span className="r">↳ used Nabdh's login. Wrong database, no warning.</span></code></pre>
          </div>
          <div className="card compare-card">
            <h3><span className="badge green">With Nexus</span></h3>
            <ul className="list">
              <li><span className="ok">✓</span><span><strong>Link each account once.</strong> No setup per project.</span></li>
              <li><span className="ok">✓</span><span><strong>Nexus checks the project every time.</strong> If it can't tell, it says no.</span></li>
              <li><span className="ok">✓</span><span><strong>The agent never sees your keys.</strong> Nexus makes the call for it.</span></li>
            </ul>
            <pre className="code"><code><span className="t">$ cd ~/Projects/Koupa</span>{"\n"}<span className="t">agent → update the database</span>{"\n"}<span className="g">↳ Koupa's own database, Koupa's own login.</span></code></pre>
          </div>
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
type Scenario = {
  id: string;
  title: string;
  tone: "green" | "red" | "amber";
  badge: string;
  summary: string;
  trace: { t: string; s: "ok" | "fail" | "warn" }[];
  request: string;
  response: string;
  why: string;
};

const SCENARIOS: Scenario[] = [
  {
    id: "ok",
    title: "Right project",
    tone: "green",
    badge: "Sent",
    summary: "Claude Code, working in the Koupa folder, asks for Supabase.",
    trace: [
      { t: "Agent connected", s: "ok" },
      { t: "Project: Koupa", s: "ok" },
      { t: "Stage: production", s: "ok" },
      { t: "Account: Personal", s: "ok" },
      { t: "Resource: koupa-production", s: "ok" },
      { t: "Call sent", s: "ok" },
    ],
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
    why: "The agent only named the service. Nexus found Koupa's own account and resource and made the call. The key never reached the agent.",
  },
  {
    id: "cross",
    title: "Wrong project",
    tone: "red",
    badge: "Refused",
    summary: "Codex, working in the Nabdh folder, asks for Koupa's database.",
    trace: [
      { t: "Agent connected", s: "ok" },
      { t: "Project: Nabdh", s: "ok" },
      { t: "Stage: development", s: "ok" },
      { t: "koupa-production?", s: "fail" },
      { t: "Refused", s: "fail" },
    ],
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
    why: "koupa-production belongs to Koupa, and this agent is in Nabdh. Nexus says no right away, before anything reaches Supabase.",
  },
  {
    id: "unregistered",
    title: "Unknown folder",
    tone: "red",
    badge: "Refused",
    summary: "An agent in a folder that isn't a registered project.",
    trace: [
      { t: "Agent connected", s: "ok" },
      { t: "Project: none found", s: "fail" },
      { t: "Refused", s: "fail" },
    ],
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
    why: "Only you can add a project. Nexus never creates one on its own or guesses.",
  },
  {
    id: "conflict",
    title: "Mixed signals",
    tone: "amber",
    badge: "Asks you",
    summary: "The project file says Koupa, but the Git remote says Nabdh.",
    trace: [
      { t: "Agent connected", s: "ok" },
      { t: "Koupa or Nabdh?", s: "warn" },
      { t: "Waiting for you", s: "warn" },
    ],
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
    why: "When the clues disagree, Nexus asks you instead of guessing. Nothing is sent until you decide.",
  },
];

function Routing() {
  const [id, setId] = useState("ok");
  const s = useMemo(() => SCENARIOS.find((x) => x.id === id)!, [id]);
  const [shown, setShown] = useState(0);
  const done = shown >= s.trace.length;

  /* Play the check step by step, then reveal Nexus's answer. */
  useEffect(() => {
    if (REDUCED()) {
      setShown(s.trace.length);
      return;
    }
    setShown(0);
    const timer = window.setInterval(() => {
      setShown((n) => {
        if (n + 1 >= s.trace.length) window.clearInterval(timer);
        return n + 1;
      });
    }, 300);
    return () => window.clearInterval(timer);
  }, [s]);

  return (
    <section className="section" id="routing">
      <div className="container">
        <div className="section-head">
          <span className="label">See it work</span>
          <h2>Wrong-project mistakes stop before they start.</h2>
          <p className="lead">
            Pick a situation. These are examples, not live results.
          </p>
        </div>

        <div className="sim-scenarios" role="group" aria-label="Situations">
          {SCENARIOS.map((x) => (
            <button key={x.id} type="button" className="sim-btn" aria-pressed={x.id === id} onClick={() => setId(x.id)}>
              <span className={`badge ${x.tone}`}>{x.badge}</span>
              <span className="t">{x.title}</span>
            </button>
          ))}
        </div>

        <div className="card sim-panel">
          <div className="sim-head">
            <span className={`badge ${s.tone}`}>{s.badge}</span>
            <p className="muted" style={{ marginTop: 0 }}>{s.summary}</p>
          </div>
          <div className="trace" aria-label="Checks">
            {s.trace.map((step, i) => (
              <span key={`${s.id}-${i}`} className="trace-step">
                <span className={`tr ${i < shown ? `on ${step.s}` : ""}`}>{step.t}</span>
                {i < s.trace.length - 1 && <span className={`tr-arrow ${i + 1 < shown ? "on" : ""}`} aria-hidden="true">→</span>}
              </span>
            ))}
          </div>
          <div className="sim-cols">
            <div key={`${s.id}-req`} className="swap">
              <span className="label">Agent asks</span>
              <pre className="code"><code>{s.request}</code></pre>
            </div>
            <div key={`${s.id}-res`} className={`swap ${done ? "" : "pending"}`}>
              <span className="label">Nexus answers</span>
              <pre className="code"><code>{s.response}</code></pre>
            </div>
          </div>
          <div className={`sim-why ${done ? "" : "pending"}`}>{s.why}</div>
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

function Catalog() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const [expanded, setExpanded] = useState(false);

  const matches = CATALOG.filter(
    (s) =>
      (cat === "All" || s.cats.includes(cat)) &&
      s.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  /* Unfiltered, the full list is 50 near-identical tiles. Show a taste and
     let the visitor expand or filter. */
  const collapsed = cat === "All" && q.trim() === "" && !expanded;
  const shown = collapsed ? matches.slice(0, 12) : matches;

  return (
    <section className="section" id="services">
      <div className="container">
        <div className="section-head">
          <span className="label">Services</span>
          <h2>50 popular services to start with.</h2>
          <p className="lead">
            Link an account once, then use it in any project. When you add it to a project you pick the exact database or repo from a list, so nothing is typed by hand. If one account ends up shared by several projects, Nexus points it out.
          </p>
        </div>

        <div className="cat-toolbar">
          <input
            className="search"
            type="search"
            placeholder={`Search ${CATALOG.length} services`}
            aria-label="Search services"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="chips" role="group" aria-label="Filter by category">
          {["All", ...CATS].map((c) => (
            <button key={c} type="button" className="chip-btn" aria-pressed={cat === c} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="empty">
            Not in the starting list. You can still add any service yourself.
          </p>
        ) : (
          <div className="svc-grid">
            {shown.map((s, i) => (
              <div className="svc" key={`${cat}-${s.name}`} style={{ ["--i" as string]: Math.min(i, 14) }}>
                <div className="svc-top">
                  <strong>{s.name}</strong>
                  <span className={`badge ${s.tier === "Native" ? "green" : ""}`}>{s.tier === "Native" ? "Built-in" : "Catalog"}</span>
                </div>
                <small>{s.cats.join(" · ")}</small>
              </div>
            ))}
          </div>
        )}

        {collapsed && (
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setExpanded(true)}>
              Show all {CATALOG.length} services <ArrowRight size={14} weight="bold" />
            </button>
          </div>
        )}

        <div className="grid grid-3 tiers">
          <div className="card">
            <span className="badge green">Built-in</span>
            <h3 style={{ marginTop: 12 }}>Supabase and GitHub</h3>
            <p>Made by hand and reviewed action by action.</p>
          </div>
          <div className="card">
            <span className="badge">Catalog</span>
            <h3 style={{ marginTop: 12 }}>The other 48</h3>
            <p>Connected through each service's own MCP server. Not reviewed action by action.</p>
          </div>
          <div className="card">
            <span className="badge amber">Your own</span>
            <h3 style={{ marginTop: 12 }}>Anything else</h3>
            <p>Add any service yourself. You confirm that Nexus hasn't reviewed it.</p>
          </div>
        </div>
        <p className="fine">
          This list is a first draft and may change. Each service needs a working MCP server before it ships.
        </p>
      </div>
    </section>
  );
}

/* ---------- Agents ---------- */
function Agents() {
  return (
    <section className="section" id="agents">
      <div className="container">
        <div className="section-head">
          <span className="label">Agents</span>
          <h2>One Nexus on your computer. Every agent connects to it.</h2>
          <p className="lead">
            Claude Code, Codex and OpenCode all use the same local Nexus. One shared Nexus is what keeps their sessions apart.
          </p>
        </div>

        <div className="grid grid-2">
          <div className="card">
            <span className="badge blue">Easiest</span>
            <h3 style={{ marginTop: 12 }}>One command</h3>
            <p>Use the agent's own command to point it at Nexus.</p>
            <CommandLine command="claude mcp add --transport http nexus http://localhost:3939/mcp" />
            <CommandLine command="codex mcp add --url http://localhost:3939/mcp nexus" />
          </div>
          <div className="card">
            <span className="badge">Or</span>
            <h3 style={{ marginTop: 12 }}>Let Nexus edit the config</h3>
            <p>For agents without a command, Nexus shows you the exact change first. It keeps a backup and only writes after you confirm.</p>
          </div>
          <div className="card">
            <h3>How Nexus knows the folder</h3>
            <p>Claude Code and OpenCode tell Nexus which folder they were started in. Codex doesn't, so its folder is pinned in the project's Codex config. If an agent tells Nexus nothing, Nexus says no.</p>
          </div>
          <div className="card">
            <h3>Already using MCP servers directly?</h3>
            <p>Nexus finds them and offers to move them over. Anything it can't handle is listed as "found, not managed", never hidden.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Comparison ---------- */
function Compare() {
  const rows: [string, string, string, string][] = [
    ["Made for", "Anyone", "Companies and teams", "One developer with several projects"],
    ["Setup", "Repeated in every project", "Done by an admin", "Link once, then bind per project"],
    ["Wrong-project mistakes", "Nothing stops them", "Not their focus", "Blocked before any call"],
    ["Agent holds the keys", "Yes", "Depends", "Never"],
  ];
  return (
    <section className="section" id="compare">
      <div className="container">
        <div className="section-head">
          <span className="label">Compared</span>
          <h2>Why not what you do now?</h2>
          <p className="lead">
            Big companies already have MCP gateways. Nexus is for one developer juggling several projects and several agents.
          </p>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="term-table compare-table">
              <thead>
                <tr><th></th><th>Keys and config in each project</th><th>Company MCP gateways</th><th className="us">Nexus</th></tr>
              </thead>
              <tbody>
                {rows.map(([a, b, c, d]) => (
                  <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td><td className="us">{d}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Where it stands ---------- */
function Roadmap() {
  return (
    <section className="section" id="roadmap">
      <div className="container">
        <div className="section-head">
          <span className="label">Where it stands</span>
          <h2>Early, and being tested on real projects first.</h2>
        </div>
        <div className="grid grid-3">
          <div className="card">
            <div className="phase-top"><span className="label">Now</span><span className="badge amber">In progress</span></div>
            <h3>The Linux app</h3>
            <p>Add projects, link accounts, connect agents, and watch it all on a live map. Still to prove: a full agent session from start to finish.</p>
          </div>
          <div className="card">
            <div className="phase-top"><span className="label">Next</span><span className="badge">Soon</span></div>
            <h3>Real-world test</h3>
            <p>Use it on the author's own projects for 2–3 weeks. It passes if it stays switched on and catches at least one real mistake.</p>
          </div>
          <div className="card">
            <div className="phase-top"><span className="label">Later</span><span className="badge">If it works</span></div>
            <h3>More of everything</h3>
            <p>More services, other developers, teams, and an optional extra called Guard that reviews risky actions.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Pricing proposal ---------- */
function Pricing() {
  return (
    <section className="section" id="pricing">
      <div className="container">
        <div className="section-head">
          <span className="label">Pricing · proposal</span>
          <h2>The core stays free.</h2>
          <p className="lead">
            These plans are a proposal. Nothing is charged, and nothing will be until testing is done.
          </p>
        </div>
        <div className="grid grid-3">
          <div className="card plan">
            <span className="label">Free</span>
            <div className="price">$0</div>
            <ul className="list">
              <li><span className="ok">✓</span><span>Up to 2 projects</span></li>
              <li><span className="ok">✓</span><span>Linking and routing</span></li>
            </ul>
          </div>
          <div className="card plan featured">
            <span className="label">Pro</span>
            <div className="price">~$10–12 <small>/ month, or ~$99 / year</small></div>
            <ul className="list">
              <li><span className="ok">✓</span><span>Unlimited projects and accounts</span></li>
              <li><span className="ok">✓</span><span>Longer history</span></li>
              <li><span className="ok">✓</span><span>Guard, once it exists</span></li>
            </ul>
          </div>
          <div className="card plan">
            <span className="label">Team / Agency</span>
            <div className="price">Later</div>
            <ul className="list">
              <li><span className="ok">✓</span><span>Shared projects</span></li>
              <li><span className="ok">✓</span><span>Per-client logs to show clients</span></li>
            </ul>
          </div>
        </div>
        <p className="fine">
          Freelancers and agencies, who work in clients' accounts, are the expected main users. We haven't decided between a subscription and a one-time license.
        </p>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
const FAQ: [string, string][] = [
  ["Does my agent ever see my keys?", "No. The agent asks Nexus, and Nexus makes the call with the right account's login. Your logins are kept in your computer's secure storage."],
  ["What if an agent skips Nexus?", "Then Nexus can't see or stop what it does. Nexus only protects what goes through it. It can find direct connections and offer to move them over."],
  ["How does Nexus know which project an agent is in?", "It reads the project file in the folder and checks the Git remote. Claude Code and OpenCode tell Nexus their folder. Codex doesn't, so its folder is pinned in config. If Nexus can't tell, or the clues disagree, it asks you instead of guessing."],
  ["Is every service protected equally?", "Not yet. For Supabase and GitHub, Nexus checks each action against the project's own resource. For the other services it keeps the right account, but it can't see which resource inside that account the agent names. For those, use one account per project."],
  ["Is it a password manager or a file sandbox?", "No. Nexus sends requests to the right account. It doesn't manage all your secrets, enforce company rules, or limit what an agent does to your files."],
  ["Which computers does it run on?", "Linux first."],
  ["What does it cost?", "The core stays free. The plans above are a proposal, and nothing is charged."],
  ["Can I try it now?", "Not yet. Join the list below and you'll get an email when the first Linux build is ready."],
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
              <a href="#roadmap">Where it stands</a>
              <a href="#pricing">Pricing</a>
              <a href="#faq">FAQ</a>
              <a href="/llms.txt">llms.txt</a>
            </div>
          </div>
        </div>
        <p className="footer-bottom">
          Early build, Linux first. Examples on this page are illustrations, and plans and prices are proposals.
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
        <Compare />
        <Roadmap />
        <Pricing />
        <Faq />
        <Waitlist />
      </main>
      <Footer theme={theme} />
    </>
  );
}
