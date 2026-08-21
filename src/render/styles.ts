import type { NavigationConfig } from "../config.js";

export function styles(navigation?: NavigationConfig): string {
  return `
:root {
  --font-body: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-heading: "League Spartan", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --accent: #62748e;
  --accent-dark: #45556c;
  --accent-light: #90a1b9;
  --bg: #f1f5f9;
  --surface: #ffffff;
  --text: #0f172b;
  --text-secondary: #62748e;
  --border: #e2e8f0;
  --border-strong: #cad5e2;
  --code-bg: #e2e8f0;
  --user-accent: #62748e;
  --user-bg: #f8fafc;
  --assistant-accent: #0f172b;
  --assistant-bg: #ffffff;
  --badge-user-text: #ffffff;
  --badge-assistant-text: #ffffff;
  --shadow: 0 1px 2px rgba(15, 23, 43, 0.06), 0 4px 12px rgba(15, 23, 43, 0.04);
  --nav-user-bg: #0f172b;
  --nav-user-text: #f8fafc;
  --nav-assistant-bg: #e2e8f0;
  --nav-assistant-text: #0f172b;
}

html.dark {
  --accent: #90a1b9;
  --accent-dark: #cad5e2;
  --accent-light: #e2e8f0;
  --bg: #0f172b;
  --surface: #1d293d;
  --text: #f8fafc;
  --text-secondary: #90a1b9;
  --border: #314158;
  --border-strong: #45556c;
  --code-bg: #020618;
  --user-accent: #90a1b9;
  --user-bg: #314158;
  --assistant-accent: #f1f5f9;
  --assistant-bg: #1d293d;
  --badge-user-text: #0f172b;
  --badge-assistant-text: #0f172b;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 14px rgba(0, 0, 0, 0.3);
  --nav-user-bg: #020618;
  --nav-user-text: #f8fafc;
  --nav-assistant-bg: #314158;
  --nav-assistant-text: #f8fafc;
}

* {
  box-sizing: border-box;
}

html {
  font-size: 16px;
  scroll-behavior: smooth;
}

body {
  margin: 0;
  font-family: var(--font-body);
  line-height: 1.6;
  color: var(--text);
  background: var(--bg);
  transition: background 0.2s ease, color 0.2s ease;
}

.container {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 1rem;
}

.site-header {
  position: sticky;
  top: 0;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  backdrop-filter: saturate(1.4) blur(10px);
  -webkit-backdrop-filter: saturate(1.4) blur(10px);
  border-bottom: 1px solid var(--border-strong);
  padding: 1rem 0;
  z-index: 10;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.session-title {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text);
}

.session-meta {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.theme-toggle,
.download-toggle {
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: 9999px;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text);
  font-size: 1.1rem;
  transition: background 0.2s ease, border-color 0.2s ease;
  padding: 0;
}

.theme-toggle:hover,
.download-toggle:hover {
  background: var(--border);
}

.download-toggle svg {
  width: 1.15rem;
  height: 1.15rem;
}

html:not(.dark) .theme-icon-dark {
  display: none;
}

html.dark .theme-icon-light {
  display: none;
}

.chat {
  padding-top: 2rem;
  padding-bottom: 4rem;
}

.turn {
  margin-bottom: 2.5rem;
  scroll-margin-top: 7.10rem;
}

.turn-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.75rem;
}

.turn-badge {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  padding: 0.25rem 0.6rem;
  border-radius: 0.4rem;
  line-height: 1.4;
}

.user-badge {
  color: var(--badge-user-text);
  background: var(--user-accent);
}

.assistant-badge {
  color: var(--badge-assistant-text);
  background: var(--assistant-accent);
}

.assistant-info {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.message {
  padding: 1.25rem 1.5rem;
  border-radius: 0.75rem;
  border: 1px solid var(--border);
  overflow-wrap: break-word;
}

.user-message {
  background: var(--user-bg);
  border-color: color-mix(in srgb, var(--user-accent) 22%, var(--border));
  border-left: 3px solid var(--user-accent);
}

.assistant-message {
  background: var(--assistant-bg);
  box-shadow: var(--shadow);
}

.message > *:first-child {
  margin-top: 0;
}

.message > *:last-child {
  margin-bottom: 0;
}

.collapsible {
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  margin-bottom: 0.75rem;
  overflow: hidden;
}

.collapsible summary {
  padding: 0.6rem 0.75rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.collapsible summary::-webkit-details-marker {
  display: none;
}

.collapsible summary::after {
  content: "+";
  font-size: 1.1rem;
  color: var(--accent);
}

.collapsible[open] summary::after {
  content: "−";
}

.collapsible > *:not(summary) {
  padding: 0 0.75rem 0.75rem;
}

.thinking {
  background: var(--bg);
  border-style: dashed;
}

.thinking-block {
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.session-stats,
.session-summary {
  background: var(--bg);
  border: 1px dashed var(--border-strong);
  border-radius: 0.5rem;
  padding: 1rem;
  margin-top: 1rem;
  margin-bottom: 4rem;
}

.session-summary {
  margin-top: 2rem;
}

.session-stats-heading,
.session-summary-heading {
  margin: 0 0 1rem;
  font-family: var(--font-heading);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.session-summary-body {
  color: var(--text);
  font-size: 0.95rem;
}

.session-summary-body p,
.session-summary-body ul,
.session-summary-body ol {
  margin: 0.75rem 0;
}

.session-summary-body > *:first-child {
  margin-top: 0;
}

.session-summary-body > *:last-child {
  margin-bottom: 0;
}

.session-summary details > summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.session-summary details > summary::-webkit-details-marker {
  display: none;
}

.session-summary details > summary::after {
  content: "+";
  font-size: 1.1rem;
  color: var(--accent);
}

.session-summary details[open] > summary::after {
  content: "−";
}

.session-summary details > summary.session-summary-heading {
  margin: 0;
}

.session-summary details[open] > summary.session-summary-heading {
  margin-bottom: 1rem;
}

.session-id {
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease;
  font-family: var(--font-mono);
  font-weight: 500;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text-secondary);
}

.session-stats-heading:hover .session-id {
  opacity: 1;
  visibility: visible;
}

.stats-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem 1.5rem;
}

.stat-pair {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.9rem;
}

.stat-blank {
  visibility: hidden;
}

.stat-pair dt {
  color: var(--text-secondary);
  font-weight: 500;
}

.stat-pair dd {
  margin: 0;
  color: var(--text);
  font-family: var(--font-mono);
  font-weight: 500;
}

.stat-na {
  color: var(--text-secondary);
  font-style: italic;
  font-weight: 400;
}

.tool {
  border-left: 3px solid var(--accent);
}

.references {
  border-left: 3px solid var(--accent-light);
  margin-top: 0.75rem;
}

.references-list {
  list-style: none;
  margin: 0;
  padding-left: 0;
  font-size: 0.9rem;
}

.references-list li {
  margin: 0.5rem 0;
  color: var(--text);
}

.ref {
  font-size: 0.75em;
  line-height: 0;
  vertical-align: super;
}

.ref a {
  color: var(--accent-dark);
  text-decoration: none;
  font-weight: 600;
}

.ref a:hover {
  text-decoration: underline;
  text-decoration-color: var(--accent);
}

.ref-domain {
  color: var(--text-secondary);
  font-size: 0.8em;
  font-family: var(--font-mono);
}

.ref-snippet {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
  font-size: 0.85em;
  line-height: 1.5;
}

.synthetic {
  border-left: 3px solid var(--user-accent);
  margin-top: 0.75rem;
}

.synthetic-code {
  margin: 0 0 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.5;
  padding: 0.75rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  overflow-x: auto;
  max-height: 40vh;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
}

.synthetic-code:last-child {
  margin-bottom: 0;
}

.extension {
  border-left: 3px solid var(--accent-light);
  margin-top: 0.75rem;
}

.extension-code {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.5;
  padding: 0.75rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  overflow-x: auto;
  max-height: 40vh;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
}

.parent-link {
  font-size: 0.85rem;
  margin-bottom: 0.4rem;
}

.parent-link a {
  color: var(--accent-dark);
  text-decoration: none;
  font-weight: 500;
}

.parent-link a:hover {
  text-decoration: underline;
  text-decoration-color: var(--accent);
}

.subagent-relations {
  background: var(--bg);
  border: 1px dashed var(--border-strong);
  border-radius: 0.5rem;
  padding: 1rem;
  margin-top: 2rem;
  margin-bottom: 0;
}

.subagent-relations-heading {
  margin: 0 0 1rem;
  font-family: var(--font-heading);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.subagent-relations-list {
  list-style: none;
  margin: 0;
  padding-left: 0;
  font-size: 0.95rem;
}

.subagent-relations-list li {
  margin: 0.5rem 0;
  color: var(--text);
}

.subagent-relations-list a {
  color: var(--accent-dark);
  text-decoration: none;
  font-weight: 600;
}

.subagent-relations-list a:hover {
  text-decoration: underline;
  text-decoration-color: var(--accent);
}

.subagent-relation-description {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
  font-size: 0.85em;
  line-height: 1.5;
}

.subagent-card {
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--accent-dark);
  border-radius: 0.5rem;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  box-shadow: var(--shadow);
}

.subagent-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.subagent-badge {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  padding: 0.25rem 0.6rem;
  border-radius: 0.4rem;
  line-height: 1.4;
  color: var(--badge-assistant-text);
  background: var(--accent-dark);
}

.subagent-title {
  font-weight: 600;
  color: var(--text);
}

.subagent-state {
  font-size: 0.8rem;
  color: var(--text-secondary);
  text-transform: capitalize;
}

.subagent-body {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.subagent-description {
  margin: 0 0 0.5rem;
  line-height: 1.5;
}

.subagent-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--accent-dark);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9rem;
}

.subagent-link:hover {
  text-decoration: underline;
  text-decoration-color: var(--accent);
}

.tool-name {
  font-family: var(--font-mono);
  color: var(--text);
}

.tool-section {
  margin-bottom: 0.75rem;
}

.tool-section strong {
  display: block;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
}

.tool-code {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  padding: 0.75rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  overflow-x: auto;
  font-size: 0.85rem;
  line-height: 1.5;
}

.tool-output {
  max-height: 40vh;
  overflow-y: auto;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.75rem;
  font-size: 0.9rem;
}

.tool-output pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-output img {
  max-width: 100%;
  height: auto;
  border-radius: 0.25rem;
}

.message h1,
.message h2,
.message h3,
.message h4,
.message h5,
.message h6 {
  font-family: var(--font-heading);
  margin: 1.5rem 0 0.75rem;
  line-height: 1.2;
  font-weight: 700;
  color: var(--text);
}

.message h1 {
  font-size: 1.6rem;
  border-bottom: 2px solid var(--border-strong);
  padding-bottom: 0.5rem;
}

.message h2 {
  font-size: 1.3rem;
  border-bottom: 1px solid var(--border-strong);
  padding-bottom: 0.4rem;
}

.message h3 {
  font-size: 1.1rem;
}

.message p {
  margin: 0.75rem 0;
}

.message a {
  color: var(--accent-dark);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
  text-underline-offset: 2px;
  font-weight: 500;
}

.message a:hover {
  text-decoration-color: var(--accent);
}

.message ul,
.message ol {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
}

.message li {
  margin: 0.25rem 0;
}

.message blockquote {
  margin: 0.75rem 0;
  padding: 0.5rem 1rem;
  border-left: 4px solid var(--accent);
  background: var(--bg);
  color: var(--text-secondary);
}

.message pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.75rem;
  overflow-x: auto;
  margin: 0.75rem 0;
}

.message pre code {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  line-height: 1.5;
  background: transparent;
  padding: 0;
  border-radius: 0;
}

.message code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--code-bg);
  padding: 0.15rem 0.35rem;
  border-radius: 0.25rem;
}

.message table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75rem 0;
  font-size: 0.9rem;
  overflow-x: auto;
  display: block;
}

.message thead {
  background: var(--bg);
}

.message th,
.message td {
  border: 1px solid var(--border);
  padding: 0.5rem 0.75rem;
  text-align: left;
  vertical-align: top;
}

.message th {
  font-weight: 600;
  color: var(--text);
}

.message img {
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
  margin: 0.5rem 0;
}

.message hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.5rem 0;
}

${navigation ? scrubberStyles(navigation) : ""}
@media (max-width: 640px) {
  html {
    font-size: 15px;
  }

  .container {
    padding: 0 0.75rem;
  }

  .session-title {
    font-size: 1.1rem;
  }

  .session-meta {
    font-size: 0.75rem;
  }

  .message {
    padding: 1rem 1.1rem;
  }

  .turn {
    margin-bottom: 2rem;
  }

  .turn-header {
    flex-wrap: wrap;
  }

  .stats-row {
    grid-template-columns: 1fr;
  }
}
`;
}

function scrubberStyles(navigation: NavigationConfig): string {
  const progressBar = navigation.progressBar ?? true;
  const roleColor = navigation.roleColor ?? false;
  const progressStyles = progressBar
    ? `
.turn-scrubber-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  background: var(--accent);
  width: 0%;
  transition: width 0.3s ease;
  z-index: 21;
}
`
    : "";
  const roleStyles = roleColor
    ? `
.turn-scrubber-link.role-user {
  background: var(--nav-user-bg);
  color: var(--nav-user-text);
}

.turn-scrubber-link.role-user:hover {
  background: color-mix(in srgb, var(--nav-user-bg) 85%, white 15%);
}

.turn-scrubber-link.role-assistant {
  background: var(--nav-assistant-bg);
  color: var(--nav-assistant-text);
}

.turn-scrubber-link.role-assistant:hover {
  background: color-mix(in srgb, var(--nav-assistant-bg) 85%, black 15%);
}

.turn-scrubber-link.role-user.active-turn,
.turn-scrubber-link.role-assistant.active-turn {
  outline-color: var(--accent-light);
}
`
    : "";

  return `
body {
  padding-bottom: calc(48px + 2rem);
}

.turn-scrubber {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-top: 1px solid var(--border-strong);
  z-index: 20;
  display: flex;
  align-items: center;
}

.turn-scrubber-track {
  display: flex;
  gap: 0.25rem;
  padding: 0 1rem;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: safe center;
  scroll-behavior: smooth;
}

.turn-scrubber-track::-webkit-scrollbar {
  display: none;
}

.turn-scrubber-link {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 28px;
  padding: 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
  border-radius: 4px;
  transition: transform 0.15s ease, outline-color 0.15s ease, background-color 0.15s ease;
  font-variant-numeric: tabular-nums;
  outline: 2px solid transparent;
  outline-offset: 2px;
  background: var(--bg);
}

.turn-scrubber-link:hover {
  background: var(--border);
}

.turn-scrubber-link:focus-visible {
  outline-color: var(--accent-light);
}

.turn-scrubber-link.active-turn {
  transform: scale(1.08);
  outline-color: var(--accent-light);
}
${roleStyles}${progressStyles}`;
}
