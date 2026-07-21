// Shared client lib: paginated JIRA fetch via /api/jira/jql proxy.
// Browser usa Basic Auth do próprio Worker (Authorization header já preenchido pelo browser
// porque a página foi servida atrás do gate — fetch herda o realm).

window.KruzerAPI = (function () {
  async function jqlPage({ jql, fields, maxResults = 100, nextPageToken, expand }) {
    const res = await fetch('/api/jira/jql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields, maxResults, nextPageToken, expand }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`JIRA proxy ${res.status}: ${text}`);
    }
    return res.json();
  }

  async function fetchAll({ jql, fields, expand, onProgress, maxPages = 60 }) {
    let all = [];
    let token = null;
    let page = 0;
    while (page < maxPages) {
      const data = await jqlPage({ jql, fields, expand, nextPageToken: token, maxResults: 100 });
      const issues = data.issues || [];
      all = all.concat(issues);
      page++;
      if (onProgress) onProgress(all.length, page);
      if (data.isLast === true || !data.nextPageToken) break;
      token = data.nextPageToken;
    }
    return all;
  }

  // ---- Escrita no JIRA (dashboards como ferramenta de gestão) ----
  async function postJson(path, payload) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${res.status}: ${text || res.statusText}`);
    }
    return res.json().catch(() => ({}));
  }
  // Adiciona um comentário no épico do JIRA.
  function addComment(key, text) {
    return postJson('/api/jira/comment', { key, text });
  }
  // Atualiza o Due Date do épico no JIRA. duedate = 'YYYY-MM-DD' ou null pra limpar.
  function updateDueDate(key, duedate) {
    return postJson('/api/jira/issue-update', { key, fields: { duedate: duedate || null } });
  }
  // Atualiza a prioridade do épico no JIRA. name = 'Highest'|'High'|'Medium'|'Low'.
  function updatePriority(key, name) {
    return postJson('/api/jira/issue-update', { key, fields: { priority: { name } } });
  }

  // Roster = usuários atribuíveis do JIRA nos projetos (inclui quem não pegou épico).
  async function fetchRoster(projects) {
    const qs = projects && projects.length ? `?projects=${encodeURIComponent(projects.join(','))}` : '';
    const res = await fetch(`/api/jira/roster${qs}`);
    if (!res.ok) throw new Error(`roster ${res.status}`);
    const data = await res.json();
    return Array.isArray(data && data.users) ? data.users : [];
  }

  // Projetos/espaços do JIRA (universo do filtro de projeto).
  async function fetchProjects() {
    const res = await fetch('/api/jira/projects');
    if (!res.ok) throw new Error(`projects ${res.status}`);
    const data = await res.json();
    return Array.isArray(data && data.projects) ? data.projects : [];
  }

  return { jqlPage, fetchAll, addComment, updateDueDate, updatePriority, fetchRoster, fetchProjects };
})();
