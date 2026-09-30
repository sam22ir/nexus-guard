import { useState, useMemo, useEffect, useRef, type FormEvent } from "react";
import {
  ShieldCheck,
  LockKey,
  Folder,
  ArrowRight,
  XCircle,
  Code,
  Check,
  Copy,
  Info,
  GithubLogo,
  Terminal,
  Cpu,
  ArrowsClockwise,
  Key,
  Sparkle,
  GitBranch,
  Play,
  Plus,
  List,
  X,
} from "@phosphor-icons/react";
import {
  siSupabase,
  siClerk,
  siGithub,
  siSentry,
  siConvex,
  siVercel,
  siCloudflare,
  siStripe,
  siResend,
  siLinear,
  siPosthog,
  siNeon,
  siRedis,
  siUpstash,
  siTurso,
  siPlanetscale,
  siGitlab,
  siAnthropic,
  siPrisma,
  siLangchain,
} from "simple-icons";
import { DesktopAppPrototype } from "./DesktopPrototype";
import "./App.css";

/* --------------------------------------------------------------------------
   Brand Mark (white N-symbol on dark, per Notion §11 visual identity)
-------------------------------------------------------------------------- */
function BrandMark({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <div className={`brand-mark ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <img
        src="/nexus-symbol.png"
        alt="Nexus Guard"
        className="brand-mark-img"
        width={size}
        height={size}
      />
    </div>
  );
}

/* --------------------------------------------------------------------------
   Floating Island Navigation Bar
-------------------------------------------------------------------------- */
function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  function closeMenu() {
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const panel = document.querySelector(".nav-mobile-panel.open a");
    if (panel instanceof HTMLElement) panel.focus();
  }, [menuOpen]);

  return (
    <div className="nav-wrapper">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="site-header-island">
        <a href="#" className="nav-brand" aria-label="Nexus Guard Home">
          <BrandMark size={24} />
          <div className="nav-brand-text">
            <span className="nav-brand-name">Nexus</span>
            <span className="nav-brand-sub">Guard</span>
          </div>
          <span className="nav-version-badge">v0.1.0-alpha</span>
        </a>

        <nav className="nav-links" aria-label="Primary navigation">
          <a href="#problem">The Problem</a>
          <a href="#architecture">Architecture</a>
          <a href="#simulator">Routing &amp; Guard</a>
          <a href="#desktop-app">Desktop App</a>
          <a href="#evidence">Evidence</a>
          <a href="#comparison">Comparison</a>
        </nav>

        <div className="nav-actions">
          <a
            href="https://github.com/saadi/nexus-guard"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-icon-link"
            aria-label="Nexus Guard GitHub Repository"
          >
            <GithubLogo size={15} weight="bold" />
          </a>
          <a href="#waitlist" className="primary-button nav-cta">
            <span>Notify me</span>
            <span className="btn-icon-tray">
              <ArrowRight size={12} weight="bold" />
            </span>
          </a>
          <button
            type="button"
            ref={menuButtonRef}
            className="nav-menu-btn"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={17} weight="bold" /> : <List size={17} weight="bold" />}
          </button>
        </div>
      </header>
      {menuOpen && (
        <div
          className="nav-mobile-backdrop"
          aria-hidden="true"
          onClick={closeMenu}
        />
      )}
      <nav className={`nav-mobile-panel ${menuOpen ? "open" : ""}`} aria-label="Mobile navigation">
        <a href="#problem" onClick={closeMenu}>The Problem</a>
        <a href="#architecture" onClick={closeMenu}>Architecture</a>
        <a href="#simulator" onClick={closeMenu}>Routing &amp; Guard</a>
        <a href="#desktop-app" onClick={closeMenu}>Desktop App</a>
        <a href="#evidence" onClick={closeMenu}>Evidence</a>
        <a href="#comparison" onClick={closeMenu}>Comparison</a>
      </nav>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Hero Section: Wide Cinematic Layout & Double-Bezel Monitor
-------------------------------------------------------------------------- */
function HeroSection() {
  const [activeScenario, setActiveScenario] = useState<"normal" | "conflict">("normal");
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const latency = "illustrative";

  function switchScenario(target: "normal" | "conflict") {
    if (target === activeScenario) return;
    setEvaluating(true);
    setActiveScenario(target);
    setTimeout(() => setEvaluating(false), 320);
  }

  function copyInstallCmd() {
    navigator.clipboard.writeText("cargo test --manifest-path prototype/nexus-check/Cargo.toml");
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  }

  return (
    <section className="hero-section" id="hero">
      <div className="hero-shell">
        <div className="hero-content">
          <div className="hero-eyebrow">
            <span className="status-dot green" aria-hidden="true" />
            <span>Nexus scaffold v0.1.0 · Preview — not yet MVP</span>
          </div>

          <h1 className="hero-headline">
            One front door for your services. <br />
            Routing keeps each agent in its project. <br />
            <a href="#simulator" className="meet-nexus">Meet Nexus.</a>
          </h1>

          <p className="hero-subtext">
            Tired of wiring credentials into every agent workspace? Link each account to Nexus once — every agent that talks to Nexus is routed to the <strong className="text-highlight">account and resource registered for the project</strong> it is in. No match, no registration, or an ambiguous signal, and Nexus refuses <strong className="text-highlight">structurally, before any risk evaluation</strong>. Guard then watches what the agent does inside the right project — allow, warn, require approval, or block.
          </p>

          <div className="hero-action-row">
            <div className="hero-cta-group">
              <a href="#waitlist" className="primary-button hero-primary-cta">
                <span>Get notified</span>
                <span className="btn-icon-tray">
                  <ArrowRight size={14} weight="bold" />
                </span>
              </a>
              <a href="#simulator" className="secondary-button hero-secondary-cta">
                <ShieldCheck size={16} weight="bold" />
                <span>Launch Guard Simulator</span>
              </a>
              <div
                className="hero-quick-cmd"
                onClick={copyInstallCmd}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") copyInstallCmd(); }}
                title="Click to copy install command"
              >
                <span className="cmd-prompt-sym">$</span>
                <code>cargo test --manifest-path prototype/nexus-check/Cargo.toml</code>
                <button type="button" className="cmd-copy-btn" aria-label="Copy install command">
                  {copiedCmd ? <Check size={13} weight="bold" className="text-green" /> : <Copy size={13} weight="bold" />}
                </button>
                {copiedCmd && <span className="copied-tooltip">Copied to clipboard</span>}
              </div>
            </div>
          </div>

          <div className="hero-guarantee-strip">
            <div className="guarantee-item">
              <LockKey size={14} weight="bold" className="guarantee-icon" />
              <span>Scaffold · Supabase-only MVP</span>
            </div>
            <div className="guarantee-divider" aria-hidden="true" />
            <div className="guarantee-item">
              <GitBranch size={14} weight="bold" className="guarantee-icon" />
              <span>Workspace + Git remote check (planned)</span>
            </div>
            <div className="guarantee-divider" aria-hidden="true" />
            <div className="guarantee-item">
              <Cpu size={14} weight="bold" className="guarantee-icon" />
              <span>OS keychain storage · Linux first</span>
            </div>
          </div>
        </div>

        {/* Double-Bezel Hardware Monitor (Doppelrand) */}
        <div className="hardware-outer-bezel">
          <div className="hardware-inner-core">
            <div className="hardware-titlebar">
              <div className="titlebar-left">
                <span className="terminal-dot red" />
                <span className="terminal-dot yellow" />
                <span className="terminal-dot green" />
                <img src="/nexus-symbol.png" className="hardware-title-logo" alt="" aria-hidden="true" />
                <span className="titlebar-spec">nexus-guard :: design illustration (not live telemetry)</span>
                <span className="titlebar-live-beacon">
                  <span className="titlebar-live-dot" />
                  ILLUSTRATION
                </span>
              </div>
              <div className="titlebar-right">
                <button
                  type="button"
                  className={`scenario-switch-btn ${activeScenario === "normal" ? "active" : ""}`}
                  onClick={() => switchScenario("normal")}
                >
                  Koupa &amp; Nabdh (Isolated)
                </button>
                <button
                  type="button"
                  className={`scenario-switch-btn ${activeScenario === "conflict" ? "active" : ""}`}
                  onClick={() => switchScenario("conflict")}
                >
                  Cross-Project Leak (Blocked)
                </button>
              </div>
            </div>

            <div className="hardware-body">
              {/* Session 1: Koupa */}
              <div className="stream-card session-koupa">
                <div className="stream-meta-row">
                  <span className="project-avatar-mini koupa-avatar">KO</span>
                  <div className="stream-target-info">
                    <strong>~/Projects/Koupa</strong>
                    <span className="branch-tag">
                      <GitBranch size={11} weight="bold" /> main
                    </span>
                  </div>
                  <span className="status-pill green-pill stream-status">
                    <span className="status-dot green" />
                    ALLOWED
                  </span>
                </div>
                <div className="stream-cmd-line">
                  <span className="cmd-prompt">agent-1 $ <span className="terminal-cursor" aria-hidden="true" /></span>
                  <span className="cmd-text">request_service(provider: &quot;Supabase&quot;, target: &quot;koupa-production&quot;)</span>
                </div>
                <div className="stream-verdict-line">
                  <span className="verdict-tag">DECISION:</span>
                  <span className="verdict-msg">Planned: context verified for Koupa. Safe tool brokered, secret stays in OS keychain.</span>
                </div>
              </div>

              {/* Session 2: Nabdh */}
              <div className={`stream-card session-nabdh ${activeScenario === "conflict" ? "conflict-active" : ""}`}>
                <div className="stream-meta-row">
                  <span className="project-avatar-mini nabdh-avatar">NA</span>
                  <div className="stream-target-info">
                    <strong>~/Projects/Nabdh</strong>
                    <span className="branch-tag">
                      <GitBranch size={11} weight="bold" /> develop
                    </span>
                  </div>
                  {evaluating ? (
                    <span className="status-pill orange-pill stream-status stamp-animate">
                      EVALUATING...
                    </span>
                  ) : activeScenario === "normal" ? (
                    <span className="status-pill green-pill stream-status">
                      <span className="status-dot green" />
                      ALLOWED
                    </span>
                  ) : (
                    <span className="status-pill block-pill stream-status stamp-animate">
                      <span className="status-dot block-dot" />
                      BLOCKED
                    </span>
                  )}
                </div>
                <div className="stream-cmd-line">
                  <span className="cmd-prompt">agent-2 $ <span className="terminal-cursor" aria-hidden="true" /></span>
                  {activeScenario === "normal" ? (
                    <span className="cmd-text">request_service(provider: &quot;Supabase&quot;, target: &quot;nabdh-development&quot;)</span>
                  ) : (
                    <span className="cmd-text text-danger">request_service(provider: &quot;Supabase&quot;, target: &quot;koupa-production&quot;)</span>
                  )}
                </div>
                <div className="stream-verdict-line">
                  <span className="verdict-tag">DECISION:</span>
                  {evaluating ? (
                    <span className="verdict-msg">Planned check: caller workspace vs Git remote and .nexus/project.json...</span>
                  ) : activeScenario === "normal" ? (
                    <span className="verdict-msg">Planned: context verified for Nabdh. Independent session connection provided.</span>
                  ) : (
                    <span className="verdict-msg text-danger">
                      Planned: BLOCKED. Target koupa-production belongs to Koupa. Caller workspace is Nabdh.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="hardware-footer">
              <div className="telemetry-item">
                <span className="telemetry-lbl">SESSIONS:</span>
                <span className="telemetry-val">Illustrated (app: not connected yet)</span>
              </div>
              <div className="telemetry-item">
                <span className="telemetry-lbl">STORAGE:</span>
                <span className="telemetry-val val-green">OS keychain (planned)</span>
              </div>
              <div className="telemetry-item">
                <span className="telemetry-lbl">BROKER OVERHEAD:</span>
                <span className="telemetry-val val-green">
                  {latency}
                  <span className="telemetry-ping-pulse" aria-hidden="true" />
                  <span className="telemetry-eq-strip" aria-hidden="true">
                    <span className="eq-bar" />
                    <span className="eq-bar" />
                    <span className="eq-bar" />
                    <span className="eq-bar" />
                    <span className="eq-bar" />
                  </span>
                </span>
              </div>
              <div className="telemetry-item">
                <span className="telemetry-lbl">RAW SECRETS IN PROMPT:</span>
                <span className="telemetry-val val-green">0 in prototype (planned)</span>
              </div>
              <a href="#simulator" className="monitor-more">
                <span>2-session illustration — try it in the Guard simulator</span>
                <ArrowRight size={12} weight="bold" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Supported Services Strip (From Desktop App store.ts)
-------------------------------------------------------------------------- */
type ServiceDef = {
  name: string;
  detail: string;
  icon: { title: string; hex: string; path: string };
};

const SERVICES_CATALOG: ServiceDef[] = [
  { name: "Supabase", detail: "Database · Auth · Storage", icon: siSupabase },
  { name: "Clerk", detail: "Authentication & Users", icon: siClerk },
  { name: "GitHub", detail: "Repository & Git Remote", icon: siGithub },
  { name: "Sentry", detail: "Error & Crash Telemetry", icon: siSentry },
  { name: "Convex", detail: "Reactive Realtime Backend", icon: siConvex },
  { name: "Vercel", detail: "Edge Functions & Hosting", icon: siVercel },
  { name: "Cloudflare", detail: "Workers, KV & Edge D1", icon: siCloudflare },
  { name: "Stripe", detail: "Billing & Subscriptions", icon: siStripe },
  { name: "Resend", detail: "Transactional Email API", icon: siResend },
  { name: "Linear", detail: "Issue Tracking & Workflows", icon: siLinear },
  { name: "PostHog", detail: "Product Telemetry & Analytics", icon: siPosthog },
  { name: "Neon", detail: "Serverless Branching Postgres", icon: siNeon },
  { name: "Redis", detail: "In-Memory Cache & Queues", icon: siRedis },
  { name: "Upstash", detail: "Serverless Redis & Kafka", icon: siUpstash },
  { name: "Turso", detail: "Distributed LibSQL Database", icon: siTurso },
  { name: "PlanetScale", detail: "Serverless MySQL Platform", icon: siPlanetscale },
  { name: "GitLab", detail: "Git Remote & CI/CD Pipelines", icon: siGitlab },
  { name: "Anthropic", detail: "Claude Foundation Models", icon: siAnthropic },
  { name: "Prisma", detail: "Schema ORM & Migrations", icon: siPrisma },
  { name: "LangChain", detail: "Agent Workflow Orchestration", icon: siLangchain },
];

/* ServicesStrip: account-linking + tier story (Notion §6).
   Accounts are linked once globally with human labels; each project binds
   provider → account → resource, picked from a live-fetched list — never
   typed by hand. A shared account across projects is flagged, not silent.
   Tiers: Native (Supabase, MVP), Curated (catalog, planned), Self-added
   (planned). Static grid on purpose — the old logo marquee implied live
   coverage that does not exist. */
function ServicesStrip() {
  return (
    <section className="services-strip" aria-label="Services and account linking in Nexus Guard">
      <div className="strip-heading-wrap">
        <p className="strip-heading">
          <span className="titlebar-live-dot" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 8 }} />
          Link accounts once · Bind account + resource per project · MVP is Supabase only
        </p>
      </div>

      <div className="services-tier-layout">
        <div className="service-train-card service-tier-card">
          <div className="service-logo-box">
            <svg viewBox="0 0 24 24" width={18} height={18} fill={`#${siSupabase.hex}`} aria-hidden="true">
              <path d={siSupabase.path} />
            </svg>
          </div>
          <div className="service-copy">
            <div className="service-title-row">
              <strong>Supabase</strong>
              <span className="status-pill green-pill">NATIVE</span>
            </div>
            <small>OAuth browser approval · live project list · read-only MCP</small>
          </div>
        </div>
        <div className="service-train-card service-tier-card">
          <div className="service-logo-box" aria-hidden="true">
            <Folder size={18} weight="bold" />
          </div>
          <div className="service-copy">
            <div className="service-title-row">
              <strong>Curated catalog</strong>
              <span className="status-pill orange-pill">PLANNED</span>
            </div>
            <small>300–500 entries via generic MCP passthrough · fail-closed until classified</small>
          </div>
        </div>
        <div className="service-train-card service-tier-card">
          <div className="service-logo-box" aria-hidden="true">
            <Plus size={18} weight="bold" />
          </div>
          <div className="service-copy">
            <div className="service-title-row">
              <strong>Self-added</strong>
              <span className="status-pill orange-pill">PLANNED</span>
            </div>
            <small>You review, you accept the risk · every action requires approval</small>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   The Problem: Ambient Credential Trap (From docs/PRODUCT_BRIEF.md)
-------------------------------------------------------------------------- */
function ProblemSection() {
  return (
    <section className="section-frame" id="problem">
      <div className="section-heading-stack">
        <h2 className="section-title">The ambient credential trap in multi-project agent workflows.</h2>
        <p className="section-description">
          Without Nexus, an agent may find whatever happens to be in a .env file, a terminal session, a browser login, or a service tool. The dangerous mistake is not only stealing a secret. It may connect the right code to the wrong project, such as putting Koupa data in Nabdh Supabase project.
        </p>
      </div>

      <div className="problem-comparison-grid">
        {/* Without Nexus */}
        <div className="double-bezel-card trap-bezel">
          <div className="bezel-inner">
            <div className="card-badge-header">
              <span className="status-pill block-pill">
                <XCircle size={13} weight="fill" />
                Without Nexus : Ambient &amp; Unchecked
              </span>
            </div>
            <h3 className="card-heading">Global Machine-Wide State</h3>
            <p className="card-text">
              Coding agents inherit whatever credentials exist in local directories or global CLI logins. When switching projects, stale context causes silent cross-contamination.
            </p>
            <div className="trap-consequences">
              <div className="consequence-item">
                <span className="consequence-bullet">✕</span>
                <div>
                  <strong>Accidental Database Overwrites</strong>
                  <p>An agent working on Koupa issues schema migrations against Nabdh Supabase project.</p>
                </div>
              </div>
              <div className="consequence-item">
                <span className="consequence-bullet">✕</span>
                <div>
                  <strong>Raw Secrets Exposed in Prompts</strong>
                  <p>Private keys from .env files are printed directly into model context windows.</p>
                </div>
              </div>
              <div className="consequence-item">
                <span className="consequence-bullet">✕</span>
                <div>
                  <strong>No Repository Identity Check</strong>
                  <p>Forked or copied folders automatically inherit permissions without verification.</p>
                </div>
              </div>
            </div>

            <div className="code-snippet-box" style={{ marginTop: 20 }}>
              <div className="snippet-head" style={{ color: "#f28b82" }}>
                UNCHECKED AMBIENT CONTEXT · CRITICAL LEAK
              </div>
              <pre style={{ color: "#f28b82", fontSize: 11 }}>
                <code>{`// Agent reads whatever exists on machine:
$ cd ~/Projects/Koupa
$ echo $SUPABASE_SERVICE_ROLE_KEY
eyJh... (LEAKED: From Nabdh staging environment!)
[HAZARD] Silent cross-write to wrong project database.`}</code>
              </pre>
            </div>
          </div>
        </div>

        {/* With Nexus */}
        <div className="double-bezel-card shield-bezel">
          <div className="bezel-inner">
            <div className="card-badge-header">
              <span className="status-pill green-pill">
                <ShieldCheck size={13} weight="fill" />
                With Nexus Guard (planned) : Bound to Project
              </span>
            </div>
            <h3 className="card-heading">Project-Bound Resources (MVP target)</h3>
            <p className="card-text">
              Planned: Nexus gives each Agent Session only the Resource approved for its Nexus Project and Environment. Two sessions can work at the same time on different projects without receiving each other&apos;s Resource. The scaffold does not enforce this yet.
            </p>
            <div className="shield-benefits">
              <div className="benefit-item">
                <span className="benefit-bullet">✓</span>
                <div>
                  <strong>Koupa Stays Separate from Nabdh</strong>
                  <p>Koupa receives only Koupa targets (koupa-production). Nabdh receives only Nabdh targets (nabdh-development).</p>
                </div>
              </div>
              <div className="benefit-item">
                <span className="benefit-bullet">✓</span>
                <div>
                  <strong>OS Keychain Vault (planned)</strong>
                  <p>Secrets stay in OS secure storage and safe references stay in .nexus/project.json. Planned: tools, not raw secrets, reach the agent.</p>
                </div>
              </div>
              <div className="benefit-item">
                <span className="benefit-bullet">✓</span>
                <div>
                  <strong>Fail-Closed Guard (planned)</strong>
                  <p>Planned: if a Git remote disagrees or an agent asks for the other project&apos;s Resource, Nexus blocks instead of guessing. Direct provider use outside Nexus stays unmanaged.</p>
                </div>
              </div>
            </div>

            <div className="code-snippet-box" style={{ marginTop: 20 }}>
              <div className="snippet-head" style={{ color: "#74c59a" }}>
                NEXUS SCAFFOLD DIRECTION · OS KEYCHAIN (PLANNED)
              </div>
              <pre style={{ color: "#74c59a", fontSize: 11 }}>
                <code>{`// Planned: Nexus validates caller project against git root:
$ nexus.request_access(project: "Koupa")
→ Caller Git: github.com/saadi/koupa [MATCH]
→ Resource: koupa-production [BOUND]
[PLANNED] Raw secret never enters agent prompt.`}</code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ArchitectureFlowVisualizer() {
  const [flowMode, setFlowMode] = useState<"koupa-valid" | "nabdh-breach">("koupa-valid");

  return (
    <div className="topology-container">
      <div className="topology-outer-bezel">
        <div className="topology-inner-core">
          <div className="topology-toolbar">
            <div className="topology-toolbar-left">
              <span className="terminal-dot red" />
              <span className="terminal-dot yellow" />
              <span className="terminal-dot green" />
              <span className="topology-title">topology-flow :: planned project boundary (illustration, not live)</span>
            </div>
            <div className="topology-mode-selector">
              <button
                type="button"
                className={`topology-mode-btn ${flowMode === "koupa-valid" ? "active" : ""}`}
                onClick={() => setFlowMode("koupa-valid")}
              >
                Authorized Flow (Koupa → koupa-production)
              </button>
              <button
                type="button"
                className={`topology-mode-btn ${flowMode === "nabdh-breach" ? "active-danger" : ""}`}
                onClick={() => setFlowMode("nabdh-breach")}
              >
                Cross-Project Breach (Nabdh → koupa-production)
              </button>
            </div>
          </div>

          <div className="topology-canvas-wrap">
            <svg
              className="topology-svg-highway"
              viewBox="0 0 920 250"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="gradKoupa" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#e8e8e8" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#74c59a" stopOpacity="0.8" />
                </linearGradient>
                <linearGradient id="gradNabdh" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#7aa9d8" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#f28b82" stopOpacity="0.8" />
                </linearGradient>
              </defs>

              {/* Grid Background Pattern */}
              <g opacity="0.12">
                <line x1="0" y1="62" x2="920" y2="62" stroke="#4a463f" strokeDasharray="4 8" />
                <line x1="0" y1="125" x2="920" y2="125" stroke="#4a463f" strokeDasharray="4 8" />
                <line x1="0" y1="188" x2="920" y2="188" stroke="#4a463f" strokeDasharray="4 8" />
              </g>

              {/* Data Cables from Agents to Central Broker */}
              {/* Path 1: Koupa (220, 62) to Nexus Core (370, 100) */}
              <path
                id="cableKoupaToBroker"
                d="M 220 62 C 280 62, 310 100, 370 100"
                stroke={flowMode === "koupa-valid" ? "#74c59a" : "#333333"}
                strokeWidth="2"
                fill="none"
                className={flowMode === "koupa-valid" ? "animated-cable-green" : ""}
              />

              {/* Path 2: Nabdh (220, 188) to Nexus Core (370, 150) */}
              <path
                id="cableNabdhToBroker"
                d="M 220 188 C 280 188, 310 150, 370 150"
                stroke={flowMode === "nabdh-breach" ? "#f28b82" : "#333333"}
                strokeWidth="2"
                fill="none"
                className={flowMode === "nabdh-breach" ? "animated-cable-blocked" : ""}
              />

              {/* Data Cables from Central Broker to Target Services */}
              {/* Path 3: Nexus Core (550, 100) to Supabase Koupa-Production (700, 62) */}
              <path
                id="cableBrokerToKoupaTarget"
                d="M 550 100 C 610 100, 640 62, 700 62"
                stroke={flowMode === "koupa-valid" ? "#74c59a" : "#2b2b2b"}
                strokeWidth="2"
                fill="none"
                className={flowMode === "koupa-valid" ? "animated-cable-green" : ""}
              />

              {/* Path 4: Nexus Core (550, 150) to Supabase Nabdh-Development (700, 188) */}
              <path
                id="cableBrokerToNabdhTarget"
                d="M 550 150 C 610 150, 640 188, 700 188"
                stroke="#333333"
                strokeWidth="2"
                fill="none"
              />

              {/* Animated Packets.
                  Flat discs, no feGaussianBlur glow: Notion §11 locks the
                  identity to "muted fills, never glows". The dashed cable
                  below carries the motion on its own. */}
              {flowMode === "koupa-valid" && (
                <>
                  {/* Packet along Path 1 */}
                  <circle r="4.5" fill="#74c59a">
                    <animateMotion
                      path="M 220 62 C 280 62, 310 100, 370 100"
                      dur="1.8s"
                      repeatCount="indefinite"
                    />
                  </circle>
                  {/* Packet along Path 3 */}
                  <circle r="4.5" fill="#74c59a">
                    <animateMotion
                      path="M 550 100 C 610 100, 640 62, 700 62"
                      dur="1.8s"
                      repeatCount="indefinite"
                    />
                  </circle>
                </>
              )}

              {flowMode === "nabdh-breach" && (
                <>
                  {/* Unauthorized packet from Nabdh, halted at the broker */}
                  <circle r="5" fill="#f28b82">
                    <animateMotion
                      path="M 220 188 C 280 188, 310 150, 370 150"
                      dur="1.3s"
                      repeatCount="indefinite"
                    />
                  </circle>
                  {/* Security Barrier Marker at Broker Intercept Point (static) */}
                  <line x1="365" y1="135" x2="365" y2="165" stroke="#f28b82" strokeWidth="3" strokeLinecap="round" />
                </>
              )}

              {/* Node 1: Koupa Workspace (Left Top) */}
              <g transform="translate(20, 24)">
                <rect width="200" height="76" rx="10" fill="#212121" stroke="#36332d" strokeWidth="1" />
                <rect x="12" y="14" width="28" height="28" rx="6" fill="#2b2b2b" stroke="#3d3d3d" />
                <text x="26" y="32" fill="#e8e8e8" fontSize="11" fontWeight="bold" textAnchor="middle">KO</text>
                <text x="48" y="27" fill="#f5f5f5" fontSize="12" fontWeight="600">~/Projects/Koupa</text>
                <text x="48" y="42" fill="#a3a3a3" fontSize="10" fontFamily="var(--font-mono)">branch: main · agent-1</text>
                <rect x="12" y="52" width="76" height="16" rx="8" fill="#242424" stroke="#3d3d3d" />
                <text x="50" y="63" fill="#74c59a" fontSize="9" fontWeight="600" textAnchor="middle">PID: 8041 OK</text>
              </g>

              {/* Node 2: Nabdh Workspace (Left Bottom) */}
              <g transform="translate(20, 150)">
                <rect width="200" height="76" rx="10" fill="#212121" stroke="#36332d" strokeWidth="1" />
                <rect x="12" y="14" width="28" height="28" rx="6" fill="#242424" stroke="#3d3d3d" />
                <text x="26" y="32" fill="#7aa9d8" fontSize="11" fontWeight="bold" textAnchor="middle">NA</text>
                <text x="48" y="27" fill="#f5f5f5" fontSize="12" fontWeight="600">~/Projects/Nabdh</text>
                <text x="48" y="42" fill="#a3a3a3" fontSize="10" fontFamily="var(--font-mono)">branch: develop · agent-2</text>
                {flowMode === "nabdh-breach" ? (
                  <rect x="12" y="52" width="112" height="16" rx="8" fill="#2b2b2b" stroke="#522426" />
                ) : (
                  <rect x="12" y="52" width="76" height="16" rx="8" fill="#242424" stroke="#3d3d3d" />
                )}
                <text x="20" y="63" fill={flowMode === "nabdh-breach" ? "#f28b82" : "#74c59a"} fontSize="9" fontWeight="600">
                  {flowMode === "nabdh-breach" ? "BREACH ATTEMPT" : "PID: 8192 OK"}
                </text>
              </g>

              {/* Center Node: Nexus Guard Security Broker Core */}
              <g transform="translate(370, 30)">
                <rect width="180" height="190" rx="14" fill="#161514" stroke="#333333" strokeWidth="1.5" />
                
                {/* Header Badge */}
                <rect x="16" y="16" width="148" height="22" rx="6" fill="#24211d" stroke="#333333" />
                <image href="/nexus-symbol.png" x="22" y="20" width="14" height="14" />
                <text x="42" y="31" fill="#e8e8e8" fontSize="9.5" fontWeight="bold" fontFamily="var(--font-mono)">NEXUS CORE · PLANNED</text>

                {/* Internal Pipeline Inspection Stages */}
                <g transform="translate(16, 48)">
                  <rect width="148" height="34" rx="6" fill="#212121" stroke="#33302b" />
                  <text x="10" y="16" fill="#d4d4d4" fontSize="9.5" fontWeight="600">1. Git Root Validator</text>
                  <text x="10" y="27" fill="#74c59a" fontSize="8.5" fontFamily="var(--font-mono)">github.com/saadi/koupa</text>
                </g>

                <g transform="translate(16, 88)">
                  <rect
                    width="148"
                    height="34"
                    rx="6"
                    fill={flowMode === "nabdh-breach" ? "#2b2b2b" : "#212121"}
                    stroke={flowMode === "nabdh-breach" ? "#5c2b2e" : "#33302b"}
                  />
                  <text x="10" y="16" fill={flowMode === "nabdh-breach" ? "#f28b82" : "#d4d4d4"} fontSize="9.5" fontWeight="600">
                    2. Context Matrix
                  </text>
                  <text x="10" y="27" fill={flowMode === "nabdh-breach" ? "#f28b82" : "#74c59a"} fontSize="8.5" fontFamily="var(--font-mono)">
                    {flowMode === "nabdh-breach" ? "DENIED: Target != Nabdh" : "MATCH: Koupa Approved"}
                  </text>
                </g>

                <g transform="translate(16, 128)">
                  <rect width="148" height="34" rx="6" fill="#212121" stroke="#33302b" />
                  <text x="10" y="16" fill="#d4d4d4" fontSize="9.5" fontWeight="600">3. OS Keychain Vault</text>
                  <text x="10" y="27" fill="#e8e8e8" fontSize="8.5" fontFamily="var(--font-mono)">Safe refs only (planned)</text>
                </g>

                <rect
                  x="16"
                  y="166"
                  width="148"
                  height="16"
                  rx="4"
                  fill={flowMode === "nabdh-breach" ? "#381719" : "#172b1e"}
                />
                <text
                  x="90"
                  y="178"
                  fill={flowMode === "nabdh-breach" ? "#f28b82" : "#74c59a"}
                  fontSize="8.5"
                  fontWeight="bold"
                  textAnchor="middle"
                  fontFamily="var(--font-mono)"
                >
                  {flowMode === "nabdh-breach" ? "FAIL-CLOSED (PLANNED)" : "BROKERED (PLANNED)"}
                </text>
              </g>

              {/* Node 3: Target Supabase Koupa-Production (Right Top) */}
              <g transform="translate(700, 24)">
                <rect
                  width="200"
                  height="76"
                  rx="10"
                  fill="#212121"
                  stroke={flowMode === "koupa-valid" ? "#3d3d3d" : "#36332d"}
                  strokeWidth="1"
                />
                <circle cx="28" cy="28" r="10" fill="#242424" stroke="#3d3d3d" />
                <path d="M 28 22 L 23 29 L 27 29 L 26 34 L 33 27 L 29 27 Z" fill="#74c59a" />
                <text x="46" y="26" fill="#f5f5f5" fontSize="12" fontWeight="600">koupa-production</text>
                <text x="46" y="40" fill="#a3a3a3" fontSize="10" fontFamily="var(--font-mono)">Provider: Supabase</text>
                <rect x="12" y="52" width="120" height="16" rx="8" fill="#242424" stroke="#3d3d3d" />
                <text x="18" y="63" fill="#74c59a" fontSize="9" fontWeight="600">
                  {flowMode === "koupa-valid" ? "PLANNED BROKERED SESSION" : "PLANNED ISOLATION"}
                </text>
              </g>

              {/* Node 4: Target Supabase Nabdh-Development (Right Bottom) */}
              <g transform="translate(700, 150)">
                <rect width="200" height="76" rx="10" fill="#212121" stroke="#36332d" strokeWidth="1" />
                <circle cx="28" cy="28" r="10" fill="#242424" stroke="#3d3d3d" />
                <path d="M 28 22 L 23 29 L 27 29 L 26 34 L 33 27 L 29 27 Z" fill="#7aa9d8" />
                <text x="46" y="26" fill="#f5f5f5" fontSize="12" fontWeight="600">nabdh-development</text>
                <text x="46" y="40" fill="#a3a3a3" fontSize="10" fontFamily="var(--font-mono)">Provider: Supabase</text>
                <rect x="12" y="52" width="104" height="16" rx="8" fill="#242424" stroke="#3d3d3d" />
                <text x="18" y="63" fill="#7aa9d8" fontSize="9" fontWeight="600">INDEPENDENT TARGET</text>
              </g>
            </svg>
          </div>

          {/* Phone-only vertical stack: same nodes + verdict, no sideways scroll */}
          <div className="topology-stack" aria-hidden="false">
            <div className="topology-node">
              <span className="node-eyebrow">AGENT SESSION</span>
              <strong>{flowMode === "koupa-valid" ? "agent-1 · ~/Projects/Koupa" : "agent-2 · ~/Projects/Nabdh"}</strong>
              <span className="node-meta">Supabase access requested</span>
            </div>
            <div className="topology-connector">
              <span>resolves project + environment</span>
              <span className="connector-line" />
            </div>
            <div className="topology-node node-broker">
              <span className="node-eyebrow">NEXUS CORE (PLANNED)</span>
              <strong>{flowMode === "koupa-valid" ? "MATCH: Koupa approved" : "DENIED: resource belongs to Koupa"}</strong>
              <span className="node-meta">Git remote + .nexus/project.json checked</span>
            </div>
            <div className="topology-connector">
              <span>{flowMode === "koupa-valid" ? "scoped capability" : "halted closed"}</span>
              <span className="connector-line" />
            </div>
            <div className="topology-node">
              <span className="node-eyebrow">SUPABASE RESOURCE</span>
              <strong>koupa-production</strong>
              <span className="node-meta">{flowMode === "koupa-valid" ? "Planned brokered session" : "Planned isolation — no leak"}</span>
            </div>
          </div>

          <div className="topology-footer-telemetry">
            <div className="topo-telemetry-tag">
              <span>SCOPE:</span>
              <strong>Illustration · scaffold, not a running daemon</strong>
            </div>
            <div className="topo-telemetry-tag">
              <span>OVERHEAD:</span>
              <strong className="val-green">Not measured yet</strong>
            </div>
            <div className="topo-telemetry-tag">
              <span>CROSS-PROJECT POLLUTION:</span>
              <strong className="val-green">Planned: blocked, not guessed</strong>
            </div>
            <div className="topo-telemetry-tag">
              <span>SECRETS TO AGENT:</span>
              <strong className="val-green">Planned: tools, not raw secrets</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Canonical Chain : scroll-driven resolution
   --------------------------------------------------------------------------
   The product argument is that access resolves through an ordered chain, so
   the section states that chain as a spine that draws itself as you scroll.
   Each node ignites in sequence, which makes the reader watch resolution
   happen rather than read a sentence about it.
   -------------------------------------------------------------------------- */
const CHAIN_STEPS: { key: string; detail: string }[] = [
  { key: "Agent", detail: "A coding agent asks for a service. Nexus never receives an unlabelled request." },
  { key: "Session", detail: "One agent, one workspace, one moment. Server-held context, re-validated every time." },
  { key: "Project", detail: "Resolved from .nexus/project.json, the Git remote, or a previously verified mapping." },
  { key: "Environment", detail: "Development or production. The same service name never implies the same resource." },
  { key: "Service", detail: "A provider, such as Supabase. The MVP covers Supabase only." },
  { key: "Account", detail: "The linked account within the service (e.g. Personal vs a client account). Same resource name under different accounts is never the same resource." },
  { key: "Resource", detail: "The concrete project-scoped instance, such as koupa-production." },
  { key: "Capability", detail: "Permission for one operation under this session. Tools reach the agent, not raw secrets." },
  { key: "Policy Decision", detail: "Allow, warn, require approval, or block. Deterministic, and never a silent guess." },
];

/* --------------------------------------------------------------------------
   Canonical chain : scroll-driven resolution, rebuilt
   --------------------------------------------------------------------------
   The viewport midpoint is the "reading head". As it travels down the
   track, the spine fill grows to meet it and each node ignites exactly
   when the line reaches it: the dot fills with a soft glow and the words
   beside it brighten. All motion is one-shot transitions (opacity /
   transform / color), so nothing repaints in a loop.
   -------------------------------------------------------------------------- */
function CanonicalChain() {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const [litCount, setLitCount] = useState(0);

  useEffect(() => {
    let raf = 0;

    function update() {
      raf = 0;
      const track = trackRef.current;
      const fill = fillRef.current;
      if (!track || !fill || track.offsetHeight === 0) return;
      const rect = track.getBoundingClientRect();
      const viewportH = window.innerHeight || 800;
      // Progress of the viewport midpoint through the track: 0 at the
      // moment the midpoint touches the track top, 1 when it leaves
      // the bottom. Nodes ignite in reading order as the line meets them.
      const progress = Math.min(1, Math.max(0, (viewportH * 0.55 - rect.top) / rect.height));
      fill.style.height = `${progress * 100}%`;
      const steps = track.querySelectorAll(".chain-step");
      let lit = 0;
      steps.forEach((el) => {
        if (progress * track.offsetHeight >= (el as HTMLElement).offsetTop + 6) lit += 1;
      });
      setLitCount((prev) => (prev === lit ? prev : lit));
    }

    function onScroll() {
      if (!raf) raf = requestAnimationFrame(update);
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="chain-track" ref={trackRef}>
      <span className="chain-spine" aria-hidden="true" />
      <span className="chain-spine-fill" aria-hidden="true" ref={fillRef} />
      <ol className="chain-steps">
        {CHAIN_STEPS.map((step, idx) => (
          <li className={`chain-step ${idx < litCount ? "lit" : ""}`} key={step.key}>
            <span
              className={`chain-node ${idx === CHAIN_STEPS.length - 1 ? "chain-node-final" : ""} ${idx < litCount ? "lit" : ""}`}
              aria-hidden="true"
            />
            <div className="chain-step-label">
              {step.key}
            </div>
            <p className="chain-step-detail">
              {step.detail}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ArchitectureSection() {
  return (
    <section className="section-frame" id="architecture">
      <div className="section-heading-stack">
        <h2 className="section-title">The canonical chain: Session → Project → Environment → Service → Account → Resource.</h2>
        <p className="section-description">
          A Resource belongs to one Account within one Nexus Project and Environment, not to a global login. One Agent Session has one clear project context, re-validated every request. Supabase + Project A ≠ Supabase + Project B. Supabase + production ≠ Supabase + development. Supabase Account 1 + Resource X ≠ Supabase Account 2 + Resource X.
        </p>
      </div>

      <div className="architecture-chain-layout">
        <CanonicalChain />
        <ArchitectureFlowVisualizer />
      </div>

      <div className="bento-grid-gapless">
        {/* Cell 1: Workspace Binding */}
        <div className="bento-card cell-workspace">
          <div className="card-inner">
            <div className="cell-top">
              <div className="cell-icon-wrap">
                <Folder size={17} weight="bold" />
              </div>
              <span className="cell-tag">01 : WORKSPACE</span>
            </div>
            <h3 className="cell-title">Workspace &amp; Git Remote Binding (planned)</h3>
            <p className="cell-desc">
              Planned: Nexus reads the folder, checks its saved project choice against its Git address and the secret-free .nexus/project.json registry entry, and returns only the Resources approved for that folder. Missing or conflicting identity stops the request; Nexus never silently guesses.
            </p>
            <div className="code-snippet-box">
              <div className="snippet-head">~/Projects/Koupa/.nexus/project.json (secret-free)</div>
              <pre>
                <code>{`{
  "project": "Koupa",
  "project_id": "koupa",
  "environment": "production",
  "connections": {
    "supabase": {
      "target": "koupa-production",
      "resource": "koupa-production",
      "environment": "production",
      "method": "manual",
      "status": "not_connected"
    }
  }
}`}</code>
              </pre>
            </div>
          </div>
        </div>

        {/* Cell 2: Agent Sessions */}
        <div className="bento-card cell-session">
          <div className="card-inner">
            <div className="cell-top">
              <div className="cell-icon-wrap">
                <Cpu size={17} weight="bold" />
              </div>
              <span className="cell-tag">02 : SESSIONS</span>
            </div>
            <h3 className="cell-title">Isolated Agent Sessions (planned)</h3>
            <p className="cell-desc">
              Planned: one agent working on one workspace at a particular time, with server-held short-lived session context re-validated on every request. Two sessions never share mutable current project.
            </p>
            <div className="token-visual-box">
              <div className="token-row">
                <span className="token-lbl">Koupa Agent Session:</span>
                <span className="token-val">resource: koupa-production</span>
              </div>
              <div className="token-row">
                <span className="token-lbl">Nabdh Agent Session:</span>
                <span className="token-val">resource: nabdh-development</span>
              </div>
            </div>
          </div>
        </div>

        {/* Cell 3: Credential Broker */}
        <div className="bento-card cell-broker">
          <div className="card-inner">
            <div className="cell-top">
              <div className="cell-icon-wrap">
                <LockKey size={17} weight="bold" />
              </div>
              <span className="cell-tag">03 : VAULT BROKER</span>
            </div>
            <h3 className="cell-title">OS Keychain Vault (planned)</h3>
            <p className="cell-desc">
              Planned: the broker gives an Agent Session only the Resource allowed for its Nexus Project as a scoped time-limited Capability. Secrets stay in OS secure storage; repo files hold only safe references.
            </p>
            <div className="flow-visual-box">
              <span className="flow-node">Agent Tool Call</span>
              <span className="flow-arr">→</span>
              <span className="flow-node accent-node">Nexus Broker</span>
              <span className="flow-arr">→</span>
              <span className="flow-node">Approved Service</span>
            </div>
          </div>
        </div>

        {/* Cell 4: 4 Guard Outcomes */}
        <div className="bento-card cell-outcomes">
          <div className="card-inner">
            <div className="cell-top">
              <div className="cell-icon-wrap">
                <ShieldCheck size={17} weight="bold" />
              </div>
              <span className="cell-tag">04 : GUARD DECISION</span>
            </div>
            <h3 className="cell-title">Deterministic Guard Outcomes (planned)</h3>
            <p className="cell-desc">
              Planned result of checking whether an agent Capability request matches the current Project Context: allow, warn, require approval, or block. Warn ≠ block; approval is explicit.
            </p>
            <div className="outcomes-stack">
              <div className="outcome-item">
                <span className="status-pill green-pill">ALLOW</span>
                <span className="outcome-text">Request matches project context (Koupa → koupa-production)</span>
              </div>
              <div className="outcome-item">
                <span className="status-pill orange-pill">WARN</span>
                <span className="outcome-text">Risky but reversible action, logged to the secret-free Audit Log</span>
              </div>
              <div className="outcome-item">
                <span className="status-pill block-pill">BLOCK</span>
                <span className="outcome-text">Resource mismatch (Koupa asking for nabdh-development)</span>
              </div>
              <div className="outcome-item">
                <span className="status-pill approve-pill">REQUIRE APPROVAL</span>
                <span className="outcome-text">Destructive, production, or credential-exposing action waits for the developer</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Interactive Simulator: Guard Decision Engine (Using Actual App Examples)
-------------------------------------------------------------------------- */
type ScenarioId = "cross-project" | "tampered-remote" | "read-only" | "branch-redirect";
type TabId = "jsonrpc" | "policy" | "terminal";

function SimulatorSection() {
  const [scenario, setScenario] = useState<ScenarioId>("cross-project");
  const [tab, setTab] = useState<TabId>("jsonrpc");
  const [copied, setCopied] = useState(false);
  const [scanning, setScanning] = useState(false);

  function switchScenario(s: ScenarioId) {
    if (s === scenario) return;
    setScanning(true);
    setScenario(s);
    setTimeout(() => setScanning(false), 380);
  }

  function switchTab(t: TabId) {
    if (t === tab) return;
    setScanning(true);
    setTab(t);
    setTimeout(() => setScanning(false), 280);
  }

  function handleReevaluate() {
    setScanning(true);
    setTimeout(() => setScanning(false), 450);
  }

  const scenarioData = useMemo(() => {
    switch (scenario) {
      case "cross-project":
        return {
          title: "Cross-Project Resource Request (planned)",
          actionBadge: "BLOCK",
          actionTone: "block",
          summary: "Planned: agent in Koupa requests Nabdh Supabase Resource (nabdh-development).",
          jsonrpcReq: `{
  "jsonrpc": "2.0",
  "id": "req-101",
  "method": "nexus.request_access",
  "params": {
    "project": "Koupa",
    "workspace": "~/Projects/Koupa",
    "environment": "production",
    "service": "Supabase",
    "resource": "nabdh-development"
  }
}`,
          jsonrpcRes: `{
  "jsonrpc": "2.0",
  "id": "req-101",
  "error": {
    "code": -32003,
    "message": "Guard decision: BLOCKED",
    "data": {
      "reason": "Resource belongs to Nabdh, not Koupa",
      "requested_resource": "nabdh-development",
      "approved_resource": "koupa-production"
    }
  }
}`,
          policyAst: `CHECKING CONTEXT MATCH (PLANNED):
├── Registered Nexus Project: Koupa
├── Caller Workspace: ~/Projects/Koupa (Git: github.com/saadi/koupa)
├── Approved Supabase Resource: koupa-production
└── Requested Resource: nabdh-development
    └── Resource Owner: Nabdh
    └── MATCH: FALSE ──► GUARD ACTION: BLOCK
Status: Blocked before provider step; never silently guessed`,
          terminalLog: `[nexus-check] Reading workspace: ~/Projects/Koupa
[nexus-check] Git address verified: github.com/saadi/koupa
[nexus-check] Agent requested resource: "nabdh-development"
[nexus-check] CHECK FAILED: Resource belongs to Nabdh. Caller project is Koupa.
[nexus-check] Guard decision: BLOCKED (planned)
[nexus-check] No secret value returned to the agent.`,
        };

      case "tampered-remote":
        return {
          title: "Conflicting Git Address (planned)",
          actionBadge: "BLOCK",
          actionTone: "block",
          summary: "Planned: folder claims Koupa but its Git remote does not match the registered repository.",
          jsonrpcReq: `{
  "jsonrpc": "2.0",
  "id": "req-102",
  "method": "nexus.context",
  "params": {
    "project": "Koupa",
    "folder": "~/Projects/Koupa-Fork"
  }
}`,
          jsonrpcRes: `{
  "jsonrpc": "2.0",
  "id": "req-102",
  "error": {
    "code": -32004,
    "message": "Guard decision: BLOCKED",
    "data": {
      "reason": "The Git address does not match the chosen project",
      "expected_remote": "github.com/saadi/koupa",
      "detected_remote": "github.com/untrusted/koupa"
    }
  }
}`,
          policyAst: `CHECKING REPOSITORY IDENTITY (PLANNED):
├── Project Manifest Name: "Koupa"
├── Expected Git Address: github.com/saadi/koupa
└── Detected Remote Origin: github.com/untrusted/koupa
    └── MATCH: FALSE ──► GUARD ACTION: BLOCK
Resolution: Nexus does not guess; it halts closed.`,
          terminalLog: `[nexus-check] Verifying folder: ~/Projects/Koupa-Fork
[nexus-check] Running git config --local --get remote.origin.url
[nexus-check] Detected remote: "github.com/untrusted/koupa"
[nexus-check] Registered remote for Koupa: "github.com/saadi/koupa"
[nexus-check] Guard decision: BLOCKED (planned: Git address mismatch)
[nexus-check] Halting without opening resources.`,
        };

      case "read-only":
        return {
          title: "Approved Service Request (planned)",
          actionBadge: "ALLOW",
          actionTone: "allow",
          summary: "Planned: Koupa session requests its own Supabase Resource (koupa-production).",
          jsonrpcReq: `{
  "jsonrpc": "2.0",
  "id": "req-103",
  "method": "nexus.execute",
  "params": {
    "project": "Koupa",
    "workspace": "~/Projects/Koupa",
    "environment": "production",
    "service": "Supabase",
    "resource": "koupa-production"
  }
}`,
          jsonrpcRes: `{
  "jsonrpc": "2.0",
  "id": "req-103",
  "result": {
    "decision": "ALLOWED",
    "project": "Koupa",
    "environment": "production",
    "service": "Supabase",
    "resource": "koupa-production",
    "capability": "scoped, time-limited",
    "secret_shown": false
  }
}`,
          policyAst: `CHECKING CONTEXT MATCH (PLANNED):
├── Registered Nexus Project: Koupa
├── Caller Workspace: ~/Projects/Koupa
├── Git Remote: github.com/saadi/koupa [MATCH]
├── Service: Supabase (MVP provider)
└── Requested Resource: koupa-production [MATCH]
    └── MATCH: TRUE ──► GUARD ACTION: ALLOW
Broker: Scoped capability provided. Secret stays in OS keychain.`,
          terminalLog: `[nexus-check] Reading workspace: ~/Projects/Koupa
[nexus-check] Git address verified: github.com/saadi/koupa
[nexus-check] Agent requested resource: "koupa-production"
[nexus-check] MATCH CONFIRMED: Resource belongs to Koupa.
[nexus-check] Guard decision: ALLOWED (planned)
[nexus-check] agent-1 → Koupa → production → koupa-production (secret shown: false)`,
        };

      case "branch-redirect":
        return {
          title: "Production Write Requires Approval (planned)",
          actionBadge: "REQUIRE APPROVAL",
          actionTone: "approve",
          summary: "Planned: destructive production action waits for the developer instead of executing.",
          jsonrpcReq: `{
  "jsonrpc": "2.0",
  "id": "req-104",
  "method": "nexus.request_access",
  "params": {
    "project": "Nabdh",
    "workspace": "~/Projects/Nabdh",
    "environment": "production",
    "service": "Supabase",
    "resource": "nabdh-production",
    "operation": "schema_migration"
  }
}`,
          jsonrpcRes: `{
  "jsonrpc": "2.0",
  "id": "req-104",
  "error": {
    "code": -32010,
    "message": "Guard decision: APPROVAL REQUIRED",
    "data": {
      "reason": "Destructive production operation needs developer approval",
      "resource": "nabdh-production",
      "status": "Waiting for developer, nothing executed"
    }
  }
}`,
          policyAst: `CHECKING RISK TIER (PLANNED):
├── Project: Nabdh
├── Environment: production
├── Requested Resource: nabdh-production
├── Operation: schema_migration (destructive)
└── Evaluation: high-risk tier cannot self-approve
    └── GUARD ACTION: REQUIRE APPROVAL
    └── Warn ≠ block: nothing executed until the developer approves`,
          terminalLog: `[nexus-check] Reading workspace: ~/Projects/Nabdh (environment: production)
[nexus-check] Requested resource: "nabdh-production" (schema_migration)
[nexus-check] RULE: Destructive production operations need developer approval
[nexus-check] Guard decision: APPROVAL REQUIRED (planned)
[nexus-check] Nothing executed. Waiting for developer in the desktop app.`,
        };
    }
  }, [scenario]);

  function handleCopy() {
    let textToCopy = "";
    if (tab === "jsonrpc") {
      textToCopy = `// Request:\n${scenarioData.jsonrpcReq}\n\n// Response:\n${scenarioData.jsonrpcRes}`;
    } else if (tab === "policy") {
      textToCopy = scenarioData.policyAst;
    } else {
      textToCopy = scenarioData.terminalLog;
    }
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="section-frame" id="simulator">
      <div className="section-heading-stack">
        <h2 className="section-title">Interactive Guard Decision Sketches (planned behavior).</h2>
        <p className="section-description">
          Planned sketches of how Nexus would check project requests over the spec MCP interface (nexus.context, nexus.request_access, nexus.execute). These illustrate intended policy evaluation, not a running guard.
        </p>
      </div>

      <div className="simulator-container">
        {/* Scenario Controls */}
        <div className="scenario-selector-row">
          <button
            type="button"
            className={`scenario-btn ${scenario === "cross-project" ? "active" : ""}`}
            onClick={() => switchScenario("cross-project")}
          >
            <span className="status-pill block-pill">BLOCK</span>
            <span className="btn-label">Cross-Project Request</span>
          </button>
          <button
            type="button"
            className={`scenario-btn ${scenario === "tampered-remote" ? "active" : ""}`}
            onClick={() => switchScenario("tampered-remote")}
          >
            <span className="status-pill block-pill">BLOCK</span>
            <span className="btn-label">Conflicting Git Remote</span>
          </button>
          <button
            type="button"
            className={`scenario-btn ${scenario === "read-only" ? "active" : ""}`}
            onClick={() => switchScenario("read-only")}
          >
            <span className="status-pill green-pill">ALLOW</span>
            <span className="btn-label">Approved Connection</span>
          </button>
          <button
            type="button"
            className={`scenario-btn ${scenario === "branch-redirect" ? "active" : ""}`}
            onClick={() => switchScenario("branch-redirect")}
          >
            <span className="status-pill approve-pill">APPROVAL</span>
            <span className="btn-label">Production Approval</span>
          </button>
        </div>

        {/* Double-Bezel Simulator Console */}
        <div className="double-bezel-card simulator-bezel">
          <div className="bezel-inner">
            <div className="workbench-header">
              <div className="workbench-title-info">
                <span className={`status-pill ${scenarioData.actionTone}-pill ${scanning ? "stamp-animate" : ""}`}>
                  {scenarioData.actionBadge}
                </span>
                <strong>{scenarioData.title}</strong>
                <span className="workbench-summary">{scenarioData.summary}</span>
              </div>

              <div className="workbench-tabs">
                <button
                  type="button"
                  className="sim-execute-btn"
                  onClick={handleReevaluate}
                  title="Re-run policy broker check"
                >
                  <Play size={11} weight="fill" />
                  <span>Re-Evaluate</span>
                </button>
                <button
                  type="button"
                  className={`tab-switch ${tab === "jsonrpc" ? "active" : ""}`}
                  onClick={() => switchTab("jsonrpc")}
                >
                  MCP JSON-RPC
                </button>
                <button
                  type="button"
                  className={`tab-switch ${tab === "policy" ? "active" : ""}`}
                  onClick={() => switchTab("policy")}
                >
                  Policy Check
                </button>
                <button
                  type="button"
                  className={`tab-switch ${tab === "terminal" ? "active" : ""}`}
                  onClick={() => switchTab("terminal")}
                >
                  Terminal Output
                </button>
                <button
                  type="button"
                  className="copy-btn"
                  onClick={handleCopy}
                  title="Copy current view"
                >
                  {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
            </div>

            <div className="workbench-body" style={{ position: "relative" }}>
              <div className={`sim-scan-beam ${scanning ? "active" : ""}`} aria-hidden="true" />
              {tab === "jsonrpc" && (
                <div className="jsonrpc-split">
                  <div className="jsonrpc-pane">
                    <div className="pane-label">AGENT MCP REQUEST</div>
                    <pre className="code-view">
                      <code>{scenarioData.jsonrpcReq}</code>
                    </pre>
                  </div>
                  <div className="jsonrpc-pane">
                    <div className="pane-label">NEXUS GUARD DECISION</div>
                    <pre className="code-view">
                      <code>{scenarioData.jsonrpcRes}</code>
                    </pre>
                  </div>
                </div>
              )}

              {tab === "policy" && (
                <div className="policy-view">
                  <pre className="code-view policy-pre">
                    <code>{scenarioData.policyAst}</code>
                  </pre>
                </div>
              )}

              {tab === "terminal" && (
                <div className="terminal-view">
                  <pre className="code-view terminal-pre">
                    <code>{scenarioData.terminalLog}</code>
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Desktop App Section: 1:1 Live Interactive Prototype Showcase
-------------------------------------------------------------------------- */
function DesktopSection() {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <section className="desktop-section section-frame" id="desktop-app">
      <div className="section-heading-stack">
        <h2 className="section-title">Linux desktop app: live Supabase verification today.</h2>
        <p className="section-description">
          The scaffold below is a clickable mock of the control room — setup in progress, connections not verified, Guard off. The real desktop app already goes further: Supabase OAuth browser approval, live project list and connection verification, OS keychain vault, agent CLI detection with confirm/diff/backup writes, deterministic Guard policy, and a secret-free audit log. Caveat: end-to-end validation over the single persistent HTTP transport is still pending (see docs/VALIDATION-HTTP.md) — treated as unproven until re-run, not as done.
        </p>
      </div>

      <div className="desktop-prototype-centerpiece">
        <DesktopAppPrototype
          isFullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen((prev) => !prev)}
        />
      </div>

      <div className="desktop-prototype-fallback">
        <div className="double-bezel-card">
          <div className="bezel-inner fallback-inner">
            <Cpu size={22} weight="bold" className="fallback-icon" />
            <h3>Best explored on a laptop.</h3>
            <p>
              The desktop app prototype needs a wider screen. Revisit on a laptop —
              or try the Guard simulator above, which is fully usable on this phone.
            </p>
            <a href="#simulator" className="secondary-button">
              <span>Open Guard simulator</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   How Agents Connect: MCP Architecture & Boundary (From PRODUCT_BRIEF.md)
-------------------------------------------------------------------------- */
function HowAgentsConnectSection() {
  return (
    <section className="section-frame" id="architecture-detail">
      <div className="section-heading-stack">
        <div className="hero-eyebrow">
          <span className="status-dot green" />
          <span>HOW A SERVICE CAN CONNECT</span>
        </div>
        <h2 className="section-title">Two connection methods and an unmanaged boundary.</h2>
        <p className="section-description">
          Planned: every method ends with the same result, a Resource linked to one Nexus Project and Environment. The connection method and its status stay visible. Anything outside Nexus is unmanaged, not protected.
        </p>
      </div>

      <div className="architecture-grid">
        {/* Topology */}
        <div className="double-bezel-card flow-card">
          <div className="bezel-inner">
            <h3 className="card-title">How Nexus Would Mediate Service Access (planned)</h3>
            <div className="topology-flow">
              <div className="topology-node node-agent">
                <span className="node-eyebrow">CODING AGENT</span>
                <strong>Agent Session</strong>
                <span className="node-meta">One session, one workspace (Koupa or Nabdh)</span>
              </div>
              <div className="topology-connector">
                <span>requests a capability</span>
                <span className="connector-line" />
              </div>
              <div className="topology-node node-broker">
                <span className="node-eyebrow">LOCAL SCAFFOLD (TAURI + RUST)</span>
                <strong>Nexus Guard (planned broker)</strong>
                <span className="node-meta">Checks workspace folder &amp; Git remote every request</span>
              </div>
              <div className="topology-connector">
                <span>resolves project + environment + resource</span>
                <span className="connector-line" />
              </div>
              <div className="topology-node node-vault">
                <span className="node-eyebrow">DESKTOP VAULT</span>
                <strong>OS Keychain Storage</strong>
                <span className="node-meta">System keychain holds secrets; repo holds safe refs</span>
              </div>
              <div className="topology-connector">
                <span>scoped capability, tools not raw secrets</span>
                <span className="connector-line" />
              </div>
              <div className="topology-node node-service">
                <span className="node-eyebrow">APPROVED RESOURCE (MVP)</span>
                <strong>Supabase only</strong>
                <span className="node-meta">Resource belongs to one project + environment</span>
              </div>
            </div>
          </div>
        </div>

        {/* The 2 Connection Methods */}
        <div className="double-bezel-card tiers-card">
          <div className="bezel-inner">
            <h3 className="card-title">Connection Methods in the App</h3>
            <div className="tier-list">
              <div className="tier-item">
                <div className="tier-num">01</div>
                <div>
                  <strong>Manual details</strong>
                  <p>The user enters safe project details, then saves an allowed publishable key in the desktop vault.</p>
                </div>
              </div>
              <div className="tier-item">
                <div className="tier-num">02</div>
                <div>
                  <strong>MCP browser approval</strong>
                  <p>Nexus starts an authorization flow, the user signs in in a browser, chooses the correct organization and project, and approves access stored in the desktop vault.</p>
                </div>
              </div>
            </div>

            <div className="unmanaged-transparency-box">
              <div className="transparency-head">
                <Info size={15} weight="bold" />
                <strong>Managed vs Unmanaged Actions</strong>
              </div>
              <p>
                An action that does not go through Nexus is <strong>unmanaged</strong>, so Nexus cannot promise that it saw or stopped it. Direct provider CLI, MCP, or browser use is unmanaged, not protected.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Experiments & Evidence: Real Test Data (001, 002, 003)
-------------------------------------------------------------------------- */
const EVIDENCE_LOG = `running 15 tests
test tests::real_folders_keep_their_own_resources ... ok
test tests::nested_folder_still_finds_the_right_project ... ok
test tests::changed_git_address_does_not_switch_projects ... ok
test tests::conflicting_project_file_is_blocked ... ok
test tests::changed_service_mapping_is_blocked ... ok
test tests::invalid_project_file_is_blocked ... ok
test tests::unregistered_folder_is_not_guessed ... ok
test tests::wrong_target_never_reaches_fake_service ... ok
test tests::matching_target_reaches_fake_service ... ok
test tests::two_simultaneous_workspaces_stay_separate ... ok
test tests::two_agents_receive_their_own_connections ... ok
test tests::agents_can_ask_at_the_same_time_without_mixing_projects ... ok
test tests::an_agent_cannot_request_the_other_projects_connection ... ok
test tests::a_closed_agent_cannot_request_a_service ... ok
test tests::changed_address_cannot_be_registered_as_wrong_project ... ok

test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
(fake targets only: supabase-koupa-dev, supabase-nabdh-dev)`;

/* --------------------------------------------------------------------------
   Typewriter : the cargo test log
   --------------------------------------------------------------------------
   This is the one piece of genuine output on the page, so it is the one
   worth animating. It types once when scrolled into view, then stops
   permanently. It is not a loop: a looping caret on real test output reads
   as a fake console, which is exactly what this page is arguing against.
   ------------------------------------------------------------------------ */
function useTypewriter(text: string) {
  const [output, setOutput] = useState(text);
  const hostRef = useRef<HTMLPreElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || startedRef.current) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return; // full text already rendered by useState

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || startedRef.current) return;
        startedRef.current = true;
        observer.disconnect();

        // Line by line, not character by character. This is a real
        // `cargo test` run: that output streams a line at a time, and
        // typing it out character-wise took ~5s for 15 lines, which reads
        // as sluggish rather than as output arriving. One line every
        // ~55ms lands the whole log in under a second.
        const lines = text.split("\n");
        const LINE_MS = 55;
        let lineIndex = 0;
        let lastTick = 0;

        const tick = (now: number) => {
          if (now - lastTick >= LINE_MS) {
            lastTick = now;
            lineIndex = Math.min(lineIndex + 1, lines.length);
            setOutput(lines.slice(0, lineIndex).join("\n"));
          }
          if (lineIndex < lines.length) {
            requestAnimationFrame(tick);
          }
        };

        setOutput("");
        requestAnimationFrame(tick);
      },
      { threshold: 0.25 },
    );

    observer.observe(host);
    return () => observer.disconnect();
  }, [text]);

  return { output, hostRef };
}

function EvidenceSection() {
  const [copied, setCopied] = useState(false);
  const { output, hostRef } = useTypewriter(EVIDENCE_LOG);

  function copyLog() {
    navigator.clipboard.writeText(EVIDENCE_LOG);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="section-frame" id="evidence">
      <div className="section-heading-stack">
        <h2 className="section-title">Prototype evidence: Experiments 001 to 003 (fake targets only).</h2>
        <p className="section-description">
          Small local prototype checks in prototype/nexus-check using fake projects and fake service names (for example supabase-koupa-dev). No real provider, no real credentials, no agent integration yet. Repeat with the command shown below.
        </p>
      </div>

      <div className="evidence-grid">
        {/* Experiment 001 */}
        <div className="double-bezel-card evidence-card">
          <div className="bezel-inner">
            <div className="evidence-head">
              <span className="exp-id">EXPERIMENT 001</span>
              <span className="status-pill green-pill">5 / 5 PASSED</span>
            </div>
            <h3 className="evidence-title">Keep Two Projects Separate</h3>
            <p className="evidence-desc">
              Two fake projects (Koupa and Nabdh) with fake Supabase, Convex, Clerk, and Sentry targets. No real account, password, or secret used.
            </p>
            <ul className="evidence-checklist">
              <li><span>✓</span> Koupa receives only Koupa resources</li>
              <li><span>✓</span> Nabdh receives only Nabdh resources</li>
              <li><span>✓</span> Request for other project resource is blocked</li>
              <li><span>✓</span> Conflicting project identity is blocked</li>
            </ul>
          </div>
        </div>

        {/* Experiment 002 */}
        <div className="double-bezel-card evidence-card">
          <div className="bezel-inner">
            <div className="evidence-head">
              <span className="exp-id">EXPERIMENT 002</span>
              <span className="status-pill green-pill">11 / 11 PASSED</span>
            </div>
            <h3 className="evidence-title">Read Two Real Local Folders</h3>
            <p className="evidence-desc">
              Two temporary Git folders with .nexus/project.json on Linux. Subfolder traversal resolves the same project; altered remotes and invalid manifests fail closed.
            </p>
            <ul className="evidence-checklist">
              <li><span>✓</span> Subfolder identifies correct project</li>
              <li><span>✓</span> Changing Git address blocks the folder</li>
              <li><span>✓</span> Invalid manifest JSON is blocked</li>
              <li><span>✓</span> Unregistered folder is not guessed</li>
            </ul>
          </div>
        </div>

        {/* Experiment 003 */}
        <div className="double-bezel-card evidence-card">
          <div className="bezel-inner">
            <div className="evidence-head">
              <span className="exp-id">EXPERIMENT 003</span>
              <span className="status-pill green-pill">15 / 15 PASSED</span>
            </div>
            <h3 className="evidence-title">Two Agents at the Same Time</h3>
            <p className="evidence-desc">
              agent-1 on Koupa and agent-2 on Nabdh asked the prototype broker for Supabase, including simultaneous requests. Fake names only.
            </p>
            <ul className="evidence-checklist">
              <li><span>✓</span> Simultaneous requests did not mix projects</li>
              <li><span>✓</span> agent-1 could not ask for Nabdh resource</li>
              <li><span>✓</span> Closed agent could not ask again</li>
              <li><span>✓</span> No secret value was returned to either agent</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Cargo Test Terminal Output */}
      <div className="cargo-test-terminal" style={{ position: "relative" }}>
        <div className="terminal-titlebar">
          <span className="terminal-dot red" />
          <span className="terminal-dot yellow" />
          <span className="terminal-dot green" />
          <span className="terminal-title-text">cargo test --manifest-path prototype/nexus-check/Cargo.toml</span>
          <span className="titlebar-live-beacon" style={{ marginLeft: "auto" }}>
            <span className="titlebar-live-dot" />
            15 / 15 PROTOTYPE CHECKS · FAKE TARGETS ONLY
          </span>
          <button type="button" className="copy-btn" onClick={copyLog} title="Copy test output">
            {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
        <pre className="terminal-body" ref={hostRef}>
          <code>{output}
            <span className="terminal-cursor" aria-hidden="true" />
          </code>
        </pre>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Comparison Matrix
-------------------------------------------------------------------------- */
function ComparisonSection() {
  return (
    <section className="section-frame" id="comparison">
      <div className="section-heading-stack">
        <h2 className="section-title">Planned Nexus Guard vs ambient developer setups.</h2>
        <p className="section-description">
          Planned project-aware isolation compared to traditional .env files and shared provider logins. The scaffold does not enforce these rows yet.
        </p>
      </div>

      <div className="double-bezel-card comparison-wrap-bezel">
        <div className="bezel-inner no-padding">
          <div className="table-responsive">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th className="th-feature">CAPABILITY</th>
                  <th className="th-ambient">Local .env Files</th>
                  <th className="th-ambient">Global Provider CLIs</th>
                  <th className="th-nexus">Nexus Guard</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="td-feature">
                    <strong>Project Context Binding</strong>
                    <span>Binds access to workspace folder and Git remote</span>
                  </td>
                  <td className="td-val danger">Directory only</td>
                  <td className="td-val danger">Global user login</td>
                  <td className="td-val success">Verified Git remote &amp; manifest</td>
                </tr>
                <tr>
                  <td className="td-feature">
                    <strong>Two Agents at the Same Time</strong>
                    <span>Supports Koupa and Nabdh simultaneously without cross-talk</span>
                  </td>
                  <td className="td-val danger">No session isolation</td>
                  <td className="td-val danger">Shares single active account</td>
                  <td className="td-val success">Isolated agent sessions</td>
                </tr>
                <tr>
                  <td className="td-feature">
                    <strong>Prompt Secret Exposure</strong>
                    <span>Keeps private keys out of LLM prompts</span>
                  </td>
                  <td className="td-val danger">Printed in context</td>
                  <td className="td-val danger">Exposed in shell environment</td>
                  <td className="td-val success">Brokered tools, masked secrets</td>
                </tr>
                <tr>
                  <td className="td-feature">
                    <strong>Fail-Closed Security</strong>
                    <span>Halts when project identity or remote disagrees</span>
                  </td>
                  <td className="td-val danger">No check</td>
                  <td className="td-val danger">Executes against active CLI target</td>
                  <td className="td-val success">Planned: halts closed, never guesses</td>
                </tr>
                <tr>
                  <td className="td-feature">
                    <strong>Secure Local Storage</strong>
                    <span>Encrypted credential storage</span>
                  </td>
                  <td className="td-val danger">Plaintext on disk</td>
                  <td className="td-val danger">Plaintext token files</td>
                  <td className="td-val success">Planned: OS keychain, safe refs in repo</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Waitlist Section
-------------------------------------------------------------------------- */
function WaitlistSection() {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "duplicate" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (status === "sending" || !email) return;
    setStatus("sending");
    setErrorMsg("");
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
        setErrorMsg(data.error ?? "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Could not reach the server. Try again later.");
    }
  }

  return (
    <section className="section-frame waitlist-section" id="waitlist">
      <div className="double-bezel-card waitlist-bezel">
        <div className="bezel-inner waitlist-inner">
          <div className="hero-eyebrow">
            <span className="status-dot green" />
            <span>SCAFFOLD · NOT YET MVP</span>
          </div>
          <h2 className="waitlist-title">Register once. Every agent. Every project, protected.</h2>
          <p className="waitlist-desc">
            One email, stored only for launch news. No newsletter, no sharing.
          </p>

          {status === "success" || status === "duplicate" ? (
            <div className="waitlist-success">
              <Check size={24} weight="fill" className="success-icon" />
              <div>
                <strong>{status === "duplicate" ? "You are already on the list." : "You are on the list."}</strong>
                <p>We will email {email} when the first Linux verification build is ready.</p>
              </div>
            </div>
          ) : (
            <form className="waitlist-form" onSubmit={handleSubmit}>
              <div className="form-row">
                <input
                  type="email"
                  className="form-input"
                  placeholder="developer@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={254}
                  disabled={status === "sending"}
                />
                {/* Honeypot: humans never fill this; bots do. The worker
                    silently accepts (but drops) honeypot submissions. */}
                <input
                  type="text"
                  name="website"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  style={{ position: "absolute", left: "-9999px", opacity: 0, height: 0, width: 0 }}
                />
                <button type="submit" className="primary-button form-submit" disabled={status === "sending" || !email}>
                  <span>{status === "sending" ? "Joining..." : "Notify me"}</span>
                  <span className="btn-icon-tray">
                    <ArrowRight size={13} weight="bold" />
                  </span>
                </button>
              </div>
              {status === "error" && (
                <p className="form-error" role="alert">{errorMsg}</p>
              )}
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Footer
-------------------------------------------------------------------------- */
function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-container">
        <div className="footer-left">
          <div className="footer-brand">
            <BrandMark size={24} />
            <div className="nav-brand-text">
              <span className="nav-brand-name">Nexus</span>
              <span className="nav-brand-sub">Guard</span>
            </div>
          </div>
          <p className="footer-copy">
            A project-aware scaffold for coding-agent service access. Tauri 2, React, TypeScript, Rust. Scaffold, not yet MVP.
          </p>
        </div>

        <div className="footer-links">
          <div className="footer-col">
            <span className="footer-col-head">DOCUMENTATION</span>
            <a href="#problem">Product Brief</a>
            <a href="#architecture">Architecture</a>
            <a href="#evidence">Experiments 001 to 003</a>
          </div>
          <div className="footer-col">
            <span className="footer-col-head">PROJECT</span>
            <a href="https://github.com/saadi/nexus-guard" target="_blank" rel="noopener noreferrer">GitHub Repository</a>
            <a href="#simulator">Guard Simulator</a>
            <a href="#desktop-app">Desktop Interface</a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <span>Nexus Guard scaffold. Keep coding agents in context.</span>
        <span className="footer-status">
          <span className="status-dot green" />
          PROTOTYPE: 15 / 15 CHECKS · FAKE TARGETS ONLY · MCP 34/34 + LIB 12/12 PER VALIDATION-HTTP (HTTP E2E PENDING)
        </span>
      </div>
    </footer>
  );
}

/* --------------------------------------------------------------------------
   Back to top
-------------------------------------------------------------------------- */
function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 1200);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="back-to-top"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <ArrowRight size={15} weight="bold" style={{ transform: "rotate(-90deg)" }} />
    </button>
  );
}

/* --------------------------------------------------------------------------
   Root App
-------------------------------------------------------------------------- */
export default function App() {
  useEffect(() => {
    const els = Array.from(
      document.querySelectorAll(
        ".section-heading-stack, .double-bezel-card, .bento-card, .cargo-test-terminal, .topology-outer-bezel"
      )
    );
    els.forEach((el) => el.classList.add("reveal-target"));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="app-root">
      <Navbar />
      <main className="main-viewport" id="main">
        <HeroSection />
        <ServicesStrip />
        <ProblemSection />
        <ArchitectureSection />
        <SimulatorSection />
        <DesktopSection />
        <HowAgentsConnectSection />
        <EvidenceSection />
        <ComparisonSection />
        <WaitlistSection />
      </main>
      <Footer />
      <BackToTop />
    </div>
  );
}
