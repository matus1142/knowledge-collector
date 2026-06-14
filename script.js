/**
 * script.js — Knowledge Hub
 * ─────────────────────────────────────────────────────────────────────────────
 * All UI logic: folder tree, full-text search (Fuse.js), favorites, recents,
 * keyboard navigation, theme toggle, breadcrumbs, filters, localStorage.
 *
 * No framework. No build step. Pure vanilla JS.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS & STATE
═══════════════════════════════════════════════════════════════════════════ */

const LS_THEME        = "kh:theme";
const LS_EXPANDED     = "kh:expanded";
const LS_FAVORITES    = "kh:favorites";
const LS_RECENTS      = "kh:recents";
const LS_SECTIONS     = "kh:sections";
const LS_RECENT_SRCH  = "kh:recent-searches";

const MAX_RECENTS         = 15;
const MAX_RECENT_SEARCHES = 8;
const SEARCH_DEBOUNCE_MS  = 120;

/** Application state */
const state = {
  manifest: null,          // full manifest.json
  searchIndex: null,       // search_index.json array
  fuse: null,              // Fuse.js instance
  expandedFolders: new Set(),
  favorites: [],           // array of { name, path, type }
  recents: [],             // array of { name, path, type }
  recentSearches: [],      // array of strings
  activeFilters: new Set(),// active file-type filters
  searchTypeFilter: "all", // "all"|"html"|"markdown"|"pdf"
  focusedResultIdx: -1,    // keyboard nav in search results
  currentPath: "",         // current breadcrumb path
  searchDebounceTimer: null,
  collapsedSections: new Set(),
};

/* ═══════════════════════════════════════════════════════════════════════════
   DOM ELEMENTS
═══════════════════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const el = {
  content:          $("content"),
  breadcrumbs:      $("breadcrumbs"),
  statTotal:        $("stat-total"),
  statFolders:      $("stat-folders"),
  statHtml:         $("stat-html"),
  statMd:           $("stat-md"),
  statPdf:          $("stat-pdf"),
  filterBar:        $("filter-bar"),
  searchInput:      $("search-input"),
  searchOverlay:    $("search-overlay"),
  searchModal:      $("search-modal"),
  searchModalInput: $("search-modal-input"),
  searchResults:    $("search-results"),
  searchClose:      $("search-close"),
  themeToggle:      $("theme-toggle"),
  iconSun:          $("icon-sun"),
  iconMoon:         $("icon-moon"),
  favoritesList:    $("favorites-list"),
  recentsList:      $("recents-list"),
  sidebarToggle:    $("sidebar-toggle"),
  sidebar:          $("sidebar"),
  sidebarOverlay:   $("sidebar-overlay"),
  toast:            $("toast"),
};

/* ═══════════════════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════════════════ */

async function init() {
  loadLocalStorage();
  applyTheme();
  bindEvents();
  await loadManifest();
  loadSearchIndex(); // fire-and-forget; search still works without it
}

function loadLocalStorage() {
  try {
    const exp = JSON.parse(localStorage.getItem(LS_EXPANDED) || "[]");
    state.expandedFolders = new Set(exp);

    state.favorites = JSON.parse(localStorage.getItem(LS_FAVORITES) || "[]");
    state.recents   = JSON.parse(localStorage.getItem(LS_RECENTS) || "[]");
    state.recentSearches = JSON.parse(localStorage.getItem(LS_RECENT_SRCH) || "[]");

    const sections = JSON.parse(localStorage.getItem(LS_SECTIONS) || "[]");
    state.collapsedSections = new Set(sections);
  } catch (_) { /* ignore corrupt storage */ }
}

function saveExpandedState() {
  localStorage.setItem(LS_EXPANDED, JSON.stringify([...state.expandedFolders]));
}

function saveFavorites() {
  localStorage.setItem(LS_FAVORITES, JSON.stringify(state.favorites));
}

function saveRecents() {
  localStorage.setItem(LS_RECENTS, JSON.stringify(state.recents));
}

function saveRecentSearches() {
  localStorage.setItem(LS_RECENT_SRCH, JSON.stringify(state.recentSearches));
}

function saveSections() {
  localStorage.setItem(LS_SECTIONS, JSON.stringify([...state.collapsedSections]));
}

/* ═══════════════════════════════════════════════════════════════════════════
   MANIFEST LOADING
═══════════════════════════════════════════════════════════════════════════ */

async function loadManifest() {
  try {
    const res = await fetch("manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.manifest = await res.json();
    renderStats(state.manifest.stats);
    renderTree(state.manifest.tree);
    renderFavorites();
    renderRecents();
    renderSidebarSections();
  } catch (err) {
    el.content.innerHTML = `
      <div class="welcome-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <h2>Could not load manifest.json</h2>
        <p>Run <code>python generate_manifest.py</code> in the repo root, then refresh.<br><small>${err.message}</small></p>
      </div>`;
  }
}

async function loadSearchIndex() {
  try {
    const res = await fetch("search_index.json");
    if (!res.ok) return;
    state.searchIndex = await res.json();
    initFuse();
  } catch (_) { /* search degrades gracefully to name-only */ }
}

function initFuse() {
  if (!window.Fuse || !state.searchIndex) return;
  state.fuse = new Fuse(state.searchIndex, {
    includeScore: true,
    includeMatches: true,
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: "title",   weight: 0.40 },
      { name: "aliases", weight: 0.20 },
      { name: "tags",    weight: 0.15 },
      { name: "folder",  weight: 0.10 },
      { name: "content", weight: 0.15 },
    ],
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   THEME
═══════════════════════════════════════════════════════════════════════════ */

function applyTheme() {
  const saved = localStorage.getItem(LS_THEME) || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeIcons(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(LS_THEME, next);
  updateThemeIcons(next);
}

function updateThemeIcons(theme) {
  el.iconSun.style.display  = theme === "dark"  ? "" : "none";
  el.iconMoon.style.display = theme === "light" ? "" : "none";
}

/* ═══════════════════════════════════════════════════════════════════════════
   STATS
═══════════════════════════════════════════════════════════════════════════ */

function renderStats(stats) {
  if (!stats) return;
  el.statTotal.textContent   = stats.total_files ?? 0;
  el.statFolders.textContent = stats.total_folders ?? 0;
  el.statHtml.textContent    = stats.html ?? 0;
  el.statMd.textContent      = stats.markdown ?? 0;
  el.statPdf.textContent     = stats.pdf ?? 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   FILE TYPE ICONS
═══════════════════════════════════════════════════════════════════════════ */

function fileIcon(type, size = 14) {
  if (type === "html") {
    return `<svg class="file-icon icon-html" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>`;
  }
  if (type === "markdown") {
    return `<svg class="file-icon icon-md" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <path d="M7 17V7l3 4 3-4v10M17 13l-3 3"/>
    </svg>`;
  }
  if (type === "pdf") {
    return `<svg class="file-icon icon-pdf" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="15" x2="15" y2="15"/>
    </svg>`;
  }
  // generic
  return `<svg class="file-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
    <polyline points="13 2 13 9 20 9"/>
  </svg>`;
}

function folderIcon(open = false, size = 14) {
  if (open) {
    return `<svg class="folder-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      <line x1="2" y1="10" x2="22" y2="10"/>
    </svg>`;
  }
  return `<svg class="folder-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   FOLDER TREE
═══════════════════════════════════════════════════════════════════════════ */

function renderTree(node, parentPath = "") {
  if (!node) return;
  state.currentPath = "";
  updateBreadcrumbs("");
  el.content.innerHTML = "";
  el.content.appendChild(buildFolderNode(node, true));
}

function countDescendants(node) {
  let n = (node.files || []).length;
  for (const child of node.children || []) {
    n += countDescendants(child);
  }
  return n;
}

function buildFolderNode(node, isRoot = false) {
  const wrapper = document.createElement("div");
  wrapper.className = "folder-node";
  wrapper.dataset.path = node.path;

  const isExpanded = isRoot || state.expandedFolders.has(node.path);
  const childCount = countDescendants(node);

  if (!isRoot) {
    // Folder header (clickable)
    const header = document.createElement("div");
    header.className = "folder-header";
    header.innerHTML = `
      <svg class="folder-chevron ${isExpanded ? "open" : ""}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="9 6 15 12 9 18"/>
      </svg>
      ${folderIcon(isExpanded)}
      <span class="folder-name">${escHtml(node.name)}</span>
      ${childCount > 0 ? `<span class="folder-count">${childCount}</span>` : ""}
    `;

    header.addEventListener("click", () => toggleFolder(node.path, wrapper, header));
    wrapper.appendChild(header);
  }

  // Children container
  const childrenDiv = document.createElement("div");
  childrenDiv.className = "folder-children" + (isExpanded || isRoot ? "" : " collapsed");

  // Files in this folder
  const files = filterFiles(node.files || []);
  for (const file of files) {
    childrenDiv.appendChild(buildFileItem(file));
  }

  // Sub-folders
  for (const child of node.children || []) {
    childrenDiv.appendChild(buildFolderNode(child));
  }

  // Empty folder
  if (!isRoot && files.length === 0 && (node.children || []).length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:4px 8px;font-size:0.78rem;color:var(--text-muted);font-style:italic";
    empty.textContent = "No matching files";
    childrenDiv.appendChild(empty);
  }

  setChildrenHeight(childrenDiv, isExpanded || isRoot);
  wrapper.appendChild(childrenDiv);
  return wrapper;
}

function buildFileItem(file) {
  const isFav = state.favorites.some(f => f.path === file.path);
  const isPinned = false; // extensible

  const div = document.createElement("div");
  div.className = "file-item";
  div.dataset.path = file.path;
  div.setAttribute("tabindex", "0");
  div.setAttribute("role", "option");
  div.setAttribute("aria-label", file.name);

  div.innerHTML = `
    ${fileIcon(file.type)}
    <span class="file-name">${escHtml(file.name)}</span>
    ${isPinned ? '<span class="pinned-badge">PIN</span>' : ""}
    <button class="copy-btn" title="Copy link" tabindex="-1">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
    </button>
    <button class="star-btn ${isFav ? "starred" : ""}" title="${isFav ? "Remove favorite" : "Add to favorites"}" tabindex="-1">★</button>
  `;

  // Open document
  div.addEventListener("click", (e) => {
    if (e.target.closest(".star-btn") || e.target.closest(".copy-btn")) return;
    openDocument(file);
  });

  // Keyboard open
  div.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDocument(file);
    }
  });

  // Star / favorite
  div.querySelector(".star-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(file, div.querySelector(".star-btn"));
  });

  // Copy link
  div.querySelector(".copy-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    copyLink(file.path);
  });

  return div;
}

function toggleFolder(path, wrapper, header) {
  const childrenDiv = wrapper.querySelector(".folder-children");
  const chevron = header.querySelector(".folder-chevron");
  const folderIconEl = header.querySelector(".folder-icon");
  const isOpen = !childrenDiv.classList.contains("collapsed");

  if (isOpen) {
    state.expandedFolders.delete(path);
    childrenDiv.classList.add("collapsed");
    setChildrenHeight(childrenDiv, false);
    chevron.classList.remove("open");
    folderIconEl.outerHTML = folderIcon(false);
  } else {
    state.expandedFolders.add(path);
    childrenDiv.classList.remove("collapsed");
    setChildrenHeight(childrenDiv, true);
    chevron.classList.add("open");
    header.querySelector(".folder-icon").outerHTML = folderIcon(true);
  }
  saveExpandedState();
}

/** Animate folder open/close using max-height trick */
function setChildrenHeight(el, open) {
  if (open) {
    el.style.maxHeight = el.scrollHeight + 5000 + "px"; // large enough
  } else {
    el.style.maxHeight = "0";
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FILTERS
═══════════════════════════════════════════════════════════════════════════ */

function filterFiles(files) {
  if (state.activeFilters.size === 0) return files;
  return files.filter(f => state.activeFilters.has(f.type));
}

function handleFilterPill(btn) {
  const type = btn.dataset.filter;
  if (state.activeFilters.has(type)) {
    state.activeFilters.delete(type);
    btn.classList.remove("active");
  } else {
    state.activeFilters.add(type);
    btn.classList.add("active");
  }
  if (state.manifest) renderTree(state.manifest.tree);
}

/* ═══════════════════════════════════════════════════════════════════════════
   OPEN DOCUMENT
═══════════════════════════════════════════════════════════════════════════ */

function openDocument(file) {
  const { name, path, type } = file;

  // Track recent
  addRecent({ name, path, type });

  // Resolve URL
  let url;
  if (type === "markdown") {
    url = `viewer.html?file=${encodeURIComponent(path)}`;
  } else {
    url = path;
  }

  window.open(url, "_blank", "noopener");
}

/* ═══════════════════════════════════════════════════════════════════════════
   FAVORITES
═══════════════════════════════════════════════════════════════════════════ */

function toggleFavorite(file, btn) {
  const idx = state.favorites.findIndex(f => f.path === file.path);
  if (idx === -1) {
    state.favorites.unshift({ name: file.name, path: file.path, type: file.type });
    btn.classList.add("starred");
    btn.title = "Remove favorite";
    showToast(`★ Added to favorites: ${file.name}`);
  } else {
    state.favorites.splice(idx, 1);
    btn.classList.remove("starred");
    btn.title = "Add to favorites";
    showToast(`Removed from favorites: ${file.name}`);
  }
  saveFavorites();
  renderFavorites();
}

function renderFavorites() {
  if (state.favorites.length === 0) {
    el.favoritesList.innerHTML = `<div class="search-hint" style="padding:10px 14px;font-size:0.75rem">No favorites yet. Click ★ on any file.</div>`;
    return;
  }
  el.favoritesList.innerHTML = "";
  for (const f of state.favorites) {
    el.favoritesList.appendChild(buildSidebarDocItem(f, "fav"));
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   RECENTS
═══════════════════════════════════════════════════════════════════════════ */

function addRecent(file) {
  state.recents = state.recents.filter(r => r.path !== file.path);
  state.recents.unshift(file);
  if (state.recents.length > MAX_RECENTS) state.recents.pop();
  saveRecents();
  renderRecents();
}

function renderRecents() {
  if (state.recents.length === 0) {
    el.recentsList.innerHTML = `<div class="search-hint" style="padding:10px 14px;font-size:0.75rem">No recent documents.</div>`;
    return;
  }
  el.recentsList.innerHTML = "";
  for (const f of state.recents.slice(0, 10)) {
    el.recentsList.appendChild(buildSidebarDocItem(f, "rec"));
  }
}

function buildSidebarDocItem(file, kind) {
  const div = document.createElement("div");
  div.className = "sidebar-doc-item";
  div.innerHTML = `
    <span class="item-icon">${fileIcon(file.type, 13)}</span>
    <span style="flex:1;min-width:0">
      <div class="item-name">${escHtml(file.name)}</div>
      <div class="item-path">${escHtml(file.path.split("/").slice(0, -1).join("/") || "root")}</div>
    </span>
    <button class="remove-btn" title="Remove" tabindex="-1">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;

  div.addEventListener("click", (e) => {
    if (e.target.closest(".remove-btn")) return;
    openDocument(file);
  });

  div.querySelector(".remove-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (kind === "fav") {
      state.favorites = state.favorites.filter(f => f.path !== file.path);
      saveFavorites();
      renderFavorites();
      // Also update star in tree if visible
      const starBtn = document.querySelector(`.file-item[data-path="${CSS.escape(file.path)}"] .star-btn`);
      if (starBtn) { starBtn.classList.remove("starred"); starBtn.title = "Add to favorites"; }
    } else {
      state.recents = state.recents.filter(r => r.path !== file.path);
      saveRecents();
      renderRecents();
    }
  });

  return div;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SIDEBAR SECTION COLLAPSE
═══════════════════════════════════════════════════════════════════════════ */

function renderSidebarSections() {
  document.querySelectorAll(".sidebar-section-header").forEach(header => {
    const key = header.dataset.section;
    const content = header.nextElementSibling;
    const isCollapsed = state.collapsedSections.has(key);
    if (isCollapsed) {
      header.classList.add("collapsed");
      content.classList.add("collapsed");
    } else {
      content.style.maxHeight = content.scrollHeight + "px";
    }
  });
}

function toggleSection(key) {
  const header = document.querySelector(`.sidebar-section-header[data-section="${key}"]`);
  const content = header?.nextElementSibling;
  if (!header || !content) return;

  if (state.collapsedSections.has(key)) {
    state.collapsedSections.delete(key);
    header.classList.remove("collapsed");
    content.classList.remove("collapsed");
    content.style.maxHeight = content.scrollHeight + 500 + "px";
  } else {
    state.collapsedSections.add(key);
    header.classList.add("collapsed");
    content.style.maxHeight = content.scrollHeight + "px";
    // Force reflow for transition
    content.getBoundingClientRect();
    content.classList.add("collapsed");
    content.style.maxHeight = "0";
  }
  saveSections();
}

/* ═══════════════════════════════════════════════════════════════════════════
   BREADCRUMBS
═══════════════════════════════════════════════════════════════════════════ */

function updateBreadcrumbs(path) {
  const parts = path ? path.split("/") : [];
  let html = `
    <span class="breadcrumb-item">
      <span class="breadcrumb-link" data-path="" role="button" tabindex="0">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:3px">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>Home
      </span>
    </span>`;

  let cumPath = "";
  parts.forEach((part, i) => {
    cumPath = cumPath ? cumPath + "/" + part : part;
    const isLast = i === parts.length - 1;
    const escapedPath = escHtml(cumPath);
    html += `<span class="breadcrumb-item">
      <span class="breadcrumb-sep">›</span>
      ${isLast
        ? `<span class="breadcrumb-current">${escHtml(part)}</span>`
        : `<span class="breadcrumb-link" data-path="${escapedPath}" role="button" tabindex="0">${escHtml(part)}</span>`
      }
    </span>`;
  });

  el.breadcrumbs.innerHTML = html;

  // Rebind breadcrumb clicks
  el.breadcrumbs.querySelectorAll(".breadcrumb-link").forEach(link => {
    link.addEventListener("click", () => {
      const p = link.dataset.path;
      navigateTo(p);
    });
    link.addEventListener("keydown", (e) => {
      if (e.key === "Enter") navigateTo(link.dataset.path);
    });
  });
}

function navigateTo(path) {
  if (!state.manifest) return;
  state.currentPath = path;
  updateBreadcrumbs(path);

  if (!path) {
    // Navigate to root
    el.content.innerHTML = "";
    el.content.appendChild(buildFolderNode(state.manifest.tree, true));
    return;
  }

  // Find node by path
  const node = findNodeByPath(state.manifest.tree, path);
  if (node) {
    el.content.innerHTML = "";
    el.content.appendChild(buildFolderNode(node, true));
  }
}

function findNodeByPath(node, targetPath) {
  if (node.path === targetPath) return node;
  for (const child of node.children || []) {
    const found = findNodeByPath(child, targetPath);
    if (found) return found;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SEARCH
═══════════════════════════════════════════════════════════════════════════ */

function openSearch() {
  el.searchOverlay.classList.add("open");
  el.searchModalInput.focus();
  renderSearchHint();
}

function closeSearch() {
  el.searchOverlay.classList.remove("open");
  el.searchModalInput.value = "";
  state.focusedResultIdx = -1;
}

function renderSearchHint() {
  if (state.recentSearches.length > 0) {
    let html = `<div class="recent-searches-section">
      <h4>Recent Searches</h4>`;
    for (const q of state.recentSearches) {
      html += `<div class="recent-search-item" data-query="${escHtml(q)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        ${escHtml(q)}
      </div>`;
    }
    html += "</div>";
    el.searchResults.innerHTML = html;

    el.searchResults.querySelectorAll(".recent-search-item").forEach(item => {
      item.addEventListener("click", () => {
        el.searchModalInput.value = item.dataset.query;
        runSearch(item.dataset.query);
      });
    });
  } else {
    el.searchResults.innerHTML = `<div class="search-hint">Type to search across all documents…</div>`;
  }
}

function runSearch(query) {
  query = query.trim();
  if (!query) {
    renderSearchHint();
    return;
  }

  let results = [];

  if (state.fuse) {
    // Full-text fuzzy search via Fuse.js
    let pool = state.searchIndex;
    if (state.searchTypeFilter !== "all") {
      pool = pool.filter(doc => doc.type === state.searchTypeFilter);
    }

    // Re-create Fuse with filtered pool if needed
    const fuseInstance = state.searchTypeFilter === "all"
      ? state.fuse
      : new Fuse(pool, state.fuse.options);

    results = fuseInstance.search(query, { limit: 40 });
  } else if (state.manifest) {
    // Fallback: name-only search from manifest tree
    results = fallbackSearch(query);
  }

  renderSearchResults(results, query);
}

function fallbackSearch(query) {
  const q = query.toLowerCase();
  const found = [];

  function walk(node) {
    for (const file of node.files || []) {
      if (file.name.toLowerCase().includes(q) || (node.path || "").toLowerCase().includes(q)) {
        found.push({
          item: {
            title: file.name,
            path: file.path,
            type: file.type,
            folder: node.path,
            content: "",
            tags: [],
            aliases: [],
          },
          score: 0.5,
          matches: [],
        });
      }
    }
    for (const child of node.children || []) walk(child);
  }

  walk(state.manifest.tree);
  return found;
}

function renderSearchResults(results, query) {
  if (!results || results.length === 0) {
    el.searchResults.innerHTML = `
      <div class="no-results">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px;opacity:0.4">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <div>No results for "<strong>${escHtml(query)}</strong>"</div>
        <div style="font-size:0.75rem;margin-top:4px">Try different keywords or check spelling</div>
      </div>`;
    return;
  }

  // Save recent search
  state.recentSearches = state.recentSearches.filter(s => s !== query);
  state.recentSearches.unshift(query);
  if (state.recentSearches.length > MAX_RECENT_SEARCHES) state.recentSearches.pop();
  saveRecentSearches();

  let html = `<div class="result-count">${results.length} result${results.length !== 1 ? "s" : ""} for "<strong>${escHtml(query)}</strong>"</div>`;

  for (let i = 0; i < results.length; i++) {
    const { item, matches } = results[i];
    const snippet = buildSnippet(item, query, matches);
    const folderDisplay = item.folder ? item.folder : "root";

    html += `
      <div class="result-item" role="option" data-path="${escHtml(item.path)}" data-type="${item.type}" data-idx="${i}">
        <span class="result-icon">${fileIcon(item.type, 16)}</span>
        <div class="result-body">
          <div class="result-title">${highlightText(item.title, query)}</div>
          <div class="result-path">${escHtml(folderDisplay)}</div>
          ${snippet ? `<div class="result-snippet">${snippet}</div>` : ""}
        </div>
      </div>`;
  }

  el.searchResults.innerHTML = html;
  state.focusedResultIdx = -1;

  el.searchResults.querySelectorAll(".result-item").forEach(item => {
    item.addEventListener("click", () => {
      openDocument({ name: item.querySelector(".result-title").textContent, path: item.dataset.path, type: item.dataset.type });
      closeSearch();
    });
    item.addEventListener("mouseenter", () => {
      state.focusedResultIdx = parseInt(item.dataset.idx, 10);
      highlightFocusedResult();
    });
  });
}

function buildSnippet(item, query, matches) {
  // Try to find match in content from Fuse matches
  if (matches) {
    for (const m of matches) {
      if (m.key === "content" && m.indices && item.content) {
        const start = Math.max(0, m.indices[0][0] - 60);
        const end   = Math.min(item.content.length, m.indices[0][1] + 120);
        const raw   = (start > 0 ? "…" : "") + item.content.slice(start, end) + (end < item.content.length ? "…" : "");
        return highlightText(escHtml(raw), query);
      }
    }
  }
  // Fallback: first chunk of content
  if (item.content && item.content.length > 0) {
    const snippet = item.content.slice(0, 180);
    return highlightText(escHtml(snippet), query) + (item.content.length > 180 ? "…" : "");
  }
  return "";
}

function highlightText(text, query) {
  if (!query) return text;
  const words = query.trim().split(/\s+/).filter(Boolean).map(escapeRegex);
  if (!words.length) return text;
  const pattern = new RegExp(`(${words.join("|")})`, "gi");
  return text.replace(pattern, "<mark>$1</mark>");
}

function highlightFocusedResult() {
  el.searchResults.querySelectorAll(".result-item").forEach((item, i) => {
    item.classList.toggle("focused", i === state.focusedResultIdx);
  });
  const focused = el.searchResults.querySelector(".result-item.focused");
  if (focused) focused.scrollIntoView({ block: "nearest" });
}

/* ═══════════════════════════════════════════════════════════════════════════
   KEYBOARD NAVIGATION
═══════════════════════════════════════════════════════════════════════════ */

function bindKeyboard() {
  document.addEventListener("keydown", (e) => {
    // "/" shortcut to open search
    if (e.key === "/" && !isInputFocused()) {
      e.preventDefault();
      openSearch();
      return;
    }

    // Escape closes search
    if (e.key === "Escape" && el.searchOverlay.classList.contains("open")) {
      closeSearch();
      return;
    }

    // Arrow navigation in search results
    if (el.searchOverlay.classList.contains("open")) {
      const items = el.searchResults.querySelectorAll(".result-item");
      if (!items.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        state.focusedResultIdx = Math.min(state.focusedResultIdx + 1, items.length - 1);
        highlightFocusedResult();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        state.focusedResultIdx = Math.max(state.focusedResultIdx - 1, 0);
        highlightFocusedResult();
      } else if (e.key === "Enter" && state.focusedResultIdx >= 0) {
        e.preventDefault();
        items[state.focusedResultIdx]?.click();
      }
    }
  });
}

function isInputFocused() {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
}

/* ═══════════════════════════════════════════════════════════════════════════
   COPY LINK
═══════════════════════════════════════════════════════════════════════════ */

function copyLink(path) {
  const url = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "/") + path;
  navigator.clipboard.writeText(url).then(() => {
    showToast("Link copied to clipboard!");
  }).catch(() => {
    showToast("Could not copy link.");
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════════════════════════ */

let toastTimer = null;
function showToast(msg, duration = 2500) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), duration);
}

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════════════════ */

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ═══════════════════════════════════════════════════════════════════════════
   EVENT BINDING
═══════════════════════════════════════════════════════════════════════════ */

function bindEvents() {
  // Theme toggle
  el.themeToggle.addEventListener("click", toggleTheme);

  // Header search input → open modal
  el.searchInput.addEventListener("click", openSearch);
  el.searchInput.addEventListener("focus", openSearch);

  // Modal search input
  el.searchModalInput.addEventListener("input", (e) => {
    clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = setTimeout(() => runSearch(e.target.value), SEARCH_DEBOUNCE_MS);
  });

  // Close search
  el.searchClose.addEventListener("click", closeSearch);
  el.searchOverlay.addEventListener("click", (e) => {
    if (e.target === el.searchOverlay) closeSearch();
  });

  // Filter pills
  el.filterBar.querySelectorAll(".filter-pill").forEach(btn => {
    btn.addEventListener("click", () => handleFilterPill(btn));
  });

  // Type filter inside search modal
  document.querySelectorAll(".type-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".type-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.searchTypeFilter = btn.dataset.type;
      const q = el.searchModalInput.value.trim();
      if (q) runSearch(q);
    });
  });

  // Sidebar section toggles
  document.querySelectorAll(".sidebar-section-header").forEach(header => {
    header.addEventListener("click", () => toggleSection(header.dataset.section));
  });

  // Mobile sidebar
  el.sidebarToggle.addEventListener("click", () => {
    el.sidebar.classList.toggle("open");
    el.sidebarOverlay.classList.toggle("open");
  });
  el.sidebarOverlay.addEventListener("click", () => {
    el.sidebar.classList.remove("open");
    el.sidebarOverlay.classList.remove("open");
  });

  // Keyboard shortcuts
  bindKeyboard();

  // Wait for Fuse.js to load (it's deferred)
  window.addEventListener("load", () => {
    if (window.Fuse && state.searchIndex) initFuse();
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", init);