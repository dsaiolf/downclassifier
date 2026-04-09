import { useState, useRef, useCallback, useEffect } from "react";
const d2Logo = "/d2-logo.svg";

// ── API helpers ───────────────────────────────────────────────────────
const API_BASE  = import.meta.env.VITE_API_BASE || "";
const S3_PREFIX = "d2/uploads";

async function maestroPost(payload) {
  console.log("[maestro] method:", payload.method);

  const resp = await fetch(`${API_BASE}/api/maestro`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  console.log("[maestro] status:", resp.status, resp.statusText);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error("[maestro] error body:", err);
    throw new Error(err.message || err.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

async function maestroUpload(file, userName) {
  const s3Key = `${S3_PREFIX}/${userName}/${file.name}`;
  const form  = new FormData();
  form.append("file", file, file.name);
  form.append("key", s3Key);

  console.log("[upload] s3Key   :", s3Key);
  console.log("[upload] filename:", file.name, "| size:", file.size, "bytes");

  const resp = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: form,
  });

  console.log("[upload] status  :", resp.status, resp.statusText);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error("[upload] error body:", err);
    throw new Error(err.message || err.detail || `Upload failed: HTTP ${resp.status}`);
  }
  return s3Key;
}

// ── Constants ─────────────────────────────────────────────────────────

const ITEM_TYPE_META = {
  project:        { label: "Sensitive project",      hint: "Sensitive project(s) to be flagged",                                                  listKey: "projects",        category: "ORGANISATIONAL" },
  attachment:     { label: "Sensitive attachment",   hint: "Sensitive attachment(s) to be flagged",                                               listKey: "attachments",     category: "ORGANISATIONAL" },
  organisation:   { label: "Sensitive organisation", hint: "Info revealing opinions or relationship with this organisation will be flagged",       listKey: "organisations",   category: "POLITICALLY_SENSITIVE" },
  lead_time_item: { label: "Lead-time item",         hint: "Privileged lead time information to be flagged",                                       listKey: "lead_time_items", category: "LEAD_TIME" },
};

const CATEGORY_META = {
  ORGANISATIONAL:        { label: "Organisational",        bg: "#E6F1FB", border: "#378ADD", text: "#0C447C", badge: "#185FA5" },
  POLITICALLY_SENSITIVE: { label: "Politically sensitive", bg: "#EEEAFB", border: "#7B5CBF", text: "#3D2278", badge: "#5B3FA8" },
  LEAD_TIME:             { label: "Lead time",             bg: "#FAEEDA", border: "#BA7517", text: "#633806", badge: "#854F0B" },
};

const TOKEN_RE = /\[([A-Z_]+) \/ (R\d+)\]/g;

// ── Core parsing ──────────────────────────────────────────────────────

function parseRedacted(redactedText) {
  const segments = [];
  let last = 0;
  let m;
  const re = new RegExp(TOKEN_RE.source, "g");
  while ((m = re.exec(redactedText)) !== null) {
    if (m.index > last) segments.push({ type: "text", text: redactedText.slice(last, m.index) });
    segments.push({ type: "token", cat: m[1], ref: m[2], raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < redactedText.length) segments.push({ type: "text", text: redactedText.slice(last) });
  return segments;
}

function buildRefMap(details) {
  return Object.fromEntries(details.filter(d => d.ref_no !== "UNMATCHED").map(d => [d.ref_no, d]));
}

function buildDownloadText(redactedText, refMap, unflaggedRefs) {
  return redactedText.replace(new RegExp(TOKEN_RE.source, "g"), (match, cat, ref) => {
    if (unflaggedRefs.has(ref)) return refMap[ref]?.original_phrase ?? match;
    return match;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────

let _uid = 0;
const uid = () => `item_${++_uid}`;

function registryToItems(reg) {
  const items = [];
  for (const [type, listKey] of [
    ["project",        "projects"],
    ["attachment",     "attachments"],
    ["organisation",   "organisations"],
    ["lead_time_item", "lead_time_items"],
  ]) {
    for (const value of (reg[listKey] || [])) {
      items.push({ id: uid(), value, source: "registry", type });
    }
  }
  return items;
}

function buildCriteriaPayload(items) {
  const out = { projects: [], attachments: [], organisations: [], lead_time_items: [], custom_rules: [] };
  for (const item of items.filter(i => !i.disabled)) {
    if (item.kind === "rule") {
      out.custom_rules.push({ category: item.category, description: item.description });
    } else {
      out[ITEM_TYPE_META[item.type].listKey].push(item.value);
    }
  }
  return out;
}

// ── Shared UI ─────────────────────────────────────────────────────────

function Badge({ category }) {
  const m = CATEGORY_META[category] || CATEGORY_META.ORGANISATIONAL;
  return (
    <span style={{
      background: m.bg, color: m.badge, border: `0.5px solid ${m.border}`,
      borderRadius: 4, fontSize: 11, padding: "2px 7px", fontWeight: 500, whiteSpace: "nowrap",
    }}>
      {m.label}
    </span>
  );
}

function Step({ n, label, active, done, onClick }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 8, cursor: onClick ? "pointer" : "default" }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 500,
        background: done ? "#1D9E75" : active ? "var(--color-primary)" : "var(--color-background-secondary)",
        color: done || active ? "#fff" : "var(--color-text-tertiary)",
        border: active || done ? "none" : "0.5px solid var(--color-border-secondary)",
        flexShrink: 0,
      }}>
        {done ? "✓" : n}
      </div>
      <span style={{
        fontSize: 13,
        color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        fontWeight: active ? 500 : 400,
        textDecoration: onClick ? "underline" : "none",
      }}>
        {label}
      </span>
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 13, height: 13,
      border: "2px solid rgba(14,116,144,0.2)", borderTopColor: "var(--color-primary)",
      borderRadius: "50%", animation: "spin 0.8s linear infinite",
    }} />
  );
}

// ── Page: Login ───────────────────────────────────────────────────────

function LoginPage({ onNext }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const go = async () => {
    if (!username.trim() || !password) return;
    setError("");
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: username.trim(), password }),
      });
      const data = await resp.json();
      if (!resp.ok) { setError(data.error || "Login failed"); return; }
      onNext({ username: data.user.username });
    } catch {
      setError("Could not reach server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Left pane — brand */}
      <div style={{
        width: "50%", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 20,
        background: "linear-gradient(155deg, #66B8C6 0%, #72C3D0 50%, #66B8C6 100%)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: "fit-content" }}>
          <img src={d2Logo} alt="D2 logo" style={{ height: 140, width: "auto", display: "block" }} />
          <div style={{ fontSize: 16, color: "#0A5566", letterSpacing: 0.4, textAlign: "center", width: "100%" }}>
            Document Down-Classification Buddy
          </div>
        </div>
      </div>

      {/* Right pane — form */}
      <div style={{
        width: "50%", display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--color-background-primary)", padding: "2rem",
      }}>
        <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>Welcome</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Please login using your credentials</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Enter your username" style={{ width: "100%" }}
                onKeyDown={e => e.key === "Enter" && go()} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password" style={{ width: "100%" }}
                onKeyDown={e => e.key === "Enter" && go()} />
            </div>
            {error && <div style={{ fontSize: 12, color: "var(--color-text-danger)" }}>{error}</div>}
            <button onClick={go} disabled={loading} style={{
              marginTop: 4, background: "var(--color-primary)", color: "#fff", border: "none",
              borderRadius: 8, padding: "11px 0", fontWeight: 500, fontSize: 14,
              cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
            }}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page: Disclaimer ──────────────────────────────────────────────────

function DisclaimerPage({ onNext }) {
  const [accepted, setAccepted] = useState(false);

  const cards = [
    {
      icon: "⚠",
      iconColor: "#185FA5", iconBg: "#E6F1FB",
      border: "#378ADD",
      title: "1. Advisory only",
      body: "This assistant provides recommendations based on its built-in reasoning and the context provided. It may not fully address specialised or time-sensitive contexts, or nuanced policy implications that require expert knowledge.",
    },
    {
      icon: "✓",
      iconColor: "#5B3FA8", iconBg: "#EEEAFB",
      border: "#7B5CBF",
      title: "2. Human review required",
      body: "You must review all content and recommendations before making any classification changes. You remain fully responsible for all classification decisions.",
    },
    {
      icon: "📖",
      iconColor: "#854F0B", iconBg: "#FAEEDA",
      border: "#BA7517",
      title: "3. Refer to official guidance",
      body: "For guidance, refer to GOM xxx and your team's classification guidelines. When in doubt, consult your security officer.",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: "2rem 0" }}>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: "var(--color-text-primary)" }}>Disclaimer</div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 6 }}>
          Please read and acknowledge the following before proceeding
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 760, display: "flex", flexDirection: "column", gap: 16 }}>
        {cards.map(({ icon, iconColor, iconBg, border, title, body }) => (
          <div key={title} style={{
            display: "flex", alignItems: "flex-start", gap: 16,
            padding: "20px 24px", borderRadius: 12,
            border: `1px solid ${border}`, background: "var(--color-background-primary)",
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
              background: iconBg, color: iconColor,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, fontWeight: 700,
            }}>{icon}</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>{title}</div>
              <div style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.65 }}>{body}</div>
            </div>
          </div>
        ))}

        <div style={{
          display: "flex", alignItems: "flex-start", gap: 12,
          padding: "18px 24px", borderRadius: 12,
          border: "0.5px solid var(--color-border-tertiary)",
          background: "var(--color-background-secondary)",
        }}>
          <input type="checkbox" id="accept" checked={accepted} onChange={e => setAccepted(e.target.checked)}
            style={{ marginTop: 3, cursor: "pointer", width: 16, height: 16, flexShrink: 0 }} />
          <label htmlFor="accept" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", cursor: "pointer", lineHeight: 1.6 }}>
            I have read and understood the above. I understand this tool provides suggestions only. All classification decisions are my own responsibility.
          </label>
        </div>
      </div>

      <button onClick={onNext} disabled={!accepted} style={{
        background: accepted ? "var(--color-primary)" : "var(--color-background-secondary)",
        color: accepted ? "#fff" : "var(--color-text-tertiary)",
        border: "none", borderRadius: 8, padding: "11px 40px",
        fontWeight: 500, fontSize: 14, marginTop: 4,
        cursor: accepted ? "pointer" : "default", transition: "all 0.15s",
      }}>
        Accept and continue
      </button>
    </div>
  );
}

// ── Page: Criteria + Upload ───────────────────────────────────────────

function CriteriaPage({ session, onResults }) {
  const [items, setItems] = useState([]);
  const [registryLoaded, setRegistryLoaded] = useState(false);
  const [registryError, setRegistryError] = useState("");
  const [addInputs, setAddInputs] = useState({});

  const [pdfFile, setPdfFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [runError, setRunError] = useState("");
  const fileRef = useRef();

  // ── Load registry from Maestro on mount ──────────────────────────
  useEffect(() => {
    maestroPost({ method: "registry" })
      .then(data => {
        const named = data.named_items || {};
        const rules = data.criteria_rules || {};

        const namedItems = registryToItems(named).map(i => ({ ...i, kind: "item" }));

        const ruleItems = [];
        for (const [category, ruleList] of Object.entries(rules)) {
          for (const description of (ruleList || [])) {
            ruleItems.push({ id: uid(), kind: "rule", category, description, source: "registry" });
          }
        }

        setItems([...namedItems, ...ruleItems]);
        setRegistryLoaded(true);
      })
      .catch(err => {
        setRegistryError(`Could not load pre-configured criteria (${err.message}) — add items manually.`);
        setRegistryLoaded(true);
      });
  }, []);

  const getInput = key => addInputs[key] || "";
  const setInput = (key, val) => setAddInputs(prev => ({ ...prev, [key]: val }));

  const addNamedItem = (type) => {
    const v = getInput(type).trim();
    if (!v || items.some(i => i.kind === "item" && i.value === v && i.type === type)) return;
    setItems(prev => [...prev, { id: uid(), kind: "item", type, value: v, source: "session" }]);
    setInput(type, "");
  };

  const addRule = (cat) => {
    const desc = getInput(`rule_${cat}`).trim();
    if (!desc) return;
    setItems(prev => [...prev, { id: uid(), kind: "rule", category: cat, description: desc, source: "session" }]);
    setInput(`rule_${cat}`, "");
  };

  const removeItem   = (id) => setItems(prev => prev.filter(i => i.id !== id));
  const toggleItem   = (id) => setItems(prev => prev.map(i => i.id === id ? { ...i, disabled: !i.disabled } : i));

  const grouped = {};
  for (const item of items) {
    const cat = item.kind === "item" ? ITEM_TYPE_META[item.type].category : item.category;
    (grouped[cat] = grouped[cat] || []).push(item);
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type === "application/pdf") setPdfFile(file);
  }, []);

  const handleRun = async () => {
    if (!pdfFile) { setRunError("Please upload a PDF file."); return; }
    setRunError(""); setLoading(true);
    try {
      setProgress("Uploading document to S3…");
      const s3Key = await maestroUpload(pdfFile, session.name);
      setProgress("Running pipeline…");
      const data = await maestroPost({
        method:   "analyse",
        s3_key:   s3Key,
        session:  { user_name: session.name, division: session.division },
        criteria: buildCriteriaPayload(items),
      });
      if (data.error) throw new Error(data.error);
      onResults(data);
    } catch (err) {
      setRunError(`Error: ${err.message}`);
    } finally {
      setLoading(false); setProgress("");
    }
  };

  // ── Item chip (named values — short, horizontal) ─────────────────
  // solid border = pre-configured; dashed border = session-added
  const itemChip = (item, m) => {
    const isRegistry = item.source === "registry";
    const isDisabled = !!item.disabled;
    const chipStyle = isRegistry
      ? isDisabled
        ? { background: "#f0f0f0", border: "1px solid #d0d0d0", color: "#a0a0a0" }
        : { background: m.bg, border: `1px solid ${m.border}`, color: m.text }
      : { background: "#fff", border: `1px solid ${m.border}`, color: m.text };
    return (
      <span key={item.id} style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "4px 6px 4px 11px", borderRadius: 999,
        fontSize: 13, fontWeight: 500, maxWidth: 220,
        opacity: isDisabled ? 0.6 : 1, ...chipStyle,
      }}>
        <span style={{
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textDecoration: isDisabled ? "line-through" : "none",
        }}>{item.value}</span>
        <button
          onClick={() => isRegistry ? toggleItem(item.id) : removeItem(item.id)}
          title={isRegistry ? (isDisabled ? "Click to re-enable" : "Click to disable") : "Remove"}
          style={{ background: "none", border: "none", padding: "0 2px", lineHeight: 1, fontSize: 15,
            cursor: "pointer", flexShrink: 0,
            color: isRegistry
              ? (isDisabled ? "#0E7490" : "#a0a0a0")
              : "var(--color-text-secondary)",
            opacity: 0.7,
          }}>
          {isRegistry && isDisabled ? "↩" : "×"}
        </button>
      </span>
    );
  };

  // ── Rule row (full-width stacked — long text, needs full visibility) ─
  // solid left-border accent = pre-configured; dashed outline = session-added
  const ruleRow = (item, m) => {
    const isRegistry = item.source === "registry";
    const isDisabled = !!item.disabled;
    return (
      <div key={item.id} style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 12px",
        borderRadius: 6,
        ...(isRegistry
          ? {
              borderLeft: `3px solid ${isDisabled ? "#d0d0d0" : m.border}`,
              background: isDisabled ? "#f5f5f5" : m.bg,
            }
          : {
              border: `1px solid ${m.border}`,
              background: "#fff",
            }
        ),
      }}>
        <span style={{
          flex: 1, fontSize: 13, lineHeight: 1.6, fontStyle: "italic",
          color: isDisabled ? "#a0a0a0" : "var(--color-text-primary)",
          textDecoration: isDisabled ? "line-through" : "none",
        }}>
          &ldquo;{item.description}&rdquo;
        </span>
        <button
          onClick={() => isRegistry ? toggleItem(item.id) : removeItem(item.id)}
          title={isRegistry ? (isDisabled ? "Re-enable" : "Disable") : "Remove"}
          style={{
            flexShrink: 0, background: "none", border: "none", padding: "0 4px",
            lineHeight: 1, fontSize: 20, cursor: "pointer",
            color: isRegistry
              ? (isDisabled ? "var(--color-primary)" : "#b0b0b0")
              : "#b0b0b0",
          }}>
          {isRegistry && isDisabled ? "↩" : "×"}
        </button>
      </div>
    );
  };

  const addItemRow = (type) => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
      <input value={getInput(type)} onChange={e => setInput(type, e.target.value)}
        placeholder="Input custom item"
        style={{ flex: 1 }}
        onKeyDown={e => e.key === "Enter" && addNamedItem(type)} />
      <button onClick={() => addNamedItem(type)} style={{
        height: 42, padding: "0 16px", background: "var(--color-primary)", color: "#fff",
        border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, flexShrink: 0,
      }}>+ Add item</button>
    </div>
  );

  const addRuleRow = (cat) => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
      <input value={getInput(`rule_${cat}`)} onChange={e => setInput(`rule_${cat}`, e.target.value)}
        placeholder="Input custom prompt sentence"
        style={{ flex: 1 }}
        onKeyDown={e => e.key === "Enter" && addRule(cat)} />
      <button onClick={() => addRule(cat)} style={{
        height: 42, padding: "0 16px", background: "var(--color-primary)", color: "#fff",
        border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, flexShrink: 0,
      }}>+ Add sentence</button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Detection criteria</div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            Standardised rules are pre-loaded and can be customised. Add items and rules per category below.
          </div>
        </div>
        {/* Legend */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <span style={{ padding: "3px 10px", borderRadius: 999, background: "#E6F1FB", border: "1px solid #378ADD", color: "#185FA5", fontSize: 11 }}>
            Pre-configured
          </span>
          <span style={{ padding: "3px 10px", borderRadius: 999, background: "#f0f0f0", border: "1px solid #d0d0d0", color: "#a0a0a0", fontSize: 11, textDecoration: "line-through" }}>
            Pre-configured Disabled
          </span>
          <span style={{ padding: "3px 10px", borderRadius: 999, background: "#fff", border: "1px solid #378ADD", color: "#185FA5", fontSize: 11 }}>
            Added this session
          </span>
        </div>
      </div>

      {registryError && (
        <div style={{ background: "#FFFBEA", border: "0.5px solid #D97706", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#92400E" }}>
          {registryError}
        </div>
      )}

      {["ORGANISATIONAL", "POLITICALLY_SENSITIVE", "LEAD_TIME"].map(cat => {
        const m = CATEGORY_META[cat];
        const catItems = (grouped[cat] || []);
        const namedItems = catItems.filter(i => i.kind === "item");
        const ruleItems  = catItems.filter(i => i.kind === "rule");
        const typesInCat = Object.entries(ITEM_TYPE_META).filter(([, v]) => v.category === cat);
        const totalCount = catItems.length;

        return (
          <div key={cat} style={{ border: `0.5px solid ${m.border}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Category header */}
            <div style={{ background: m.bg, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
              <Badge category={cat} />
              <span style={{ fontSize: 12, color: m.text }}>
                {totalCount === 0 ? "No criteria added" : `${totalCount} criteri${totalCount !== 1 ? "a" : "on"} active`}
              </span>
            </div>

            <div style={{ background: "var(--color-background-primary)" }}>
              {/* Named item type sub-sections */}
              {typesInCat.map(([type, typeMeta]) => {
                const typeItems = namedItems.filter(i => i.type === type);
                return (
                  <div key={type} style={{ borderTop: "0.5px solid var(--color-border-tertiary)", padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                      {typeMeta.label}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontStyle: "italic", marginBottom: 8 }}>
                      {typeMeta.hint}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {typeItems.length === 0
                        ? <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>None added</span>
                        : typeItems.map(item => itemChip(item, m))
                      }
                    </div>
                    {addItemRow(type)}
                  </div>
                );
              })}

              {/* Rules sub-section */}
              <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", padding: "10px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                  Rules
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontStyle: "italic", marginBottom: 8 }}>
                  Prompt instructions for what to flag in this category
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {ruleItems.length === 0
                    ? <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>None added</span>
                    : ruleItems.map(item => ruleRow(item, m))
                  }
                </div>
                {addRuleRow(cat)}
              </div>
            </div>
          </div>
        );
      })}

      {/* Document upload */}
      <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Document</div>
        <div onDrop={handleDrop} onDragOver={e => e.preventDefault()} onClick={() => fileRef.current.click()}
          style={{
            border: `1.5px dashed ${pdfFile ? "#1D9E75" : "var(--color-border-secondary)"}`,
            borderRadius: 8, padding: "20px 14px", textAlign: "center", cursor: "pointer",
            background: pdfFile ? "#F0FBF6" : "var(--color-background-secondary)", transition: "all 0.15s",
          }}>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => setPdfFile(e.target.files[0] || null)} />
          {pdfFile ? (
            <>
              <div style={{ fontSize: 13, color: "#1D9E75", fontWeight: 500 }}>✓ {pdfFile.name}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{(pdfFile.size / 1024).toFixed(0)} KB — click to replace</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Drop PDF here or click to browse</div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>Classified documents only</div>
            </>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ background: "#EEF2FF", border: "0.5px solid #C7D2FE", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#3730A3", display: "flex", alignItems: "center", gap: 10 }}>
          <Spinner />{progress || "Working…"}
        </div>
      )}

      {runError && (
        <div style={{ background: "#FEF2F2", border: "0.5px solid #F87171", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#B91C1C" }}>
          {runError}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 8, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
        <button onClick={handleRun} disabled={loading || !pdfFile || !registryLoaded} style={{
          background: loading || !pdfFile ? "var(--color-background-secondary)" : "var(--color-primary)",
          color: loading || !pdfFile ? "var(--color-text-tertiary)" : "#fff",
          border: "none", borderRadius: 8, padding: "10px 28px",
          fontWeight: 500, fontSize: 14, cursor: loading || !pdfFile ? "default" : "pointer",
          display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s",
        }}>
          {loading ? <><Spinner />{progress || "Running…"}</> : "Run analysis →"}
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Results: Original panel ───────────────────────────────────────────

function OriginalPanel({ segments, refMap, unflaggedRefs, segRefs, hoveredRef, setHoveredRef, onClickRef }) {
  return (
    <pre style={{ fontSize: 12, lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.text}</span>;
        const d = refMap[seg.ref];
        if (!d) return null;
        const cm = CATEGORY_META[d.category] || CATEGORY_META.ORGANISATIONAL;
        const isHovered = hoveredRef === seg.ref;
        const isUnflagged = unflaggedRefs.has(seg.ref);
        return (
          <span key={seg.ref}
            ref={el => { if (segRefs) segRefs.current[seg.ref] = el; }}
            onMouseEnter={() => setHoveredRef(seg.ref)}
            onMouseLeave={() => setHoveredRef(null)}
            onClick={() => onClickRef(seg.ref)}
            style={{
              background: isUnflagged
                ? (isHovered ? cm.bg : "transparent")
                : (isHovered ? cm.border : cm.bg),
              color: isHovered && !isUnflagged ? "#fff" : cm.text,
              border: `0.5px solid ${isUnflagged ? "#aaa" : cm.border}`,
              borderRadius: 3, cursor: "pointer", transition: "all 0.12s",
            }}>
            {d.original_phrase}
          </span>
        );
      })}
    </pre>
  );
}

// ── Results: Redacted panel ───────────────────────────────────────────

function RedactedPanel({ segments, refMap, unflaggedRefs, segRefs, hoveredRef, setHoveredRef, onClickRef }) {
  return (
    <pre style={{ fontSize: 12, lineHeight: 1.9, margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.text}</span>;
        const d = refMap[seg.ref];
        const cm = CATEGORY_META[seg.cat] || CATEGORY_META.ORGANISATIONAL;
        const isHovered = hoveredRef === seg.ref;
        const isFlagged = !unflaggedRefs.has(seg.ref);

        if (isFlagged) {
          return (
            <span key={seg.ref}
              ref={el => { if (segRefs) segRefs.current[seg.ref] = el; }}
              onMouseEnter={() => setHoveredRef(seg.ref)}
              onMouseLeave={() => setHoveredRef(null)}
              onClick={() => onClickRef?.(seg.ref)}
              style={{
                background: isHovered ? cm.border : cm.bg,
                color: isHovered ? "#fff" : cm.badge,
                border: `0.5px solid ${cm.border}`,
                borderRadius: 4, padding: "1px 6px", fontSize: 12, fontWeight: 500,
                cursor: "pointer", transition: "all 0.12s", whiteSpace: "nowrap",
              }}>
              [{cm.label} / {seg.ref}]
            </span>
          );
        } else {
          return (
            <span key={seg.ref}
              ref={el => { if (segRefs) segRefs.current[seg.ref] = el; }}
              onMouseEnter={() => setHoveredRef(seg.ref)}
              onMouseLeave={() => setHoveredRef(null)}
              onClick={() => onClickRef?.(seg.ref)}
              style={{
                background: isHovered ? cm.bg : "transparent",
                color: cm.text,
                border: "0.5px solid #aaa",
                borderRadius: 3, cursor: "pointer", transition: "all 0.12s",
              }}>
              {d?.original_phrase ?? seg.raw}
            </span>
          );
        }
      })}
    </pre>
  );
}

// ── Page: Results ─────────────────────────────────────────────────────

function ResultsPage({ pipelineResult }) {
  const { redacted_text, details } = pipelineResult;

  const segments = parseRedacted(redacted_text);
  const refMap = buildRefMap(details);
  const matchedDetails   = details.filter(d => d.ref_no !== "UNMATCHED");
  const unmatchedDetails = details.filter(d => d.ref_no === "UNMATCHED");

  const [hoveredRef, setHoveredRef] = useState(null);
  const [unflaggedRefs, setUnflaggedRefs] = useState(new Set());
  const [collapsed, setCollapsed] = useState({ original: false, suggested: false, details: false, unflagged: true });
  const [downloaded, setDownloaded] = useState(false);

  const detailRefs      = useRef({});
  const unflagDetailRefs = useRef({});
  const origSegRefs     = useRef({});
  const redactSegRefs   = useRef({});

  const flaggedDetails   = matchedDetails.filter(d => !unflaggedRefs.has(d.ref_no));
  const unflaggedDetails = matchedDetails.filter(d =>  unflaggedRefs.has(d.ref_no));

  const toggle = key => setCollapsed(p => ({ ...p, [key]: !p[key] }));

  const unflag = (ref) => { setUnflaggedRefs(p => new Set([...p, ref])); setCollapsed(p => ({ ...p, unflagged: false })); };
  const reflag = (ref) => {
    setUnflaggedRefs(p => { const n = new Set(p); n.delete(ref); return n; });
    setCollapsed(p => ({ ...p, details: false }));
    setTimeout(() => {
      redactSegRefs.current[ref]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      detailRefs.current[ref]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  };
  const unflagByTopic = (topic) => {
    const refs = matchedDetails.filter(d => (d.topic || []).includes(topic)).map(d => d.ref_no);
    setUnflaggedRefs(p => new Set([...p, ...refs]));
    setCollapsed(p => ({ ...p, unflagged: false }));
  };

  const scrollAllTo = (ref, skip = null) => {
    if (skip !== "original") origSegRefs.current[ref]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (skip !== "suggested") redactSegRefs.current[ref]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (skip !== "detail") {
      const el = unflaggedRefs.has(ref) ? unflagDetailRefs.current[ref] : detailRefs.current[ref];
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  const handleDownload = () => {
    const text = buildDownloadText(redacted_text, refMap, unflaggedRefs);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "redacted_document.txt"; a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 3000);
  };

  const panelStyle = (key) => ({
    flex: collapsed[key] ? "0 0 32px" : 1,
    minWidth: collapsed[key] ? 32 : 0,
    transition: "flex 0.2s",
    border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10,
    overflow: "hidden", display: "flex", flexDirection: "column",
    background: "var(--color-background-primary)",
  });

  const panelHeader = (key, label, count) => (
    <div onClick={() => toggle(key)} style={{
      padding: "8px 12px", background: "var(--color-background-secondary)",
      borderBottom: collapsed[key] ? "none" : "0.5px solid var(--color-border-tertiary)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      cursor: "pointer", writingMode: collapsed[key] ? "vertical-rl" : "horizontal-tb", whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>
        {label}
        {count != null && <span style={{ fontWeight: 400, color: "var(--color-text-tertiary)", marginLeft: collapsed[key] ? 0 : 6 }}>({count})</span>}
      </span>
      <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: collapsed[key] ? 0 : 8 }}>
        {collapsed[key] ? "▶" : "◀"}
      </span>
    </div>
  );

  const smallBtn = (color) => ({ fontSize: 11, color, background: "none", border: `0.5px solid ${color}`, borderRadius: 4, cursor: "pointer", padding: "2px 8px" });

  const detailCard = (d, isUnflagged) => {
    const cm = CATEGORY_META[d.category] || CATEGORY_META.ORGANISATIONAL;
    const isHovered = hoveredRef === d.ref_no;
    const topics = d.topic || [];
    const refStore = isUnflagged ? unflagDetailRefs : detailRefs;
    return (
      <div key={d.ref_no}
        ref={el => refStore.current[d.ref_no] = el}
        onMouseEnter={() => setHoveredRef(d.ref_no)}
        onMouseLeave={() => setHoveredRef(null)}
        onClick={() => scrollAllTo(d.ref_no, "detail")}
        style={{
          padding: "12px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)",
          background: isHovered ? cm.bg : "var(--color-background-primary)",
          transition: "background 0.12s", cursor: "pointer",
        }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: topics.length ? 6 : 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: cm.badge }}>{d.ref_no}</span>
            <Badge category={d.category} />
            {d.source === "completeness" && (
              <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 3, padding: "1px 5px" }}>
                completeness
              </span>
            )}
          </div>
          {isUnflagged
            ? <button onClick={e => { e.stopPropagation(); reflag(d.ref_no); }} style={smallBtn("var(--color-primary)")}>Reflag</button>
            : <button onClick={e => { e.stopPropagation(); unflag(d.ref_no); }} style={smallBtn("#C0392B")}>Unflag</button>}
        </div>

        {topics.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
            {topics.map(t => (
              <div key={t} style={{ fontSize: 11, background: cm.bg, color: cm.text, border: `0.5px solid ${cm.border}`, borderRadius: 10, display: "flex", alignItems: "center", overflow: "hidden" }}>
                <span style={{ padding: "2px 8px" }}>{t}</span>
                {!isUnflagged && <>
                  <span style={{ width: "0.5px", alignSelf: "stretch", background: cm.border }} />
                  <button onClick={e => { e.stopPropagation(); unflagByTopic(t); }}
                    style={{ fontSize: 11, color: "#C0392B", background: "none", border: "none", cursor: "pointer", padding: "2px 8px" }}>
                    Unflag all
                  </button>
                </>}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "4px 8px", fontSize: 12 }}>
          <span style={{ color: "var(--color-text-secondary)" }}>Phrase</span>
          <span style={{ fontStyle: "italic", lineHeight: 1.5 }}>&ldquo;{d.original_phrase}&rdquo;</span>
          <span style={{ color: "var(--color-text-secondary)", marginTop: 4 }}>Criterion</span>
          <span style={{ lineHeight: 1.5, marginTop: 4 }}>{d.damage_criterion}</span>
          <span style={{ color: "var(--color-text-secondary)", marginTop: 4 }}>Rationale</span>
          <span style={{ color: "var(--color-text-secondary)", lineHeight: 1.5, marginTop: 4 }}>{d.rationale}</span>
        </div>
      </div>
    );
  };

  const unmatchedCard = (d) => (
    <div key={`${d.original_phrase}-unmatched`} style={{
      padding: "12px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)",
      background: "#FFFBEA",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "#92400E", background: "#FEF3C7", border: "0.5px solid #D97706", borderRadius: 4, padding: "2px 7px", fontWeight: 500 }}>
          UNMATCHED
        </span>
        <Badge category={d.category} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "4px 8px", fontSize: 12 }}>
        <span style={{ color: "var(--color-text-secondary)" }}>Phrase</span>
        <span style={{ fontStyle: "italic", lineHeight: 1.5 }}>&ldquo;{d.original_phrase}&rdquo;</span>
        <span style={{ color: "var(--color-text-secondary)", marginTop: 4 }}>Note</span>
        <span style={{ color: "#92400E", lineHeight: 1.5, marginTop: 4 }}>
          Could not locate this phrase in the document text. Manual review recommended.
        </span>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Analysis results</div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            {flaggedDetails.length} flagged
            {unflaggedRefs.size > 0 && ` · ${unflaggedRefs.size} unflagged`}
            {unmatchedDetails.length > 0 && ` · ${unmatchedDetails.length} unmatched`}
            {" · Review and confirm before downloading"}
          </div>
        </div>
        <button onClick={handleDownload} style={{
          background: "var(--color-primary)", color: "#fff", border: "none", borderRadius: 8,
          padding: "8px 18px", fontSize: 13, fontWeight: 500, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          ↓ Download redacted
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, height: 560 }}>
        <div style={panelStyle("original")}>
          {panelHeader("original", "Original")}
          {!collapsed.original && (
            <div style={{ overflow: "auto", padding: "12px 14px", flex: 1 }}>
              <OriginalPanel segments={segments} refMap={refMap} unflaggedRefs={unflaggedRefs}
                segRefs={origSegRefs} hoveredRef={hoveredRef} setHoveredRef={setHoveredRef}
                onClickRef={ref => scrollAllTo(ref, "original")} />
            </div>
          )}
        </div>

        <div style={panelStyle("suggested")}>
          {panelHeader("suggested", "Suggested redacted")}
          {!collapsed.suggested && (
            <div style={{ overflow: "auto", padding: "12px 14px", flex: 1 }}>
              <RedactedPanel segments={segments} refMap={refMap} unflaggedRefs={unflaggedRefs}
                segRefs={redactSegRefs} hoveredRef={hoveredRef} setHoveredRef={setHoveredRef}
                onClickRef={ref => scrollAllTo(ref, "suggested")} />
            </div>
          )}
        </div>

        <div style={panelStyle("details")}>
          {panelHeader("details", "Flagged", flaggedDetails.length + (unmatchedDetails.length ? ` + ${unmatchedDetails.length} unmatched` : ""))}
          {!collapsed.details && (
            <div style={{ overflow: "auto", flex: 1 }}>
              {flaggedDetails.length === 0 && unmatchedDetails.length === 0
                ? <div style={{ padding: "24px 14px", fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "center" }}>No flagged items</div>
                : <>
                    {flaggedDetails.map(d => detailCard(d, false))}
                    {unmatchedDetails.map(d => unmatchedCard(d))}
                  </>}
            </div>
          )}
        </div>

        <div style={panelStyle("unflagged")}>
          {panelHeader("unflagged", "Unflagged", unflaggedDetails.length)}
          {!collapsed.unflagged && (
            <div style={{ overflow: "auto", flex: 1 }}>
              {unflaggedDetails.length === 0
                ? <div style={{ padding: "24px 14px", fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "center" }}>No unflagged items</div>
                : unflaggedDetails.map(d => detailCard(d, true))}
            </div>
          )}
        </div>
      </div>

      {downloaded && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, background: "#1D9E75", color: "#fff",
          borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 500,
          boxShadow: "0 2px 12px rgba(0,0,0,0.15)", zIndex: 999,
        }}>
          ✓ Redacted document downloaded
        </div>
      )}
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────

const STEPS = ["Sign in", "Disclaimer", "Curate Criteria & Upload Report", "Results"];

export default function App() {
  const [page, setPage] = useState(0);
  const [session, setSession] = useState(null);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount: rehydrate session from cookie, restore last page + results
  useEffect(() => {
    fetch(`${API_BASE}/api/auth/me`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.user) {
          setSession(data.user);
          const savedPage = parseInt(sessionStorage.getItem("d2_page") || "1", 10);
          const savedResult = sessionStorage.getItem("d2_result");
          if (savedResult) {
            try { setPipelineResult(JSON.parse(savedResult)); } catch { /* ignore */ }
          }
          setPage(savedPage);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const goToPage = (p) => { setPage(p); sessionStorage.setItem("d2_page", p); };

  if (loading) return null;

  if (page === 0) {
    return <LoginPage onNext={info => { setSession(info); goToPage(1); }} />;
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, paddingBottom: 16, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
          <img src={d2Logo} alt="D2 logo" style={{ height: 36, width: "auto" }} />
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Document Down-Classification Buddy</span>
        </div>
        {session && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {session.name}{session.division ? ` · ${session.division}` : ""}
            </span>
            <button onClick={async () => {
              await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
              setSession(null); setPipelineResult(null); sessionStorage.clear(); goToPage(0);
            }} style={{
              fontSize: 12, color: "var(--color-text-secondary)", background: "none",
              border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", cursor: "pointer",
            }}>Sign out</button>
          </div>
        )}
      </div>

      {page <= 3 && (
        <div style={{ display: "flex", gap: 20, marginBottom: 28, alignItems: "center" }}>
          {STEPS.slice(1).map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {i > 0 && <div style={{ width: 24, height: 0.5, background: "var(--color-border-secondary)" }} />}
              <Step n={i + 1} label={s} active={page === i + 1} done={page > i + 1}
                onClick={page === 3 && page > i + 1 ? () => goToPage(i + 1) : undefined} />
            </div>
          ))}
        </div>
      )}

      {page === 1 && <DisclaimerPage onNext={() => goToPage(2)} />}
      {page === 2 && <CriteriaPage session={session} onResults={data => {
        setPipelineResult(data);
        sessionStorage.setItem("d2_result", JSON.stringify(data));
        goToPage(3);
      }} />}
      {page === 3 && pipelineResult && <ResultsPage pipelineResult={pipelineResult} />}
    </div>
  );
}