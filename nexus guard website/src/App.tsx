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
  siAirtable, siClaude, siCloudflare, siCloudinary, siConfluence, siCursor, siFigma, siGithub,
  siGitlab, siGooglegemini, siHuggingface, siJira, siLinear, siMixpanel, siNeon, siNetlify,
  siNotion, siOpencode, siPaypal, siPlanetscale, siPosthog, siRailway, siResend, siSanity,
  siSentry, siStripe, siSupabase, siVercel, siWebflow, siWindsurf, siZapier,
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
        "main > section:not(.hero) .section-head, main > section:not(.hero) .card, .prob-head, .demo-left > *, .link-demo > *, .agent-facts > *, .plan-card, .sim-scenarios, .cat-toolbar, .chips, .term-table",
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
          <a href="#download" className="btn btn-primary nav-cta">Get the alpha</a>
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
        <a href="#download" onClick={() => setOpen(false)}>Get the alpha</a>
      </nav>
    </header>
  );
}

/* --------------------------------------------------------------------------
   Topology: fixed columns, agents | projects | service accounts (paper §12).
   Read-only illustration. Line colors are status only.
   -------------------------------------------------------------------------- */
type ProjectName = "Koupa" | "Nabdh";
type Focus = { kind: "agent" | "project" | "service"; id: string } | null;

/* Column geometry: agents | projects | service accounts. */
const AX = 6, PX = 222, SX = 438, W = 170, WS = 198, H = 60;
const FOLDER_PATH = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";

const T_AGENTS: { id: string; name: string; logoIdx: number; project: ProjectName; y: number }[] = [
  { id: "claude", name: "Claude Code", logoIdx: 0, project: "Koupa", y: 74 },
  { id: "codex", name: "Codex", logoIdx: 1, project: "Nabdh", y: 176 },
  { id: "opencode", name: "OpenCode", logoIdx: 2, project: "Nabdh", y: 278 },
];
const T_PROJECTS: { name: ProjectName; sub: string; y: number }[] = [
  { name: "Koupa", sub: "production", y: 118 },
  { name: "Nabdh", sub: "development", y: 246 },
];
const T_SERVICES: { id: string; svc: string; account: string; resource: string; tier: "BUILT-IN" | "SIGN-IN"; project: ProjectName; y: number }[] = [
  { id: "k-sb", svc: "Supabase", account: "Personal", resource: "koupa-production", tier: "BUILT-IN", project: "Koupa", y: 52 },
  { id: "k-gh", svc: "GitHub", account: "Personal", resource: "koupa", tier: "BUILT-IN", project: "Koupa", y: 132 },
  { id: "n-sb", svc: "Supabase", account: "Client", resource: "nabdh-development", tier: "BUILT-IN", project: "Nabdh", y: 212 },
  { id: "n-nt", svc: "Notion", account: "Personal", resource: "Nabdh docs", tier: "SIGN-IN", project: "Nabdh", y: 292 },
];

function edge(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

const FEED: { text: string; tone: "green" | "red" }[] = [
  { text: "Claude Code → Koupa → koupa-production · sent", tone: "green" },
  { text: "Codex → Nabdh → nabdh-development · sent", tone: "green" },
  { text: "Codex asked for koupa-production · refused, it belongs to Koupa", tone: "red" },
  { text: "OpenCode → Nabdh → Notion · read · sent", tone: "green" },
  { text: "OpenCode asked Notion to edit a page · refused, writes are off", tone: "red" },
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

/* A logo on a softly tinted tile, drawn inside the SVG. */
function SvgTile({ x, y, logo, folder }: { x: number; y: number; logo?: Logo; folder?: boolean }) {
  const color = logo?.color;
  return (
    <g>
      <rect x={x} y={y} width="30" height="30" rx="9" fill={color ? `color-mix(in srgb, ${color} 16%, transparent)` : "var(--raised)"} />
      <svg x={x + 6} y={y + 6} width="18" height="18" viewBox="0 0 24 24">
        <path d={folder ? FOLDER_PATH : logo?.path} fill={folder ? "none" : color ?? "var(--text)"} stroke={folder ? "var(--muted)" : "none"} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </g>
  );
}

function Topology() {
  const [focus, setFocus] = useState<Focus>(null);
  const [attempt, setAttempt] = useState(false);
  const [feedIdx, setFeedIdx] = useState(0);

  useEffect(() => {
    if (REDUCED()) return;
    const id = setInterval(() => setFeedIdx((i) => (i + 1) % FEED.length), 2600);
    return () => clearInterval(id);
  }, []);

  const projY = (n: ProjectName) => T_PROJECTS.find((p) => p.name === n)!.y;
  const koupaSb = T_SERVICES[0];

  /* What a focused node highlights: the path that runs through it. */
  const active = useMemo(() => {
    const agents = new Set<string>();
    const projects = new Set<string>();
    const services = new Set<string>();
    if (!focus) {
      T_AGENTS.forEach((a) => agents.add(a.id));
      T_PROJECTS.forEach((p) => projects.add(p.name));
      T_SERVICES.forEach((s) => services.add(s.id));
    } else if (focus.kind === "project") {
      projects.add(focus.id);
      T_AGENTS.filter((a) => a.project === focus.id).forEach((a) => agents.add(a.id));
      T_SERVICES.filter((s) => s.project === focus.id).forEach((s) => services.add(s.id));
    } else if (focus.kind === "agent") {
      const a = T_AGENTS.find((x) => x.id === focus.id)!;
      agents.add(a.id);
      projects.add(a.project);
      T_SERVICES.filter((s) => s.project === a.project).forEach((s) => services.add(s.id));
    } else {
      const s = T_SERVICES.find((x) => x.id === focus.id)!;
      services.add(s.id);
      projects.add(s.project);
      T_AGENTS.filter((a) => a.project === s.project).forEach((a) => agents.add(a.id));
    }
    return { agents, projects, services };
  }, [focus]);

  const focusText = useMemo(() => {
    if (!focus) return null;
    const names = (arr: string[]) => arr.join(", ");
    if (focus.kind === "project") {
      const ag = T_AGENTS.filter((a) => a.project === focus.id).map((a) => a.name);
      const rs = T_SERVICES.filter((s) => s.project === focus.id).map((s) => s.resource);
      return `${names(ag)} → ${focus.id} → ${names(rs)}`;
    }
    if (focus.kind === "agent") {
      const a = T_AGENTS.find((x) => x.id === focus.id)!;
      const rs = T_SERVICES.filter((s) => s.project === a.project).map((s) => s.resource);
      return `${a.name} → ${a.project} → ${names(rs)}`;
    }
    const s = T_SERVICES.find((x) => x.id === focus.id)!;
    const ag = T_AGENTS.filter((a) => a.project === s.project).map((a) => a.name);
    return `${names(ag)} → ${s.project} → ${s.resource}`;
  }, [focus]);

  const toggle = (kind: "agent" | "project" | "service", id: string) =>
    setFocus((cur) => (cur && cur.kind === kind && cur.id === id ? null : { kind, id }));
  const isFocus = (kind: string, id: string) => focus?.kind === kind && focus.id === id;
  const press = (kind: "agent" | "project" | "service", id: string) => ({
    role: "button" as const,
    tabIndex: 0,
    "aria-pressed": isFocus(kind, id),
    style: { cursor: "pointer" },
    onClick: () => toggle(kind, id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle(kind, id);
      }
    },
  });

  const agentEdgeOn = (a: (typeof T_AGENTS)[number]) => active.agents.has(a.id) && active.projects.has(a.project);
  const svcEdgeOn = (s: (typeof T_SERVICES)[number]) => active.services.has(s.id) && active.projects.has(s.project);

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
        <svg viewBox="0 0 642 340" role="group" aria-label="Agents, projects and service accounts. Each agent is routed to its own project's resources.">
          <text className="t-col" x={AX + 4} y="16">AGENTS</text>
          <text className="t-col" x={PX + 4} y="16">PROJECTS</text>
          <text className="t-col" x={SX + 4} y="16">SERVICE ACCOUNTS</text>

          {T_AGENTS.map((a) => (
            <path key={a.id} className={`t-line green ${agentEdgeOn(a) ? "" : "dim"}`} d={edge(AX + W, a.y, PX, projY(a.project))} />
          ))}
          {T_SERVICES.map((s) => (
            <path key={s.id} className={`t-line green ${svcEdgeOn(s) ? "" : "dim"}`} d={edge(PX + W, projY(s.project), SX, s.y)} />
          ))}
          {T_AGENTS.filter(agentEdgeOn).map((a, i) => (
            <Packet key={`pa-${a.id}`} d={edge(AX + W, a.y, PX, projY(a.project))} begin={i * 0.9} from={0.02} to={0.45} />
          ))}
          {T_SERVICES.filter(svcEdgeOn).map((s, i) => (
            <Packet key={`ps-${s.id}`} d={edge(PX + W, projY(s.project), SX, s.y)} begin={i * 0.9} from={0.5} to={0.95} />
          ))}
          {attempt && (
            <g>
              <path className="t-line red" d={edge(PX + W, projY("Nabdh"), SX, koupaSb.y + 14)} />
              <circle className="t-packet" r="3.5" fill="var(--red)" opacity="0">
                <animate attributeName="opacity" values="0;1;0" keyTimes="0;0.02;0.62" calcMode="discrete" dur="3.6s" repeatCount="indefinite" />
                <animateMotion dur="3.6s" repeatCount="indefinite" path={edge(PX + W, projY("Nabdh"), SX, koupaSb.y + 14)} keyPoints="0;0;0.55;0.55" keyTimes="0;0.02;0.55;1" calcMode="linear" />
              </circle>
              <text className="t-x" textAnchor="middle" dominantBaseline="central" opacity="0">
                ✕
                <animate attributeName="opacity" values="0;1;0" keyTimes="0;0.56;0.95" calcMode="discrete" dur="3.6s" repeatCount="indefinite" />
                <animateMotion dur="3.6s" repeatCount="indefinite" path={edge(PX + W, projY("Nabdh"), SX, koupaSb.y + 14)} keyPoints="0.56;0.56" keyTimes="0;1" calcMode="linear" />
              </text>
              <text className="t-tag red" x={PX + W + 6} y={176}>REFUSED BEFORE ANY CALL</text>
            </g>
          )}

          {T_AGENTS.map((a) => (
            <g key={a.id} className={`t-node ${active.agents.has(a.id) ? "" : "dim"}`} aria-label={`Follow ${a.name}`} {...press("agent", a.id)}>
              <rect className={`t-card ${isFocus("agent", a.id) ? "focus" : ""}`} x={AX} y={a.y - H / 2} width={W} height={H} rx="14" />
              <SvgTile x={AX + 12} y={a.y - 15} logo={AGENT_LOGOS[a.logoIdx]} />
              <text className="t-name" x={AX + 54} y={a.y - 3}>{a.name}</text>
              <text className="t-sub" x={AX + 54} y={a.y + 14}>{a.project} folder</text>
            </g>
          ))}

          {T_PROJECTS.map((p) => (
            <g key={p.name} className={`t-node ${active.projects.has(p.name) ? "" : "dim"}`} aria-label={`Follow ${p.name}`} {...press("project", p.name)}>
              <rect className={`t-card ${isFocus("project", p.name) ? "focus" : ""}`} x={PX} y={p.y - H / 2} width={W} height={H} rx="14" />
              <SvgTile x={PX + 12} y={p.y - 15} folder />
              <text className="t-name" x={PX + 54} y={p.y - 3}>{p.name}</text>
              <text className="t-sub" x={PX + 54} y={p.y + 14}>{p.sub}</text>
            </g>
          ))}

          {T_SERVICES.map((s) => (
            <g key={s.id} className={`t-node ${active.services.has(s.id) ? "" : "dim"}`} aria-label={`Follow ${s.svc} ${s.account}`} {...press("service", s.id)}>
              <rect className={`t-card ${isFocus("service", s.id) ? "focus" : ""}`} x={SX} y={s.y - H / 2} width={WS} height={H} rx="14" />
              <SvgTile x={SX + 12} y={s.y - 15} logo={SERVICE_ICON[s.svc]} />
              <text className="t-name" x={SX + 54} y={s.y - 3}>{s.svc} · {s.account}</text>
              <text className="t-sub" x={SX + 54} y={s.y + 14}>{s.resource}</text>
              <text className={`t-tag ${s.tier === "BUILT-IN" ? "green" : "faint"}`} x={SX + WS - 12} y={s.y - H / 2 + 14} textAnchor="end">{s.tier}</text>
            </g>
          ))}
        </svg>
      </div>

      <div className="topo-foot">
        <span><i className="dot green" /> sent</span>
        <span><i className="dot" style={{ background: "var(--red)" }} /> refused</span>
        <span className="muted">Click any node to follow its path.</span>
      </div>
      <div className="feed" aria-live="polite">
        {focusText ? (
          <>
            <span className="label">Path</span>
            <span key={focusText} className="feed-line">{focusText}</span>
          </>
        ) : (
          <>
            <span className="label">Activity</span>
            <span key={feedIdx} className={`feed-line ${FEED[feedIdx].tone}`}>
              <i className="dot" style={{ background: FEED[feedIdx].tone === "green" ? "var(--green)" : "var(--red)" }} />
              {FEED[feedIdx].text}
            </span>
          </>
        )}
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
];

const SERVICE_LOGOS: Logo[] = [
  brand("Supabase", siSupabase),
  brand("Stripe", siStripe),
  brand("Cloudflare", siCloudflare),
  brand("Notion", siNotion),
  brand("GitHub", siGithub),
  brand("Sentry", siSentry),
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
            <a href="#download" className="btn btn-primary">Get the alpha <ArrowRight size={14} weight="bold" /></a>
            <a href="#routing" className="btn">See how it works</a>
          </div>
          <p className="fine">
            Made for one developer running several agents across several projects. Linux, macOS and Windows.
          </p>
        </div>
        <Topology />
      </div>
    </section>
  );
}

/* ---------- Problem ---------- */
type PMode = "today" | "nexus";

/* The mistake as a picture: one agent, one key, two databases. */
function ProblemDiagram({ mode }: { mode: PMode }) {
  const today = mode === "today";
  const claude = AGENT_LOGOS[0];
  const sb = SERVICE_ICON["Supabase"];
  const fade = (on: boolean) => ({ opacity: on ? 1 : 0, transition: "opacity 0.5s var(--ease)" });
  /* the key sits on the agent today, and inside Nexus once Nexus holds it */
  const keyAt = today ? "translate(372px, 30px)" : "translate(201px, 174px)";
  const pathToday = "M 260 76 C 260 150, 390 190, 390 286";
  const pathA = "M 260 76 L 260 140";
  const pathB = "M 260 204 C 260 252, 130 238, 130 286";

  return (
    <svg className="pd" viewBox="0 0 520 372" role="img" aria-label={today ? "Today: the agent carries its own key straight to Nabdh's database, with nothing checking it." : "With Nexus: Nexus holds the key, checks the project, and routes the call to Koupa's database."}>
      {/* connections */}
      <g key={mode}>
        {today ? (
          <>
            <path className="t-line red" d={pathToday} />
            <Packet d={pathToday} begin={0} from={0.04} to={0.9} color="var(--red)" />
          </>
        ) : (
          <>
            <path className="t-line green" d={pathA} />
            <path className="t-line green" d={pathB} />
            <Packet d={pathA} begin={0} from={0.02} to={0.36} />
            <Packet d={pathB} begin={0} from={0.42} to={0.96} />
          </>
        )}
      </g>

      {/* the agent */}
      <g>
        <rect className="t-card" x="160" y="8" width="200" height="68" rx="16" />
        <SvgTile x={174} y={27} logo={claude} />
        <text className="t-name" x="216" y="38">Claude Code</text>
        <text className="t-sub" x="216" y="56">~/Projects/Koupa</text>
      </g>

      {/* the gate: empty today, Nexus with it */}
      <g style={fade(today)}>
        <rect x="190" y="140" width="140" height="64" rx="16" fill="none" stroke="var(--line)" strokeWidth="1.5" strokeDasharray="5 5" />
        <text className="t-sub" x="260" y="168" textAnchor="middle">Nothing here</text>
        <text className="t-sub" x="260" y="184" textAnchor="middle">checks the project</text>
      </g>
      <g style={fade(!today)}>
        <rect className="t-card" x="190" y="140" width="140" height="64" rx="16" style={{ stroke: "var(--green)", strokeWidth: 1.5 }} />
        <image className="pd-logo-d" href="/nexus-symbol.png" x="202" y="150" width="22" height="22" />
        <image className="pd-logo-l" href="/nexus-symbol-dark.png" x="202" y="150" width="22" height="22" />
        <text className="t-name" x="232" y="167">Nexus</text>
              </g>

      {/* the key */}
      <g style={{ transform: keyAt, transition: "transform 0.9s var(--ease)" }}>
        <rect x="0" y="0" width="118" height="24" rx="12" fill="var(--amber-bg)" />
        <circle cx="13" cy="12" r="4" fill="none" stroke="var(--amber)" strokeWidth="1.6" />
        <path d="M 17 12 H 28 M 24 12 V 16" stroke="var(--amber)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        <text className="t-sub" x="34" y="16" style={{ fill: "var(--amber)", fontSize: 10 }}>SUPABASE_KEY</text>
      </g>

      {/* the two databases */}
      {[
        { x: 20, name: "koupa-production", sub: "Koupa's database", right: false },
        { x: 280, name: "nabdh-development", sub: "Nabdh's database", right: true },
      ].map((d) => {
        const bad = today && d.right;
        const good = !today && !d.right;
        return (
          <g key={d.name}>
            <rect className="t-card" x={d.x} y="286" width="220" height="76" rx="16" style={{ stroke: bad ? "var(--red)" : good ? "var(--green)" : "var(--line)", strokeWidth: bad || good ? 2 : 1, transition: "stroke 0.5s" }} />
            <SvgTile x={d.x + 16} y={309} logo={sb} />
            <text className="t-name" x={d.x + 58} y="322">{d.name}</text>
            <text className="t-sub" x={d.x + 58} y="340">{d.sub}</text>
            <text x={d.x + 200} y="312" textAnchor="middle" style={{ fontSize: 16, fontWeight: 700, fill: bad ? "var(--red)" : "var(--green)", ...fade(bad || good) }}>{bad ? "✕" : "✓"}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Problem() {
  const [mode, setMode] = useState<PMode>("today");
  const [auto, setAuto] = useState(true);
  const [inView, setInView] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.4 });
    io.observe(rootRef.current);
    return () => io.disconnect();
  }, []);

  /* Flip between the two until the visitor takes over. */
  useEffect(() => {
    if (!auto || !inView || REDUCED()) return;
    const id = window.setInterval(() => setMode((m) => (m === "today" ? "nexus" : "today")), 5600);
    return () => window.clearInterval(id);
  }, [auto, inView]);

  const pick = (m: PMode) => {
    setAuto(false);
    setMode(m);
  };

  const notes: Record<PMode, [string, string][]> = {
    today: [
      ["Setup is copied into every project", "Each agent uses whatever keys happen to be nearby."],
      ["Nothing checks which project it is in", "An agent working on Koupa can change Nabdh's database."],
      ["The agent holds the keys", "Once it has them, nobody can stop a mistake."],
    ],
    nexus: [
      ["Link each account once", "No setup per project."],
      ["Nexus checks the project every time", "If it can't tell, it says no."],
      ["The agent never sees your keys", "Nexus makes the call for it."],
    ],
  };

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

        <div className="card pstage" ref={rootRef}>
          <div className="pstage-diagram">
            <ProblemDiagram mode={mode} />
          </div>
          <div className="pstage-side">
            <div className="seg" role="group" aria-label="Compare">
              <button type="button" aria-pressed={mode === "today"} onClick={() => pick("today")}>Today</button>
              <button type="button" aria-pressed={mode === "nexus"} onClick={() => pick("nexus")}>With Nexus</button>
            </div>
            <ol className={`pnotes ${mode}`} key={mode}>
              {notes[mode].map(([t, d], i) => (
                <li key={t} style={{ ["--n" as string]: i }}>
                  <span className="pmark" aria-hidden="true">{mode === "today" ? "✕" : "✓"}</span>
                  <span><b>{t}</b><small>{d}</small></span>
                </li>
              ))}
            </ol>
            <div className={`pverdict ${mode}`} role="status" key={`v-${mode}`}>
              {mode === "today" ? "Changed the wrong database. No warning." : "Right database. The agent never saw a key."}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- How it works: the app's real first-run setup, replayed ---------- */
const OB_STEPS = ["Project", "Agent", "See it work"] as const;
/* How many beats each step plays before the demo moves on. */
const OB_BEATS = [3, 3, 5];
const OB_PROMPT = "Which Nexus project am I in?";
/* Text that types itself in. The part not typed yet stays in the layout but is
   invisible, so nothing jumps or re-wraps while it types. */
function Typed({ text, on, instant, delay = 0 }: { text: string; on: boolean; instant: boolean; delay?: number }) {
  const [n, setN] = useState(on && instant ? text.length : 0);
  useEffect(() => {
    if (!on) {
      setN(0);
      return;
    }
    if (instant) {
      setN(text.length);
      return;
    }
    let id = 0;
    let i = 0;
    const per = Math.min(34, Math.max(12, 1100 / text.length));
    const start = window.setTimeout(() => {
      id = window.setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length) window.clearInterval(id);
      }, per);
    }, delay);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(id);
    };
  }, [on, instant, text, delay]);
  const typing = on && !instant && n < text.length;
  return (
    <>
      {text.slice(0, n)}
      {typing && <span className="caret" aria-hidden="true" />}
      <span className="untyped" aria-hidden="true">{text.slice(n)}</span>
    </>
  );
}

function OnboardingDemo() {
  const last = OB_STEPS.length - 1;
  const reduced = typeof window !== "undefined" && REDUCED();
  const [pos, setPos] = useState({ step: reduced ? last : 0, beat: reduced ? OB_BEATS[last] : 0, hold: 0 });
  const [auto, setAuto] = useState(!reduced);
  const [inView, setInView] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { step, beat } = pos;
  /* Typing only plays during autoplay. Once someone clicks, everything shows at once. */
  const instant = !auto || reduced;

  /* Start from step one when the demo scrolls into view. */
  useEffect(() => {
    if (!rootRef.current || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.35 });
    io.observe(rootRef.current);
    return () => io.disconnect();
  }, []);

  /* Autoplay: one beat at a time, a pause between steps, then loop. */
  useEffect(() => {
    if (!auto || !inView || REDUCED()) return;
    const id = window.setInterval(() => {
      setPos((p) => {
        if (p.beat < OB_BEATS[p.step]) return { ...p, beat: p.beat + 1, hold: 0 };
        const wait = p.step === last ? 7 : 2;
        if (p.hold < wait) return { ...p, hold: p.hold + 1 };
        return p.step === last ? { step: 0, beat: 0, hold: 0 } : { step: p.step + 1, beat: 0, hold: 0 };
      });
    }, 900);
    return () => window.clearInterval(id);
  }, [auto, inView, last]);

  function replay() {
    setAuto(true);
    setPos({ step: 0, beat: 0, hold: 0 });
  }

  /* Clicking takes over: show that step fully played. */
  function go(next: number) {
    const to = Math.min(last, Math.max(0, next));
    setAuto(false);
    setPos({ step: to, beat: OB_BEATS[to], hold: 0 });
  }

  const done = (i: number) => step > i || (step === i && beat >= OB_BEATS[i]);
  const summaries = ["~/Projects/Koupa", "Claude Code", "First call seen"];
  const registered = step > 0 || beat >= 3;
  const agentOn = step > 1 || (step === 1 && beat >= 2);
  const called = step === last && beat >= 3;
  const bound = step === last && beat >= 5;
  const claude = AGENT_LOGOS[0];
  const line = (on: boolean) => (
    <svg className="ob-conn" width="44" height="12" aria-hidden="true">
      <line x1="0" y1="6" x2="44" y2="6" className={on ? "ob-flow" : ""} stroke={on ? "var(--green)" : "var(--line)"} strokeWidth="2" strokeDasharray={on ? "6 6" : "3 4"} />
    </svg>
  );

  return (
    <div className="card ob" ref={rootRef} role="group" aria-label="The app's first-run setup, replayed">
      <div className="ob-bar">
        <img src="/nexus-symbol.png" alt="" className="ob-logo" />
        <strong>Set up Nexus</strong>
        <span className="muted">Step {step + 1} of {OB_STEPS.length}</span>
        <span className="ob-example label">Example</span>
      </div>

      <div className="ob-body">
        <div className="ob-left">
          <ol className="ob-steps" aria-label="Setup steps">
            {OB_STEPS.map((label, i) => (
              <li key={label}>
                <button type="button" className={`ob-step ${i === step ? "now" : ""}`} onClick={() => go(i)}>
                  <span className={`nx-check ${done(i) ? "done" : ""} ${i === step && !done(i) ? "now" : ""}`}>{done(i) ? <Check size={12} weight="bold" /> : i + 1}</span>
                  <span className="ob-step-name">{label}</span>
                  {done(i) && <span className="ob-sum mono"><Typed text={summaries[i]} on instant={instant} /></span>}
                </button>
              </li>
            ))}
          </ol>

          <div className="ob-content" key={step}>
            {step === 0 && (
              <>
                <h3>Pick the folder your agent works in</h3>
                <p>Nexus ties your agent to this project, so it can only reach what belongs to it. Nothing secret is stored.</p>
                <div className="ob-field"><span>Project folder</span><div className="ob-input mono"><Typed text="~/Projects/Koupa" on={beat >= 1} instant={instant} /></div></div>
                <div className="ob-field"><span>Project name</span><div className="ob-input"><Typed text="Koupa" on={beat >= 2} instant={instant} /></div></div>
                <div className="ob-actions"><span aria-hidden="true" className={`ob-btn ${beat >= 3 ? "pressed" : ""}`}>{beat >= 3 ? "Continue" : "Register project"}</span></div>
              </>
            )}
            {step === 1 && (
              <>
                <h3>Connect your agent</h3>
                <p>Found on this machine. Pick the one you use.</p>
                <div className="ob-chips" aria-hidden="true">
                  {["Claude Code", "Codex", "OpenCode"].map((n) => (
                    <span key={n} className={`ob-chip ${beat >= 1 && n === "Claude Code" ? "on" : ""}`}>{n}</span>
                  ))}
                </div>
                <div className="ob-actions">
                  <span aria-hidden="true" className={`ob-btn ${beat >= 2 ? "pressed" : ""}`}>{beat >= 1 ? "Connect Claude Code" : "Pick an agent"}</span>
                  <span className="ob-help">Adds one Nexus entry to <code>.mcp.json</code> in your project. Your other servers are kept and a backup is saved first.</span>
                </div>
                {beat >= 3 && <div className="ob-bound ob-pop"><Check size={14} weight="bold" /><b>Wrote</b><code><Typed text="~/Projects/Koupa/.mcp.json" on instant={instant} /></code></div>}
              </>
            )}
            {step === 2 && (
              <>
                <h3>See your agent reach Nexus</h3>
                <p>Restart Claude Code in the project, say yes when it asks to trust the "nexus" server, and send it one message.</p>
                {beat >= 1 && <div className="ob-note ob-pop mono"><Typed text={OB_PROMPT} on instant={instant} /></div>}
                {beat >= 2 && !called && <div className="ob-note ob-pop">Waiting for Claude Code's first call. This updates by itself.</div>}
                {called && (
                  <>
                    <div className="ob-note ok ob-pop"><Typed text="Claude Code called Nexus just now: nexus_context · allowed." on instant={instant} /></div>
                    {beat >= 4 && <div className="ob-note ob-pop"><Typed text="Without Nexus, an agent in Koupa could have reached Nabdh's resources. Here that call is refused before it leaves your machine." on instant={instant} /></div>}
                  </>
                )}
                {bound && <div className="ob-bound ob-pop"><Check size={14} weight="bold" /><b>Optional · bound Supabase</b><code>koupa-production</code></div>}
              </>
            )}
          </div>

          <div className="ob-nav">
            <button type="button" className="ob-link" disabled={step === 0} onClick={() => go(step - 1)}>Back</button>
            {step < last ? <button type="button" className="btn btn-primary ob-next" onClick={() => go(step + 1)}>Continue</button> : <button type="button" className="btn ob-next" onClick={replay}>Replay</button>}
          </div>
        </div>

        <div className="ob-right" role="group" aria-label="Your graph">
          <span className="label">Your graph · builds as you go</span>
          <div className="ob-graph">
            {!registered ? (
              <p className="ob-empty">Register a project and it appears here.</p>
            ) : (
              <div className="ob-row-graph">
                {agentOn && (
                  <>
                    <div className="ob-node ob-pop">
                      <span className="ob-tile" style={{ background: called ? "var(--green-bg)" : "var(--raised)" }}>
                        <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: claude.color ?? "currentColor" }}><path d={claude.path} /></svg>
                      </span>
                      <span><b>Claude Code</b><small>Agent</small></span>
                    </div>
                    {line(called)}
                  </>
                )}
                <div className="ob-node ob-pop">
                  <span className="ob-tile" style={{ background: "var(--raised)" }}><FolderSimple size={16} weight="bold" /></span>
                  <span><b>Koupa</b><small>production</small></span>
                </div>
                {bound && (
                  <>
                    {line(true)}
                    <div className="ob-node ob-pop">
                      <ServiceLogo name="Supabase" size={30} />
                      <span><b>Supabase</b><small className="mono">koupa-production</small></span>
                    </div>
                  </>
                )}
              </div>
            )}
            {called && beat >= 4 && (
              <div className="ob-node ob-refused ob-pop">
                <span className="ob-tile" style={{ background: "var(--red-bg)" }}><FolderSimple size={16} weight="bold" /></span>
                <span><b>Nabdh · nabdh-development</b><small>Refused: another project</small></span>
              </div>
            )}
          </div>
          <p className="ob-foot">Step 1 adds the project, step 2 the agent. In step 3 the line lights up only when your agent really calls Nexus.</p>
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="section" id="how">
      <div className="container">
        <div className="section-head stack">
          <h2>Three steps to your agent's first call through Nexus.</h2>
          <p className="lead">This is the app's own first-run setup. It only counts as done when your agent really calls Nexus, not when the setup looks right.</p>
        </div>
        <OnboardingDemo />
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

/* Requests and answers use the real tool names, with the payloads trimmed. */
const SCENARIOS: Scenario[] = [
  {
    id: "ok",
    title: "Right project",
    blurb: "Claude Code in the Koupa folder reads its Supabase tables.",
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
  "tool": "nexus_execute",
  "arguments": {
    "provider": "supabase",
    "operation": "list_tables"
  }
}`,
    response: `{
  "decision": "allow",
  "project": "koupa",
  "resource": "koupa-production",
  "result": { "tables": ["orders", "users"] }
}`,
  },
  {
    id: "cross",
    title: "Wrong project",
    blurb: "Codex in the Nabdh folder names Koupa's database.",
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
  "tool": "nexus_execute",
  "arguments": {
    "provider": "supabase",
    "operation": "execute_sql",
    "arguments": { "project_id": "koupa-production" }
  }
}`,
    response: `{
  "decision": "block",
  "reason": "That target does not belong to this project."
}`,
  },
  {
    id: "write",
    title: "A change it can't make",
    blurb: "OpenCode in Nabdh asks Notion to edit a page.",
    tone: "red",
    badge: "Refused",
    nodes: [
      { label: "Agent", name: "OpenCode", sub: "Nabdh folder", s: "ok" },
      { label: "Project", name: "Nabdh", sub: "development", s: "ok" },
      { label: "Account", name: "Personal", sub: "Notion", s: "ok" },
      { label: "Action", name: "Edit a page", sub: "not marked read-only", s: "fail" },
    ],
    outcome: "Refused, nothing was changed",
    why: "Nexus passes only actions the service itself marks read-only. Edits stay refused unless you turn on safe writes for this one binding, and never for production.",
    request: `{
  "tool": "nexus_execute",
  "arguments": {
    "provider": "notion",
    "operation": "notion-update-page"
  }
}`,
    response: `{
  "decision": "approval_required",
  "reason": "This changes data and writes are off for this binding. It was not run."
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
  "tool": "nexus_context",
  "arguments": {}
}`,
    response: `{
  "status": "unresolved",
  "reason": "This workspace has no readable Nexus project file."
}`,
  },
  {
    id: "conflict",
    title: "Mixed signals",
    blurb: "The project file says Koupa, but the Git remote points somewhere else.",
    tone: "amber",
    badge: "Asks you",
    nodes: [
      { label: "Agent", name: "Claude Code", sub: "~/Projects/app", s: "ok" },
      { label: "Project", name: "Koupa?", sub: "the clues disagree", s: "warn" },
      { label: "Account", name: "Account", sub: "", s: "ok" },
      { label: "Resource", name: "Resource", sub: "", s: "ok" },
    ],
    outcome: "Nothing sent until you decide",
    why: "When the clues disagree, Nexus stops and shows you why instead of guessing.",
    request: `{
  "tool": "nexus_context",
  "arguments": {}
}`,
    response: `{
  "status": "unresolved",
  "reason": "The Git remote does not match this project's registered repo."
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
                <span className="label">Nexus answers (trimmed)</span>
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

/* ---------- Services: mirrors mcp/services.json plus the two built-ins ---------- */
/* Built-in: Nexus's own Supabase and GitHub support. Sign-in: the service's own
   MCP server, signed in through the browser. Keep this list in step with
   mcp/services.json (names, and which ones can be limited to one resource). */
type Tier = "Built-in" | "Sign-in";
type Svc = {
  name: string;
  cats: string[];
  tier: Tier;
  /* What one binding can be limited to, when the service supports it. */
  limit?: string;
  /* The provider only accepts MCP clients it has approved, and Nexus isn't yet. */
  waiting?: boolean;
  /* Signed in and used through Nexus for real, not only built. */
  tested?: boolean;
};

const CATS = [
  "Database & backend", "Source control", "Hosting & deployment", "Monitoring & analytics",
  "Payments", "Email", "Project management", "Docs & knowledge", "Design", "AI",
  "Media", "Content & sites", "Automation",
] as const;

const [DB, SCM, HOST, MON, PAY, MAIL, PM, DOCS, DESIGN, AI, MEDIA, CMS, AUTO] = CATS;

const CATALOG: Svc[] = [
  { name: "Supabase", cats: [DB], tier: "Built-in", limit: "project", tested: true },
  { name: "GitHub", cats: [SCM], tier: "Built-in", limit: "repository", tested: true },
  { name: "Notion", cats: [DOCS], tier: "Sign-in", tested: true },
  { name: "Neon", cats: [DB], tier: "Sign-in", limit: "project" },
  { name: "PlanetScale", cats: [DB], tier: "Sign-in" },
  { name: "Airtable", cats: [DB], tier: "Sign-in", limit: "base" },
  { name: "GitLab", cats: [SCM], tier: "Sign-in", limit: "project" },
  { name: "Vercel", cats: [HOST], tier: "Sign-in", limit: "project", waiting: true },
  { name: "Cloudflare", cats: [HOST], tier: "Sign-in", limit: "account" },
  { name: "Netlify", cats: [HOST], tier: "Sign-in", limit: "site" },
  { name: "Railway", cats: [HOST], tier: "Sign-in", limit: "project" },
  { name: "Sentry", cats: [MON], tier: "Sign-in", limit: "project" },
  { name: "PostHog", cats: [MON], tier: "Sign-in" },
  { name: "Mixpanel", cats: [MON], tier: "Sign-in" },
  { name: "Stripe", cats: [PAY], tier: "Sign-in" },
  { name: "PayPal", cats: [PAY], tier: "Sign-in" },
  { name: "Resend", cats: [MAIL], tier: "Sign-in" },
  { name: "Linear", cats: [PM], tier: "Sign-in" },
  { name: "Jira", cats: [PM], tier: "Sign-in" },
  { name: "Confluence", cats: [DOCS], tier: "Sign-in" },
  { name: "Figma", cats: [DESIGN], tier: "Sign-in", waiting: true },
  { name: "Hugging Face", cats: [AI], tier: "Sign-in" },
  { name: "Cloudinary", cats: [MEDIA], tier: "Sign-in" },
  { name: "Webflow", cats: [CMS], tier: "Sign-in", limit: "site" },
  { name: "Sanity", cats: [CMS], tier: "Sign-in", limit: "project" },
  { name: "Zapier", cats: [AUTO], tier: "Sign-in" },
];

const SERVICE_ICON: Record<string, Logo> = {
  "Supabase": brand("Supabase", siSupabase),
  "GitHub": brand("GitHub", siGithub),
  "Notion": brand("Notion", siNotion),
  "Neon": brand("Neon", siNeon),
  "PlanetScale": brand("PlanetScale", siPlanetscale),
  "Airtable": brand("Airtable", siAirtable),
  "GitLab": brand("GitLab", siGitlab),
  "Vercel": brand("Vercel", siVercel),
  "Cloudflare": brand("Cloudflare", siCloudflare),
  "Netlify": brand("Netlify", siNetlify),
  "Railway": brand("Railway", siRailway),
  "Sentry": brand("Sentry", siSentry),
  "PostHog": brand("PostHog", siPosthog),
  "Mixpanel": brand("Mixpanel", siMixpanel),
  "Stripe": brand("Stripe", siStripe),
  "PayPal": brand("PayPal", siPaypal),
  "Resend": brand("Resend", siResend),
  "Linear": brand("Linear", siLinear),
  "Jira": brand("Jira", siJira),
  "Confluence": brand("Confluence", siConfluence),
  "Figma": brand("Figma", siFigma),
  "Hugging Face": brand("Hugging Face", siHuggingface),
  "Cloudinary": brand("Cloudinary", siCloudinary),
  "Webflow": brand("Webflow", siWebflow),
  "Sanity": brand("Sanity", siSanity),
  "Zapier": brand("Zapier", siZapier),
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
  [SCM]: ["koupa", "nabdh"],
  [HOST]: ["koupa-web", "nabdh-web"],
  [MON]: ["koupa", "nabdh"],
  [PAY]: ["koupa-live", "nabdh-test"],
  [MAIL]: ["koupa-mail", "nabdh-mail"],
  [PM]: ["Koupa board", "Nabdh board"],
  [DOCS]: ["Koupa wiki", "Nabdh wiki"],
  [DESIGN]: ["Koupa app", "Nabdh app"],
  [AI]: ["koupa-models", "nabdh-models"],
  [MEDIA]: ["koupa-media", "nabdh-media"],
  [CMS]: ["koupa-site", "nabdh-site"],
  [AUTO]: ["Koupa zaps", "Nabdh zaps"],
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
  const builtIn = svc.tier === "Built-in";
  const signIn = CATALOG.filter((c) => c.tier === "Sign-in").length;

  return (
    <section className="section" id="services">
      <div className="container">
        <div className="section-head stack">
          <h2>Link a service once. Use it in every project.</h2>
          <p className="lead">Supabase and GitHub built in, {signIn} more through their own sign-in, and any other service with an MCP address. Pick one to see how Nexus links it.</p>
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
              <span><b className="badge green">Built-in</b>Supabase and GitHub. Each binding is held to one project or one repository.</span>
              <span><b className="badge">Sign-in</b>The service's own MCP server. Sign in once in your browser; the login goes to your computer's keychain.</span>
              <span><b className="badge amber">Your own</b>Any other service: give it a name and its public MCP address.</span>
            </div>
          </div>

          <div className="card link-stage" aria-live="polite">
            <div className="link-head" key={svc.name}>
              <ServiceLogo name={svc.name} size={56} />
              <div>
                <h3>{svc.name}</h3>
                <p>{svc.cats.join(", ")}</p>
              </div>
              <span className={`badge ${builtIn ? "green" : svc.waiting ? "amber" : ""}`}>{svc.waiting ? "Waiting on provider" : svc.tier}</span>
            </div>
            <div className="link-body" key={`${svc.name}-svg`}>
              <LinkStage svc={svc} />
            </div>
            <p className="link-note">
              Link each account once, with a label. Every project then picks its own account.
              {builtIn
                ? ` Nexus holds every call to that project's ${svc.limit}.`
                : svc.limit
                  ? ` A binding can be limited to one ${svc.limit}; Nexus refuses calls that name another.`
                  : " Nexus keeps the right account, but can't tell resources apart inside it. Use one account per project for this one."}
              {!builtIn && " Only actions the service marks read-only go through, unless you allow safe writes for that binding."}
              {svc.waiting && ` ${svc.name} only accepts MCP apps it has approved, and Nexus isn't approved yet.`}
            </p>
          </div>
        </div>
        <p className="fine">
          Signed in and used through Nexus so far: Supabase, GitHub and Notion. The other sign-in services use the same engine but haven't all been tried live yet.
        </p>
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
    how: "Tested end to end",
    lines: [
      { k: "dim", t: "Connect Claude Code: Nexus adds one entry to .mcp.json" },
      { k: "add", t: "+ nexus  http://127.0.0.1:3939/mcp" },
      { k: "dim", t: "Your other servers are kept. A backup is saved first." },
      { k: "cmd", t: "$ claude   (restarted in ~/Projects/Koupa)" },
      { k: "warn", t: "Trust the \"nexus\" server from .mcp.json? Yes" },
      { k: "ok", t: "Connected", set: { agent: { v: "Claude Code", tone: "ok" }, connection: { v: "Connected", tone: "ok" } } },
      { k: "ok", t: "Folder reported: ~/Projects/Koupa", set: { folder: { v: "Reported by the agent", tone: "ok" } } },
      { k: "ok", t: "Project: Koupa", set: { project: { v: "Koupa", tone: "ok" } } },
    ],
  },
  {
    id: "codex",
    name: "Codex",
    logo: AGENT_LOGOS[1],
    how: "Config written for you",
    lines: [
      { k: "dim", t: "Connect Codex: Nexus adds one entry to .codex/config.toml" },
      { k: "add", t: "+ [mcp_servers.nexus]  url = \"http://127.0.0.1:3939/mcp?workspace=…\"" },
      { k: "warn", t: "Codex doesn't report its folder", set: { folder: { v: "Not reported", tone: "warn" } } },
      { k: "ok", t: "So the folder is pinned in that config", set: { folder: { v: "Pinned in config", tone: "ok" } } },
      { k: "cmd", t: "$ codex   (started in ~/Projects/Koupa)" },
      { k: "ok", t: "Connected", set: { agent: { v: "Codex", tone: "ok" }, connection: { v: "Connected", tone: "ok" } } },
      { k: "ok", t: "Project: Koupa", set: { project: { v: "Koupa", tone: "ok" } } },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    logo: AGENT_LOGOS[2],
    how: "Config written for you",
    lines: [
      { k: "dim", t: "Connect OpenCode: Nexus adds one entry to opencode.json" },
      { k: "add", t: "+ nexus  http://127.0.0.1:3939/mcp" },
      { k: "dim", t: "Your other servers are kept. A backup is saved first." },
      { k: "cmd", t: "$ opencode   (started in ~/Projects/Koupa)" },
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
          <p className="lead">One click in the app writes the agent's config in your project. Pick an agent to see what happens.</p>
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
        <p className="fine">Claude Code has been run end to end through Nexus. Codex and OpenCode connect the same way, but haven't had a full real session yet. Gemini CLI, Cursor and Windsurf are detected, but connecting them is still manual and untested.</p>
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
      <text className="t-sub" x="300" y="25">Supabase</text><text className="t-sub" x="300" y="61">GitHub</text><text className="t-sub" x="300" y="97">Supabase</text><text className="t-sub" x="300" y="133">Notion</text>
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
            <header><span className="tint tint-blue"><FolderSimple size={20} weight="bold" /></span><div><h3>Add a project</h3><p>Pick a folder. Nexus remembers which project it is and keeps a secret-free file in it.</p></div></header>
            <div className="mini-row">
              <code>~/Projects/Koupa</code>
              <span className="mini-arrow" aria-hidden="true">→</span>
              <span className="badge green">Project: Koupa</span>
            </div>
          </article>

          <article className="card tile t-acct">
            <header><span className="tint tint-violet"><LinkSimple size={20} weight="bold" /></span><div><h3>Link accounts once</h3><p>Sign in once in your browser, with a label like Personal or Client. The login stays in your computer's keychain.</p></div></header>
            <div className="mini-chips">
              <span className="mini-chip"><ServiceLogo name="Supabase" size={22} />Personal</span>
              <span className="mini-chip"><ServiceLogo name="Supabase" size={22} />Client</span>
              <span className="mini-chip"><ServiceLogo name="GitHub" size={22} />Personal</span>
            </div>
          </article>

          <article className="card tile t-pick">
            <header><span className="tint tint-amber"><ListChecks size={20} weight="bold" /></span><div><h3>Read-only by default</h3><p>Only actions a service marks read-only go through. Allow safe writes per binding, never in production.</p></div></header>
            <ul className="mini-list">
              <li className="sel"><Check size={14} weight="bold" /> Read pages and tables</li>
              <li className="sel"><Check size={14} weight="bold" /> List issues and projects</li>
              <li><X size={14} weight="bold" /> Edit or delete: off</li>
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
        <p className="fine">Previews are examples of what the app shows. Nexus runs while the app is open; close the app and agents can't reach it.</p>
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
            <a href="#download" className={`btn ${rec === "free" ? "btn-primary" : ""}`}>Get the alpha</a>
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
              <li><span className="chk"><Check size={12} weight="bold" /></span>Guard (approve risky actions), if it ships</li>
            </ul>
            <a href="#download" className={`btn ${rec === "pro" ? "btn-primary" : ""}`}>Get the alpha</a>
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

        <p className="fine">The alpha is free. Prices are approximate and may change at launch. Nothing is charged today.</p>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
const FAQ: [string, string][] = [
  ["Does my agent ever see my keys?", "No. The agent asks Nexus, and Nexus makes the call with the right account's login. Logins stay in your computer's keychain."],
  ["What if an agent skips Nexus?", "Then Nexus can't see or stop what it does. It only covers calls made through it. An agent that still has a service's own tools, or a key in a file, can use them directly. Nexus finds direct MCP connections and offers to move them over."],
  ["What can an agent change?", "By default, nothing. Nexus passes only actions a service marks read-only. You can allow safe writes for one binding at a time, and never for production."],
  ["How does Nexus know which project an agent is in?", "It reads the project file in the folder and checks the Git remote. Claude Code and OpenCode tell Nexus their folder. Codex doesn't, so its folder is pinned in its config. If Nexus can't tell, or the clues disagree, it refuses and shows you why."],
  ["Is every service held to one resource?", "Supabase is held to one project and GitHub to one repository. Some sign-in services can be limited to one project, site or base. The rest are kept to the right account, but Nexus can't tell resources apart inside it, so use one account per project for those."],
  ["Can an agent change Nexus's own settings?", "Not through Nexus, and not from inside the project folder. But an agent allowed to run shell commands as you could edit the settings files on your computer. Nexus is a guard rail for agent calls, not a sandbox."],
  ["Which computers does it run on?", "Linux, macOS and Windows. Linux is the one tested most; macOS and Windows builds are new."],
  ["Why does my computer warn me when I open it?", "Alpha builds are not signed yet. On macOS, right-click the app and choose Open. On Windows, choose More info, then Run anyway."],
  ["What does it cost?", "The alpha is free. Later, the core stays free; paid plans add unlimited projects and longer history. Prices may change."],
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

/* ---------- Download ----------
   Driven by /release.json, so going live is an edit to that file and a deploy:
   "waitlist" shows the email form, "available" shows the downloads.
   See RELEASING.md. */
type OsId = "linux" | "macos" | "windows";
type Download = { os: OsId; label: string; url: string };
type Release = { status: "waitlist" | "available"; version?: string; date?: string; notes?: string; downloads?: Download[] };

const OS_NAME: Record<OsId, string> = { linux: "Linux", macos: "macOS", windows: "Windows" };
const OPEN_HINT: Record<OsId, string> = {
  linux: "Install the .deb, or make the .AppImage executable and run it.",
  macos: "Not signed yet: the first time, right-click the app and choose Open.",
  windows: "Not signed yet: if SmartScreen warns you, choose More info, then Run anyway.",
};

function detectOs(): OsId | null {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = `${nav.userAgentData?.platform ?? ""} ${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (/android|iphone|ipad/.test(p)) return null;
  if (p.includes("win")) return "windows";
  if (p.includes("mac")) return "macos";
  if (p.includes("linux")) return "linux";
  return null;
}

function useRelease(): Release {
  const [release, setRelease] = useState<Release>({ status: "waitlist" });
  useEffect(() => {
    let live = true;
    fetch("/release.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Release | null) => {
        const downloads = (data?.downloads ?? []).filter((d) => d && d.os in OS_NAME && /^https:\/\//.test(d.url));
        if (live && data?.status === "available" && downloads.length) setRelease({ ...data, downloads });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return release;
}

function WaitlistForm({ available }: { available: boolean }) {
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

  if (status === "success" || status === "duplicate") {
    return (
      <p className="wl-msg ok" role="status">
        {status === "duplicate" ? "You are already on the list." : "You are on the list."}{" "}
        {available ? `We will email ${email} when there is a new version.` : `We will email ${email} the download when the alpha is ready.`}
      </p>
    );
  }
  return (
    <>
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
        <button type="submit" className={`btn ${available ? "" : "btn-primary"}`} disabled={status === "sending" || !email}>
          {status === "sending" ? "Joining…" : available ? "Email me updates" : "Get the alpha"} <ArrowRight size={14} weight="bold" />
        </button>
      </form>
      {status === "error" && <p className="wl-msg err" role="alert">{error}</p>}
    </>
  );
}

function DownloadSection() {
  const release = useRelease();
  const [os] = useState(detectOs);
  const available = release.status === "available";
  const downloads = release.downloads ?? [];
  const mine = downloads.filter((d) => d.os === os);
  const others = downloads.filter((d) => d.os !== os);

  return (
    <section className="section" id="download">
      <div className="container waitlist">
        <span className="label">{available ? `Alpha${release.version ? ` · v${release.version}` : ""}` : "Alpha"}</span>
        {available ? (
          <>
            <h2>Try it on your own projects.</h2>
            <p className="lead">Free during the alpha. Expect rough edges, and tell us what breaks.</p>
            <div className="dl-main">
              {(mine.length ? mine : downloads).map((d, i) => (
                <a key={d.url} className={`btn ${i === 0 ? "btn-primary" : ""}`} href={d.url} rel="noopener">
                  Download for {d.label} <ArrowRight size={14} weight="bold" />
                </a>
              ))}
            </div>
            {mine.length > 0 && others.length > 0 && (
              <p className="dl-others">
                Other systems:{" "}
                {others.map((d, i) => (
                  <span key={d.url}>{i > 0 && " · "}<a href={d.url} rel="noopener">{d.label}</a></span>
                ))}
              </p>
            )}
            {os && mine.length > 0 && <p className="dl-hint">{OPEN_HINT[os]}</p>}
            {release.notes && /^https:\/\//.test(release.notes) && <p className="dl-hint"><a href={release.notes} rel="noopener">What's in this version</a></p>}
          </>
        ) : (
          <>
            <h2>The alpha is almost ready.</h2>
            <p className="lead">
              First builds for Linux, macOS and Windows. Leave your email and we'll send you the download. One email, used only for Nexus news.
            </p>
          </>
        )}
        <ul className="dl-needs">
          <li><Check size={14} weight="bold" /> A coding agent: Claude Code, Codex or OpenCode</li>
          <li><Check size={14} weight="bold" /> A project folder you work in</li>
        </ul>
        <WaitlistForm available={available} />
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
              <a href="#download">Download</a>
              <a href="https://github.com/sam22ir/nexus-guard" rel="noopener">Source on GitHub</a>
              <a href="/llms.txt">llms.txt</a>
            </div>
          </div>
        </div>
        <p className="footer-bottom">
          Alpha for Linux, macOS and Windows. Maps and examples on this page are illustrations.
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
        <Routing />
        <Catalog />
        <Agents />
        <Inside />
        <Pricing />
        <Faq />
        <DownloadSection />
      </main>
      <Footer theme={theme} />
    </>
  );
}
