/**
 * viewer.js — Markdown Viewer
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads ?file= param, fetches the .md file, renders via marked.js,
 * applies syntax highlighting, builds table of contents, handles theme.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const LS_THEME = "kh:theme";

// ── Theme ──────────────────────────────────────────────────────────────────

function applyTheme() {
  const saved = localStorage.getItem(LS_THEME) || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeIcons(saved);
  updateHljsTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(LS_THEME, next);
  updateThemeIcons(next);
  updateHljsTheme(next);
}

function updateThemeIcons(theme) {
  const sun  = document.getElementById("v-icon-sun");
  const moon = document.getElementById("v-icon-moon");
  if (sun)  sun.style.display  = theme === "dark"  ? "" : "none";
  if (moon) moon.style.display = theme === "light" ? "" : "none";
}

function updateHljsTheme(theme) {
  const dark  = document.getElementById("hljs-dark");
  const light = document.getElementById("hljs-light");
  if (dark && light) {
    dark.disabled  = theme === "light";
    light.disabled = theme === "dark";
  }
}

// ── TOC ────────────────────────────────────────────────────────────────────

function buildTOC(container) {
  const headings = container.querySelectorAll("h1, h2, h3, h4");
  const tocList  = document.getElementById("toc-list");
  if (!tocList) return;

  if (headings.length < 2) {
    document.getElementById("toc-panel")?.classList.add("hidden");
    return;
  }

  tocList.innerHTML = "";

  let counter = 0;
  headings.forEach(h => {
    // Give heading an ID if it doesn't have one
    if (!h.id) {
      h.id = "heading-" + (counter++) + "-" + slugify(h.textContent);
    }

    const level = h.tagName.toLowerCase(); // h1, h2, h3, h4
    const link  = document.createElement("a");
    link.className = `toc-item toc-${level}`;
    link.href = "#" + h.id;
    link.textContent = h.textContent;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      h.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    tocList.appendChild(link);
  });

  // Highlight active TOC item on scroll
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          document.querySelectorAll(".toc-item").forEach(a => a.classList.remove("active"));
          const active = tocList.querySelector(`a[href="#${entry.target.id}"]`);
          if (active) active.classList.add("active");
        }
      });
    },
    { rootMargin: "-10% 0px -80% 0px" }
  );

  headings.forEach(h => observer.observe(h));
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

// ── Code Copy Buttons ──────────────────────────────────────────────────────

function addCodeCopyButtons(container) {
  container.querySelectorAll("pre").forEach(pre => {
    const wrapper = document.createElement("div");
    wrapper.className = "code-wrapper";
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const btn = document.createElement("button");
    btn.className = "code-copy-btn";
    btn.textContent = "Copy";
    btn.addEventListener("click", () => {
      const code = pre.querySelector("code")?.innerText || pre.innerText;
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => btn.textContent = "Copy", 2000);
      });
    });
    wrapper.appendChild(btn);
  });
}

// ── Frontmatter ────────────────────────────────────────────────────────────

function parseFrontmatter(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) return { meta: {}, body: text };

  const raw  = match[1];
  const body = text.slice(match[0].length);
  const meta = {};

  for (const line of raw.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let   val = line.slice(colonIdx + 1).trim();

    // Simple array parsing: "tags: [a, b]" or "tags: a, b"
    const arrMatch = val.match(/^\[(.*)\]$/);
    if (arrMatch) {
      meta[key] = arrMatch[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      meta[key] = val.replace(/^["']|["']$/g, "");
    }
  }

  return { meta, body };
}

function renderFrontmatter(meta) {
  const panel = document.getElementById("frontmatter-meta");
  if (!panel) return;

  const parts = [];
  if (meta.title)   parts.push(`<strong>${escHtml(meta.title)}</strong>`);
  if (meta.date)    parts.push(`<span>${escHtml(meta.date)}</span>`);
  if (meta.author)  parts.push(`<span>by ${escHtml(meta.author)}</span>`);
  if (Array.isArray(meta.tags) && meta.tags.length) {
    parts.push(meta.tags.map(t => `<span class="meta-tag">${escHtml(t)}</span>`).join(""));
  }
  if (Array.isArray(meta.aliases) && meta.aliases.length) {
    parts.push(`<span style="color:var(--text-muted)">Also: ${meta.aliases.map(a => escHtml(a)).join(", ")}</span>`);
  }

  if (parts.length) {
    panel.innerHTML = parts.join('<span style="color:var(--border)">·</span>');
    panel.style.display = "flex";
  }
}

// ── Main Render ────────────────────────────────────────────────────────────

async function renderMarkdown(fileParam) {
  const loading  = document.getElementById("loading");
  const errorEl  = document.getElementById("error-state");
  const mdContent = document.getElementById("md-content");
  const pathEl   = document.getElementById("file-path-display");

  if (pathEl) pathEl.textContent = decodeURIComponent(fileParam);

  try {
    const res = await fetch(decodeURIComponent(fileParam));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const raw = await res.text();

    // Extract frontmatter
    const { meta, body } = parseFrontmatter(raw);
    renderFrontmatter(meta);

    // Set page title
    document.title = (meta.title || fileParam.split("/").pop().replace(".md", "")) + " — Knowledge Hub";

    // Configure marked
    if (window.marked) {
      window.marked.setOptions({
        gfm: true,
        breaks: false,
        pedantic: false,
      });
    }

    if (window.marked && window.markedKatex) {
    window.marked.use(
        window.markedKatex({
        throwOnError: false
        })
    );
    }

    // Parse markdown
    const html = window.marked ? window.marked.parse(body) : `<pre>${escHtml(body)}</pre>`;
    mdContent.innerHTML = html;

    // Syntax highlighting
    if (window.hljs) {
      mdContent.querySelectorAll("pre code").forEach(block => {
        window.hljs.highlightElement(block);
      });
    }

    // Post-processing
    addCodeCopyButtons(mdContent);
    buildTOC(mdContent);

    // Open external links in new tab
    mdContent.querySelectorAll("a[href]").forEach(link => {
      if (link.href.startsWith("http") || link.href.startsWith("//")) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }
    });

    loading.style.display  = "none";
    mdContent.style.display = "";

  } catch (err) {
    loading.style.display  = "none";
    errorEl.style.display  = "";
    errorEl.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px;opacity:0.5">
        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
      <div>Could not load document</div>
      <div style="font-size:0.8rem;margin-top:6px;color:var(--text-secondary)">${escHtml(err.message)}</div>
      <div style="font-size:0.75rem;margin-top:4px">${escHtml(decodeURIComponent(fileParam))}</div>
    `;
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Boot ───────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  applyTheme();

  // Theme toggle button
  document.getElementById("theme-btn")?.addEventListener("click", toggleTheme);

  // TOC toggle
  const tocPanel  = document.getElementById("toc-panel");
  const tocToggle = document.getElementById("toc-toggle");
  tocToggle?.addEventListener("click", () => {
    tocPanel?.classList.toggle("hidden");
  });

  // Read file param from URL: viewer.html?file=path/to/file.md
  const params   = new URLSearchParams(window.location.search);
  const fileParam = params.get("file");

  if (!fileParam) {
    document.getElementById("loading").style.display  = "none";
    document.getElementById("error-state").style.display = "";
    document.getElementById("error-state").textContent = "No file specified. Use viewer.html?file=path/to/file.md";
    return;
  }

  // Validate: only allow .md files
  if (!fileParam.toLowerCase().endsWith(".md")) {
    document.getElementById("loading").style.display  = "none";
    document.getElementById("error-state").style.display = "";
    document.getElementById("error-state").textContent = "This viewer only supports .md files.";
    return;
  }

  renderMarkdown(fileParam);
});