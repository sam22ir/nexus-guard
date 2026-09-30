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
  { href: "#routing", label: "Routing" },
  { href: "#services", label: "Services" },
  { href: "#agents", label: "Agents" },
  { href: "#compare", label: "Compare" },
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
  { text: "Claude Code → Koupa → koupa-production · forwarded", tone: "green" },
  { text: "Codex → Nabdh → nabdh-development · forwarded", tone: "green" },
  { text: "Codex asked for koupa-production · refused, not bound to Nabdh", tone: "red" },
  { text: "OpenCode → Nabdh → nabdh-backend · forwarded", tone: "green" },
  { text: "Agent in ~/Projects/scratch · refused, unregistered project", tone: "red" },
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
          <button type="button" aria-pressed={!attempt} onClick={() => setAttempt(false)}>Two projects</button>
          <button type="button" aria-pressed={attempt} onClick={() => setAttempt(true)}>Cross-project attempt</button>
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
        <span><i className="dot green" /> flowing</span>
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
            <i className="dot" /> Building in the open · MVP in progress · Linux first
          </span>
          <h1 aria-label="Connect your agents once. Link your services once.">
            {"Connect your agents once. Link your services once.".split(" ").map((w, i) => (
              <span key={i} aria-hidden="true">
                <span className="word" style={{ ["--i" as string]: i }}>{w}</span>{" "}
              </span>
            ))}
          </h1>
          <p className="lead">
            Nexus sits between your coding agents and your services. It works out which project an agent is in and routes every call to that project's own account and resource, so an agent can never reach another project's services.
          </p>
          <div className="cta-row">
            <a href="#waitlist" className="btn btn-primary">Get notified <ArrowRight size={14} weight="bold" /></a>
            <a href="#routing" className="btn">See routing in action</a>
          </div>
          <p className="fine">
            For solo developers running several agents across several of their own projects. Not an enterprise governance tool.
          </p>
        </div>
        <Topology />
      </div>
    </section>
  );
}

/* ---------- Problem (paper §1) ---------- */
function Problem() {
  return (
    <section className="section" id="problem">
      <div className="container">
        <div className="section-head">
          <span className="label">The problem</span>
          <h2>Every project has its own accounts. Agents grab the wrong one.</h2>
          <p className="lead">
            Each project has its own Supabase, Clerk, GitHub and other accounts. Today you configure MCP servers inside every project, and agents end up reading or writing the wrong database, hitting production instead of development, or acting on Project B while believing they are in Project A. It gets worse with every extra agent.
          </p>
        </div>
        <div className="grid grid-2">
          <div className="card compare-card">
            <h3><span className="badge red">Without Nexus</span></h3>
            <ul className="list">
              <li><span className="x">✕</span><span><strong>MCP servers configured per project.</strong> Each agent inherits whatever credentials happen to be nearby.</span></li>
              <li><span className="x">✕</span><span><strong>Nothing checks the project.</strong> A Koupa agent can run a migration against Nabdh's database.</span></li>
              <li><span className="x">✕</span><span><strong>Agents hold the keys.</strong> Once a key is in the agent's hands, nobody can catch a mistake or revoke access mid-session.</span></li>
            </ul>
            <pre className="code"><code><span className="t">$ cd ~/Projects/Koupa</span>{"\n"}<span className="t">agent → supabase.execute(...)</span>{"\n"}<span className="r">↳ used Nabdh's linked login. Wrong database, no warning.</span></code></pre>
          </div>
          <div className="card compare-card">
            <h3><span className="badge green">With Nexus</span></h3>
            <ul className="list">
              <li><span className="ok">✓</span><span><strong>Link each account once.</strong> No per-project MCP setup. Agents connect only to Nexus.</span></li>
              <li><span className="ok">✓</span><span><strong>Routing is core and always on.</strong> Nexus resolves project, environment, account and resource before anything leaves your machine.</span></li>
              <li><span className="ok">✓</span><span><strong>Agents never hold the key.</strong> Nexus forwards the call with the bound account's credentials, so it can refuse or revoke at any point.</span></li>
            </ul>
            <pre className="code"><code><span className="t">$ cd ~/Projects/Koupa</span>{"\n"}<span className="t">agent → nexus.execute(service: "supabase")</span>{"\n"}<span className="g">↳ Koupa → production → Personal → koupa-production</span></code></pre>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- How it works (paper §2, §3) ---------- */
const CHAIN = ["Agent", "Session", "Project", "Environment", "Service", "Account", "Resource", "Capability"];

const HOW_STEPS = [
  { t: "Ask", d: "The agent asks Nexus for a capability, like \"I need Supabase access\". It does not choose the project or the credentials." },
  { t: "Resolve", d: "Nexus resolves the active project and environment, then the account and resource bound to them. No match, no registration, or an ambiguous signal means it refuses before anything reaches a provider." },
  { t: "Forward", d: "Nexus relays the call through the provider's MCP server or a native adapter, attaching the bound account's credentials. The result returns through Nexus." },
  { t: "Log", d: "Every routing decision and forwarded call goes to a simple local activity log. Never raw credentials." },
];

const TERMS = [
  ["Service", "An external provider Nexus can connect to.", "Supabase"],
  ["Account", "One linked login at a provider, with a human label.", "\"Personal\", \"Acme Client\""],
  ["Resource", "A specific thing inside an account.", "One Supabase project"],
  ["Project", "A registered Nexus project, i.e. a codebase.", "Koupa"],
  ["Environment", "Which stage of the project is active.", "development, production"],
  ["Binding", "A project's link to exactly one account + resource per service.", "Koupa → Supabase / Personal / koupa-production"],
  ["Session", "One connected agent, held server-side by Nexus.", "A Claude Code window"],
  ["Capability", "Permission to invoke one operation through Nexus, in one session.", "\"Run this Supabase query\""],
];

function HowItWorks() {
  const [lit, setLit] = useState(-1);
  const chainRef = useRef<HTMLDivElement>(null);

  /* Walk the chain link by link while it is on screen, then rest, then repeat. */
  useEffect(() => {
    if (REDUCED() || !chainRef.current) return;
    let timer = 0;
    let visible = false;
    const tick = () => {
      setLit((n) => (n >= CHAIN.length + 2 ? -1 : n + 1));
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      window.clearInterval(timer);
      if (visible) timer = window.setInterval(tick, 420);
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
          <h2>Every request resolves through one chain.</h2>
          <p className="lead">
            A project binds to a specific account and resource per service, never to a bare provider name. The same provider name never means the same resource.
          </p>
        </div>

        <div className="chain" aria-label="Canonical chain" ref={chainRef}>
          {CHAIN.map((c, i) => (
            <span key={c} style={{ display: "contents" }}>
              <span className={`chip ${i <= lit ? "lit" : ""}`}>{c}</span>
              {i < CHAIN.length - 1 && <span className={`arrow ${i < lit ? "lit" : ""}`} aria-hidden="true">→</span>}
            </span>
          ))}
        </div>

        <div className="grid grid-4">
          {HOW_STEPS.map((s, i) => (
            <div className="card" key={s.t}>
              <span className="step-num">0{i + 1}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>

        <div className="neq">
          <div>Supabase + Project A <b>≠</b> Supabase + Project B</div>
          <div>Supabase + Production <b>≠</b> Supabase + Development</div>
          <div>Supabase Account 1 + Resource X <b>≠</b> Supabase Account 2 + Resource X</div>
        </div>

        <details className="terms">
          <summary>Glossary: what each word in the chain means</summary>
          <div className="table-wrap">
            <table className="term-table">
              <thead>
                <tr><th>Term</th><th>Meaning</th><th>Example</th></tr>
              </thead>
              <tbody>
                {TERMS.map(([t, m, e]) => (
                  <tr key={t}><td>{t}</td><td>{m}</td><td className="mono">{e}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <div className="card" style={{ marginTop: 24 }}>
          <h3>Nexus stays in the execution path</h3>
          <p>
            The agent calls through Nexus and Nexus forwards with the bound account's credentials. An agent is never handed a raw credential or a permanent, unsupervised connection to a provider. Otherwise Nexus could no longer catch a project mismatch or revoke access mid-session.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------- Routing simulator (illustration of §3, §7) ---------- */
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
    badge: "Forwarded",
    summary: "Claude Code in ~/Projects/Koupa asks for Supabase.",
    trace: [
      { t: "Session", s: "ok" },
      { t: "Project: koupa", s: "ok" },
      { t: "Env: production", s: "ok" },
      { t: "Account: Personal", s: "ok" },
      { t: "Resource: koupa-production", s: "ok" },
      { t: "Forwarded", s: "ok" },
    ],
    request: `{
  "method": "nexus.request_access",
  "params": {
    "service": "supabase"
  }
}`,
    response: `{
  "result": {
    "project": "koupa",
    "environment": "production",
    "account": "Personal",
    "resource": "koupa-production",
    "forwarded": true,
    "credential_returned": false
  }
}`,
    why: "The agent named only the service. Nexus resolved the project from .nexus/project.json, found the binding, and forwards with that account's credentials. The key never reaches the agent.",
  },
  {
    id: "cross",
    title: "Wrong project",
    tone: "red",
    badge: "Refused",
    summary: "Codex in ~/Projects/Nabdh asks for Koupa's database.",
    trace: [
      { t: "Session", s: "ok" },
      { t: "Project: nabdh", s: "ok" },
      { t: "Env: development", s: "ok" },
      { t: "Resource: koupa-production", s: "fail" },
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
    "data": {
      "reason": "resource_not_bound_to_project",
      "session_project": "nabdh",
      "requested": "koupa-production",
      "bound_resource": "nabdh-development"
    }
  }
}`,
    why: "koupa-production is bound to Koupa, and this session resolves to Nabdh. It is refused structurally, with no risk evaluation and no call to the provider.",
  },
  {
    id: "unregistered",
    title: "Unregistered folder",
    tone: "red",
    badge: "Refused",
    summary: "An agent in ~/Projects/scratch, which is not a registered project.",
    trace: [
      { t: "Session", s: "ok" },
      { t: "Project: none registered", s: "fail" },
      { t: "Refused", s: "fail" },
    ],
    request: `{
  "method": "nexus.request_access",
  "params": {
    "service": "supabase"
  }
}`,
    response: `{
  "error": {
    "message": "Refused",
    "data": {
      "reason": "unregistered_project",
      "workspace": "~/Projects/scratch",
      "hint": "Register this project in Nexus to bind services"
    }
  }
}`,
    why: "Discovering a project does not create it. Only the developer can register one, so Nexus refuses instead of guessing.",
  },
  {
    id: "conflict",
    title: "Conflicting signals",
    tone: "amber",
    badge: "Asks you",
    summary: "The folder's .nexus/project.json says Koupa, but its Git remote matches Nabdh.",
    trace: [
      { t: "Session", s: "ok" },
      { t: "Project: koupa vs nabdh", s: "warn" },
      { t: "Waiting for you", s: "warn" },
    ],
    request: `{
  "method": "nexus.context",
  "params": {}
}`,
    response: `{
  "result": {
    "status": "conflict",
    "signals": {
      "project_file": "koupa",
      "git_remote": "nabdh"
    },
    "action": "waiting for developer",
    "forwarded": false
  }
}`,
    why: "When signals conflict, Nexus surfaces the conflict and asks. It never silently guesses, and nothing is forwarded until you confirm.",
  },
];

function Routing() {
  const [id, setId] = useState("ok");
  const s = useMemo(() => SCENARIOS.find((x) => x.id === id)!, [id]);
  const [shown, setShown] = useState(0);
  const done = shown >= s.trace.length;

  /* Play the resolution step by step, then reveal Nexus's answer. */
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
          <span className="label">Routing</span>
          <h2>Wrong-project access is impossible by construction.</h2>
          <p className="lead">
            Routing is core and always on. Nothing here is a risk score. An unresolved or unregistered request is refused before any call is made. Pick a scenario. These are illustrations of the agent-facing MCP surface, not live output.
          </p>
        </div>

        <div className="sim-scenarios" role="group" aria-label="Scenarios">
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
          <div className="trace" aria-label="Resolution steps">
            {s.trace.map((step, i) => (
              <span key={`${s.id}-${i}`} className="trace-step">
                <span className={`tr ${i < shown ? `on ${step.s}` : ""}`}>{step.t}</span>
                {i < s.trace.length - 1 && <span className={`tr-arrow ${i + 1 < shown ? "on" : ""}`} aria-hidden="true">→</span>}
              </span>
            ))}
          </div>
          <div className="sim-cols">
            <div key={`${s.id}-req`} className="swap">
              <span className="label">Agent → Nexus</span>
              <pre className="code"><code>{s.request}</code></pre>
            </div>
            <div key={`${s.id}-res`} className={`swap ${done ? "" : "pending"}`}>
              <span className="label">Nexus → Agent</span>
              <pre className="code"><code>{s.response}</code></pre>
            </div>
          </div>
          <div className={`sim-why ${done ? "" : "pending"}`}>{s.why}</div>
        </div>

        <p className="fine">
          The agent-facing surface stays small: <code>nexus.context</code>, <code>nexus.request_access</code> and <code>nexus.execute</code>.
        </p>
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
          <span className="label">Service catalog</span>
          <h2>About 50 of the most-used services on day one.</h2>
          <p className="lead">
            Link each account once, with a human label like "Personal" or "Acme Client". Then bind account and resource per project, picking the resource from a live list fetched from that account, never typed by hand. If one account is bound to several projects, Nexus flags the shared blast radius.
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
            No match in the starting catalog. Anything else can be added as a Self-added service after a one-time confirmation.
          </p>
        ) : (
          <div className="svc-grid">
            {shown.map((s, i) => (
              <div className="svc" key={`${cat}-${s.name}`} style={{ ["--i" as string]: Math.min(i, 14) }}>
                <div className="svc-top">
                  <strong>{s.name}</strong>
                  <span className={`badge ${s.tier === "Native" ? "green" : ""}`}>{s.tier ?? "Curated"}</span>
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
            <span className="badge green">Native</span>
            <h3 style={{ marginTop: 12 }}>Hand-built adapter</h3>
            <p>Supabase and GitHub. Every operation reviewed.</p>
          </div>
          <div className="card">
            <span className="badge">Curated</span>
            <h3 style={{ marginTop: 12 }}>In the catalog</h3>
            <p>The other ~48. Verified to exist, named, categorized, and connected through generic MCP forwarding. Operations are not individually reviewed.</p>
          </div>
          <div className="card">
            <span className="badge amber">Self-added</span>
            <h3 style={{ marginTop: 12 }}>Add a service not in Nexus</h3>
            <p>Unverified. You confirm once that Nexus has not reviewed it and accept the risk for your own additions.</p>
          </div>
        </div>
        <p className="fine">
          The starting list is a proposal and still under review. Each entry must be verified to have a working MCP server before it ships. The catalog is bundled locally, so search works offline. It is meant to grow toward 300–500 entries later.
        </p>
      </div>
    </section>
  );
}

/* ---------- Agents (paper §6) ---------- */
function Agents() {
  return (
    <section className="section" id="agents">
      <div className="container">
        <div className="section-head">
          <span className="label">Agents</span>
          <h2>One local Nexus. Every agent points at it.</h2>
          <p className="lead">
            Claude Code, Codex, OpenCode and others connect to a single persistent local Nexus over HTTP, never a separate subprocess per agent. One instance is what keeps sessions isolated from each other.
          </p>
        </div>

        <div className="grid grid-2">
          <div className="card">
            <span className="badge blue">Preferred</span>
            <h3 style={{ marginTop: 12 }}>Official CLI command</h3>
            <p>Where an agent has one, Nexus uses it instead of hand-editing config, so it inherits the agent's own validation.</p>
            <CommandLine command="claude mcp add --transport http nexus http://localhost:3939/mcp" />
            <CommandLine command="codex mcp add --url http://localhost:3939/mcp nexus" />
          </div>
          <div className="card">
            <span className="badge">Fallback</span>
            <h3 style={{ marginTop: 12 }}>Semi-automatic config edit</h3>
            <p>For agents without an add command, Nexus detects the config file, prepares the edit in memory, and shows a confirm/dismiss step with a diff.</p>
            <ul className="list">
              <li><span className="ok">✓</span><span>Nothing is written on dismiss</span></li>
              <li><span className="ok">✓</span><span>A differing existing entry is an explicit replace, never a silent merge</span></li>
              <li><span className="ok">✓</span><span>A timestamped backup is kept before any write</span></li>
              <li><span className="ok">✓</span><span>Every path ends with a live test-connection check</span></li>
            </ul>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3>Import the connections you already have</h3>
          <p>Direct MCP servers keep running unmanaged unless you migrate them, so Nexus finds them first.</p>
          <ol className="numbered">
            <li><span><strong>Detect.</strong> Read the agent's MCP config or its list command.</span></li>
            <li><span><strong>Classify.</strong> Match entries against known provider signatures.</span></li>
            <li><span><strong>Extract where possible.</strong> A static token becomes a new Nexus account. An OAuth connection asks you to re-authenticate through Nexus.</span></li>
            <li><span><strong>Remove the direct entry, with confirmation.</strong> Same diff and backup pattern.</span></li>
            <li><span><strong>Keep the rest visible.</strong> Anything unsupported shows as "found, unmanaged", never ignored.</span></li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ---------- Guarantees and limits (paper §1, §8, §10) ---------- */
function Guarantees() {
  return (
    <section className="section" id="guarantees">
      <div className="container">
        <div className="section-head">
          <span className="label">Rules and limits</span>
          <h2>What Nexus promises, and what it does not.</h2>
        </div>
        <div className="grid grid-3">
          <div className="card">
            <h3>You stay in control</h3>
            <ul className="list">
              <li><span className="ok">✓</span><span>Only you can change bindings or permissions. An agent can propose a mapping change, never approve it.</span></li>
              <li><span className="ok">✓</span><span>Branch, workspace, and external <code>.nexus/project.json</code> changes need your confirmation.</span></li>
              <li><span className="ok">✓</span><span>Conflicting signals surface and ask. Nexus never silently guesses.</span></li>
            </ul>
          </div>
          <div className="card">
            <h3>Secret-free by design</h3>
            <p>Each project keeps a secret-free <code>.nexus/project.json</code> binding file. Credentials live in OS secure storage.</p>
            <pre className="code"><code>{`{
  "project": "koupa",
  "connections": {
    "supabase": {
      "account": "personal",
      "resource": "koupa-production"
    }
  }
}`}</code></pre>
          </div>
          <div className="card">
            <h3>Honest about isolation</h3>
            <p>
              <strong>Native adapters</strong> (Supabase, GitHub) understand each operation, so Nexus can pin every call to the bound resource. For <strong>Curated and Self-added</strong> services the guarantee today is account-level, not resource-level, so use one account per project for those. How to tighten this is an open question.
            </p>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3>What Nexus is not</h3>
          <ul className="list">
            <li><span className="x">✕</span><span><strong>Not a vault or password manager.</strong> It routes; it is not a general secrets store.</span></li>
            <li><span className="x">✕</span><span><strong>Not an enterprise governance or compliance platform.</strong> Built for one developer, not for teams and SSO.</span></li>
            <li><span className="x">✕</span><span><strong>Not a filesystem sandbox.</strong> Its boundary is infrastructure and provider access. Anything an agent does outside Nexus is unmanaged, not protected.</span></li>
            <li><span className="x">✕</span><span><strong>Not (yet) a policy engine.</strong> Rollback of a provider-side action belongs to the provider.</span></li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------- First five minutes (paper §12 onboarding) ---------- */
function Setup() {
  const steps = [
    { t: "Register a project", d: "Name it and point to its folder. Nexus writes a secret-free .nexus/project.json. Discovering a project never creates one." },
    { t: "Link an account once", d: "Sign in to Supabase or GitHub (the native adapters). The credential goes to OS secure storage, not to any project." },
    { t: "Connect an agent", d: "One command points the agent at your local Nexus. Nexus then runs a live test-connection check." },
    { t: "Watch the first line light up", d: "Make a harmless call and see it routed to the right resource in the topology. That is the proof moment." },
  ];
  return (
    <section className="section" id="setup">
      <div className="container">
        <div className="section-head">
          <span className="label">The first five minutes</span>
          <h2>One project, one account, one agent, one proof.</h2>
          <p className="lead">
            Setup is built so the value shows up before the novelty wears off: each step adds a node to your graph, and the last one shows a real call finding its way.
          </p>
        </div>
        <div className="grid grid-4">
          {steps.map((s, i) => (
            <div className="card" key={s.t}>
              <span className="step-num">0{i + 1}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
              {i === 2 && <CommandLine command="claude mcp add --transport http nexus http://localhost:3939/mcp" />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Comparison ---------- */
function Compare() {
  const rows: [string, string, string, string][] = [
    ["Built for", "Whoever set up the project", "Organizations and platform teams", "One developer running several agents across their own projects"],
    ["Setup", "MCP servers and keys configured inside every project", "Central, managed by an admin", "Link each account once, bind per project"],
    ["Wrong-project access", "Nothing checks it", "Not designed around one developer's several projects", "Refused before any call is made"],
    ["Agent holds the credential", "Yes", "Varies by product", "Never. Nexus forwards with the bound account's credentials"],
  ];
  return (
    <section className="section" id="compare">
      <div className="container">
        <div className="section-head">
          <span className="label">Compared</span>
          <h2>Why not what you already do?</h2>
          <p className="lead">
            MCP gateways from Composio, Cloudflare, Portkey, Kong and others are funded and aimed at enterprises. The gap Nexus starts in is smaller and specific: one developer, several of their own projects, several agents at once.
          </p>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="term-table compare-table">
              <thead>
                <tr><th></th><th>Per-project config and .env</th><th>Enterprise MCP gateways</th><th className="us">Nexus</th></tr>
              </thead>
              <tbody>
                {rows.map(([a, b, c, d]) => (
                  <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td><td className="us">{d}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="fine">
          Closest prior art is credroute, a CLI that resolves which identity to use per client, project and platform and verifies it before handoff. Nexus differs by never letting the agent hold the credential.
        </p>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
const FAQ: [string, string][] = [
  ["Does my agent ever see my keys?", "No. The agent asks Nexus for a capability, and Nexus forwards the call using the bound account's credentials. Credentials live in OS secure storage."],
  ["What if an agent bypasses Nexus?", "Then Nexus cannot see or stop it. Anything outside Nexus is unmanaged, not protected. That is why the import step finds direct MCP connections and offers to migrate them, with your confirmation."],
  ["How does Nexus know which project an agent is in?", "From signals in priority order: an explicit .nexus/project.json, previously verified mappings, Git identity, then auto-discovery. Agent-stated intent is never enough on its own. How each agent reports its working directory over a shared HTTP endpoint is being verified per agent, and when a client sends nothing, Nexus refuses."],
  ["Which agents work with it?", "Claude Code, Codex and OpenCode first, over MCP on a single local HTTP endpoint. Each agent's real MCP support is verified before Nexus builds against it."],
  ["Is it a vault or a governance platform?", "No. It routes requests to the right account and resource. It is not a general secrets manager, an enterprise compliance tool, or a filesystem sandbox."],
  ["What does it cost?", "Core routing stays free by design. The plans on this page are a proposal, and nothing is billed. An open-core model is under consideration."],
  ["What platforms?", "Linux first."],
];

function Faq() {
  return (
    <section className="section" id="faq">
      <div className="container">
        <div className="section-head">
          <span className="label">FAQ</span>
          <h2>The questions worth asking first.</h2>
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

/* ---------- Roadmap and status (paper §5, §9) ---------- */
function Roadmap() {
  return (
    <section className="section" id="roadmap">
      <div className="container">
        <div className="section-head">
          <span className="label">Roadmap and status</span>
          <h2>Built for its author first, then validated.</h2>
          <p className="lead">
            The first user is the builder. Nexus runs against real projects (Koupa, Marché, Nabdh, Green Algeria) for 2–3 weeks. Success means it stays turned on after the novelty wears off and catches at least one real mistake. Failure means it gets disabled for being more friction than protection.
          </p>
        </div>
        <div className="grid grid-4">
          <div className="card">
            <div className="phase-top"><span className="label">Phase 1</span><span className="badge green">Started</span></div>
            <h3>Foundation</h3>
            <p>Project registry, <code>.nexus/project.json</code>, workspace and repo detection.</p>
          </div>
          <div className="card">
            <div className="phase-top"><span className="label">Phase 2</span><span className="badge amber">In progress</span></div>
            <h3>Broker core</h3>
            <p>Native adapters, generic MCP forwarding, concurrent sessions, the ~50 service catalog, and the topology view with drag-to-link.</p>
          </div>
          <div className="card">
            <div className="phase-top"><span className="label">Phase 3</span><span className="badge">Next</span></div>
            <h3>Validation</h3>
            <p>Run it on the author's own projects and decide whether it earns a permanent place in the workflow.</p>
          </div>
          <div className="card">
            <div className="phase-top"><span className="label">Phase 4</span><span className="badge">Only if it proves out</span></div>
            <h3>Later</h3>
            <p>Catalog growth toward 300–500 entries, other solo and indie users, team features, and Guard (see below).</p>
          </div>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Guard: possible later, not built</h3>
          <p>
            Routing already makes cross-project access impossible. Guard would cover "right project, wrong move": allow, warn, require approval or block on destructive or production actions, plus spend limits for consumption-priced services. It was moved out of the MVP on 2026-09-28 and may become a paid layer if the MVP proves out.
          </p>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>What exists today</h3>
          <p>
            A Linux desktop app with navigation and a Home topology view (agents, projects, service accounts, edges for flowing, refused and no-traffic states). Agent names come from the MCP handshake, one server per session. Native adapters for Supabase and GitHub. Every other service is fail-closed for now. This is builder-reported status, not a released product, and end-to-end validation over the single HTTP transport is still pending.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------- Pricing proposal (paper §16) ---------- */
function Pricing() {
  return (
    <section className="section" id="pricing">
      <div className="container">
        <div className="section-head">
          <span className="label">Pricing · proposal</span>
          <h2>Core routing stays free.</h2>
          <p className="lead">
            Routing is what makes the cross-project promise structural, so it is not something to sell. These plans are a proposal, not final. Nothing is billed, and no billing work starts before validation is complete.
          </p>
        </div>
        <div className="grid grid-3">
          <div className="card plan">
            <span className="label">Free</span>
            <div className="price">$0</div>
            <ul className="list">
              <li><span className="ok">✓</span><span>Up to 2 projects</span></li>
              <li><span className="ok">✓</span><span>Core linking and routing</span></li>
              <li><span className="ok">✓</span><span>Enough to feel the value</span></li>
            </ul>
          </div>
          <div className="card plan featured">
            <span className="label">Pro</span>
            <div className="price">~$10–12 <small>/ month, or ~$99 / year</small></div>
            <ul className="list">
              <li><span className="ok">✓</span><span>Unlimited projects and linked accounts</span></li>
              <li><span className="ok">✓</span><span>Longer activity history</span></li>
              <li><span className="ok">✓</span><span>Guard, once it exists</span></li>
            </ul>
          </div>
          <div className="card plan">
            <span className="label">Team / Agency</span>
            <div className="price">Later</div>
            <ul className="list">
              <li><span className="ok">✓</span><span>Shared projects and bindings</span></li>
              <li><span className="ok">✓</span><span>Per-client audit logs you can show a client</span></li>
            </ul>
          </div>
        </div>
        <p className="fine">
          Freelancers and small agencies managing client accounts are the expected strongest segment: an agent acting on the wrong client's account is a business problem. Subscription versus one-time license, and an open-core option for the routing core, are still undecided.
        </p>
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
          One email, used only for launch news: the first Linux build, and the plans above once they are decided.
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
              <a href="#routing">Routing</a>
              <a href="#services">Service catalog</a>
              <a href="#agents">Agents</a>
            </div>
            <div>
              <span className="label">Project</span>
              <a href="#roadmap">Roadmap</a>
              <a href="#pricing">Pricing proposal</a>
              <a href="/llms.txt">llms.txt</a>
            </div>
          </div>
        </div>
        <p className="footer-bottom">
          MVP in progress. Linux first. Illustrations on this page are not live output, and plans and pricing are proposals.
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
        <Setup />
        <HowItWorks />
        <Routing />
        <Catalog />
        <Agents />
        <Compare />
        <Guarantees />
        <Roadmap />
        <Pricing />
        <Faq />
        <Waitlist />
      </main>
      <Footer theme={theme} />
    </>
  );
}
