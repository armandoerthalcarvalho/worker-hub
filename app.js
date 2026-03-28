// ==========================================
// STATE
// ==========================================
var BACKEND_URL   = 'https://worker-hub-production.up.railway.app';
var BACKEND_TOKEN = 'c05f9c836aaee26e799a846e15734f90889ca03b8ad';
var workerToken   = localStorage.getItem('worker_token') || BACKEND_TOKEN;
var backendUrl    = localStorage.getItem('worker_backend_url') || BACKEND_URL;
var searchMode = 'ai';
var searchTypes = ['web'];
var searchQty = 5;
var searchResults = [];
var selectedResult = null;
var selectedIndices = new Set();
var activeTool = null;
var chatHistory = [];
var searchHistory = JSON.parse(localStorage.getItem('worker_history') || '[]');
var customTools = JSON.parse(localStorage.getItem('worker_customtools') || '[]');
var canvasOpen = false;
var isLight = localStorage.getItem('worker_theme') === 'light';
var recognition = null;
var isListening = false;
var cmdFocusIdx = -1;
var cmdItems = [];

if (isLight) document.body.classList.add('light');

// ==========================================
// BACKEND API
// ==========================================

// Tool IDs that use the deep tier (SambaNova DeepSeek V3)
var DEEP_TOOL_IDS = ['code', 'research', 'data', 'prompt', 'sql', 'security', 'math'];

function getTier() {
  if (searchMode === 'deep') return 'deep';
  if (!activeTool) return 'normal';
  if (activeTool.custom) return 'deep';           // all custom tools → deep
  return DEEP_TOOL_IDS.includes(activeTool.id) ? 'deep' : 'normal';
}

async function workerChat(messages, system, temp, max, tier) {
  if (system    === undefined) system = '';
  if (temp      === undefined) temp   = 0.7;
  if (max       === undefined) max    = 2048;
  if (tier      === undefined) tier   = 'normal';

  if (!workerToken || !backendUrl) { workerToken = BACKEND_TOKEN; backendUrl = BACKEND_URL; }

  var res = await fetch(backendUrl.replace(/\/$/, '') + '/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Token': workerToken,
    },
    body: JSON.stringify({ messages: messages, system: system, temp: temp, max_tokens: max, tier: tier }),
  });

  if (!res.ok) {
    var err = await res.json().catch(function() { return { error: 'Unknown error' }; });
    throw new Error(err.error || ('Backend error ' + res.status));
  }

  var data = await res.json();

  // Notify user when SambaNova fell back to Groq
  if (data.fallback) {
    toast('⚡ Fallback to Groq (SambaNova limit reached)', '⚠️');
  }

  return { content: data.content, provider: data.provider, model: data.model, fallback: !!data.fallback };
}

// Convenience wrapper — returns just the text string (backward-compat with callers)
async function groqChat(messages, system, temp, max) {
  var result = await workerChat(messages, system, temp, max, getTier());
  return result.content;
}

// Search via backend proxy (replaces allorigins.win)
async function backendSearch(query, count) {
  if (!workerToken || !backendUrl) { workerToken = BACKEND_TOKEN; backendUrl = BACKEND_URL; }
  var res = await fetch(backendUrl.replace(/\/$/, '') + '/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': workerToken },
    body: JSON.stringify({ query: query, count: count }),
  });
  if (!res.ok) throw new Error('Search backend error ' + res.status);
  var data = await res.json();
  return data.results || [];
}

// ==========================================
// THEME
// ==========================================
function toggleTheme() {
  isLight = !isLight;
  document.body.classList.toggle('light', isLight);
  localStorage.setItem('worker_theme', isLight ? 'light' : 'dark');
  document.getElementById('themeBtn').textContent = isLight ? '🌙 Theme' : '☀️ Theme';
}
if (isLight) document.getElementById('themeBtn').textContent = '🌙 Theme';

// ==========================================
// API KEY MODAL
// ==========================================
function openModal(type) {
  if (!type) type = 'api';
  var box = document.getElementById('modalBox');
  if (type === 'api') {
    box.innerHTML = `
      <div class="modal-title">⚙️ Settings</div>
      <div class="modal-sub">Worker Hub is pre-configured and ready to use. Backend connection is handled automatically.</div>
      <div class="modal-label">Backend</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--text2);padding:8px 10px;background:var(--bg3);border-radius:6px;border:1px solid var(--border);word-break:break-all">${BACKEND_URL}</div>
      <div class="modal-label" style="margin-top:12px">Status</div>
      <div id="settingsStatus" style="font-family:var(--mono);font-size:10px;color:var(--text2);padding:8px 10px;background:var(--bg3);border-radius:6px;border:1px solid var(--border)">Click Test to check connection</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
        <button class="btn btn-blue" onclick="testBackendConnection()">🔌 Test Connection</button>
      </div>`;
  } else if (type === 'customtool') {
    box.innerHTML = `
      <div class="modal-title">🔧 New Tool</div>
      <div class="modal-sub">Create a custom tool with your own system prompt.</div>
      <div class="modal-label">Name</div>
      <input type="text" class="modal-input" id="ct-name" placeholder="Ex: Legal Assistant">
      <div class="modal-label">Icon (emoji)</div>
      <input type="text" class="modal-input" id="ct-icon" placeholder="⚖️" maxlength="2">
      <div class="modal-label">Short description</div>
      <input type="text" class="modal-input" id="ct-desc" placeholder="Ex: Legal analysis">
      <div class="modal-label">System Prompt</div>
      <textarea class="modal-input modal-textarea" id="ct-system" placeholder="You are an expert in..."></textarea>
      <div class="modal-label">Color (hex)</div>
      <input type="text" class="modal-input" id="ct-color" placeholder="#f5a623" value="#f5a623">
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveCustomTool()">✓ Create</button>
      </div>`;
  } else if (type === 'export-search') {
    var md = generateSearchMarkdown();
    box.innerHTML = `
      <div class="modal-title">⬇ Export Search</div>
      <div class="modal-sub">Your search report in Markdown.</div>
      <div class="export-preview">${md.slice(0,800)}${md.length>800?'\n…(truncated)':''}</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
        <button class="btn btn-blue" onclick="copyToClipboard(generateSearchMarkdown());toast('Copied!')">📋 Copy</button>
        <button class="btn btn-primary" onclick="downloadFile('search-worker.md',generateSearchMarkdown())">⬇ Download .md</button>
      </div>`;
  }
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }

async function testBackendConnection() {
  var url   = backendUrl || BACKEND_URL;
  var statusEl = document.getElementById('settingsStatus');
  var btn = document.querySelector('#modalBox .btn-blue');
  btn.disabled = true; btn.textContent = '⏳ Testing...';
  try {
    var res = await fetch(url + '/api/health');
    var data = await res.json();
    if (data.status === 'ok') {
      var info = [];
      if (data.groq)      info.push('Groq ✓');
      if (data.sambanova) info.push('SambaNova ✓');
      if (!data.token_set) info.push('⚠️ WORKER_TOKEN not set on server');
      var msg = '✅ Connected · ' + info.join(' · ');
      if (statusEl) statusEl.textContent = msg;
      toast('Connected! ' + info.join(' · '), '🔌');
    } else {
      var msg2 = '⚠️ Status: ' + JSON.stringify(data);
      if (statusEl) statusEl.textContent = msg2;
      toast(msg2, '⚠️');
    }
  } catch(e) {
    var msg3 = '❌ ' + e.message;
    if (statusEl) statusEl.textContent = msg3;
    toast('Connection failed: ' + e.message, '⚠️');
  } finally {
    btn.disabled = false; btn.textContent = '🔌 Test Connection';
  }
}

function saveCustomTool() {
  var name = document.getElementById('ct-name').value.trim();
  var icon = document.getElementById('ct-icon').value.trim() || '🔧';
  var desc = document.getElementById('ct-desc').value.trim();
  var system = document.getElementById('ct-system').value.trim();
  var color = document.getElementById('ct-color').value.trim() || '#f5a623';
  if (!name || !system) { toast('Name and system prompt are required','⚠️'); return; }
  var tool = { id:'custom-'+Date.now(), icon:icon, name:name, desc:desc, system:system, color:color, hints:['Help with '+name,'Analyze this text','Explain concepts of '+name], custom:true };
  customTools.push(tool);
  localStorage.setItem('worker_customtools', JSON.stringify(customTools));
  renderTools();
  closeModal();
  toast('Tool created ✓');
}

function updateApiBadge() {
  var badge  = document.getElementById('apiBadge');
  var dot    = document.getElementById('apiDot');
  var status = document.getElementById('apiStatus');
  var pill   = document.getElementById('modelPill');
  if (workerToken && backendUrl) {
    badge.classList.add('connected');
    dot.style.background = 'var(--green)';
    status.textContent = 'CONNECTED';
    // Show active tier model in pill
    var tierLabel = getTier() === 'deep' ? 'DeepSeek V3 · deep' : '70b · normal';
    pill.textContent = tierLabel;
  } else {
    badge.classList.remove('connected');
    dot.style.background = 'var(--red)';
    status.textContent = 'NO BACKEND';
    pill.textContent = 'not set';
  }
}

// ==========================================
// TABS
// ==========================================
function switchTab(tab) {
  ['search','chat','productivity'].forEach(function(t) {
    document.getElementById('tab-'+t).classList.toggle('active',t===tab);
    var p = document.getElementById('panel-'+t);
    if (p) { p.classList.toggle('active',t===tab); p.style.display=(t===tab?'flex':'none'); }
  });
  if (tab==='productivity') renderCalendar();
}

// ==========================================
// SEARCH OPTIONS
// ==========================================
function setChip(m) {
  searchMode=m;
  ['ai','all','deep'].forEach(function(x){ document.getElementById('chip-'+x).classList.toggle('active',x===m); });
}
function toggleType(t) {
  var el=document.getElementById('chip-'+t);
  if(searchTypes.includes(t)){if(searchTypes.length===1)return;searchTypes=searchTypes.filter(function(x){return x!==t;});el.classList.remove('active');}
  else{searchTypes.push(t);el.classList.add('active');}
}
function setQty(n) {
  searchQty=n;
  [5,10,20].forEach(function(q){ document.getElementById('chip-'+q).classList.toggle('active',q===n); });
}

// ==========================================
// SEARCH FETCH
// ==========================================
async function fetchSearchResults(query, count) {
  // Primary: backend proxy (DuckDuckGo via Railway)
  try {
    var raw = await backendSearch(query, count + 5);
    if (raw.length > 0) {
      return raw.map(function(r, i) {
        return { id: i, title: r.title, snippet: r.snippet, url: r.url, source: r.source,
                 score: null, enriched: null, summary: null };
      }).slice(0, count);
    }
  } catch(e) {}

  // Fallback: Wikipedia EN (direct, CORS-friendly)
  var results = [];
  try {
    var r = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch='+encodeURIComponent(query)+'&srlimit=5&format=json&origin=*');
    var d = await r.json();
    d.query.search.forEach(function(x) {
      if (results.length >= count) return;
      results.push({ id: results.length, title: x.title, snippet: x.snippet.replace(/<[^>]+>/g,''),
                     url: 'https://en.wikipedia.org/wiki/'+encodeURIComponent(x.title),
                     source: 'wikipedia.org', score: null, enriched: null, summary: null });
    });
  } catch(e) {}

  return results.slice(0, count);
}

// ==========================================
// RUN SEARCH
// ==========================================
async function runSearch() {
  var query = document.getElementById('searchQuery').value.trim();
  if (!query) return;
  var btn=document.getElementById('searchBtn');
  btn.disabled=true; btn.innerHTML='⏳ Searching...';
  selectedIndices.clear();
  setStatus('Searching the web...');
  showSearchLoading();
  document.getElementById('relatedSection').style.display='none';

  var t0=Date.now();
  try {
    var raw=await fetchSearchResults(query, searchQty+5);
    if(raw.length===0){showError('No results found.');return;}
    setStatus(raw.length+' results. Analyzing with AI...');

    var results=raw;
    var relatedQueries=[];

    if(searchMode==='ai'||searchMode==='deep'){
      var prompt='Analyze these search results for: "'+query+'"\n\n'+raw.map(function(r,i){return '['+i+'] TITLE: '+r.title+'\nSOURCE: '+r.source+'\nSNIPPET: '+r.snippet;}).join('\n\n')+'\n\nRespond ONLY in JSON (no markdown):\n{\n  "results": [{"id":<index>,"score":<0-100>,"category":"<category>","reason":"<1 sentence>"}],\n  "related_queries": ["<query1>","<query2>","<query3>","<query4>","<query5>"],\n  "query_analysis": "<one-line topic analysis>"\n}';
      try {
        var aiR=await groqChat([{role:'user',content:prompt}],'',0.3,1200);
        var parsed=JSON.parse(aiR.replace(/```json|```/g,'').trim());
        var scoreMap={};var catMap={};var reasonMap={};
        parsed.results.forEach(function(r){scoreMap[r.id]=r.score;catMap[r.id]=r.category;reasonMap[r.id]=r.reason;});
        var topIds=new Set(parsed.results.map(function(r){return r.id;}));
        results=raw.filter(function(_,i){return topIds.has(i);}).map(function(r){
          var idx=raw.indexOf(r);
          return Object.assign({},r,{score:scoreMap[idx],category:catMap[idx],reason:reasonMap[idx]});
        }).sort(function(a,b){return (b.score||0)-(a.score||0);}).slice(0,searchQty);
        window._queryAnalysis=parsed.query_analysis;
        relatedQueries=parsed.related_queries||[];
      }catch(e){results=raw.slice(0,searchQty);}
    } else {
      results=raw.slice(0,searchQty);
    }

    searchResults=results;
    addToHistory(query);
    renderResults(results);
    if(relatedQueries.length>0) renderRelated(relatedQueries);
    if(results.length>0) selectResult(0);

    var elapsed=((Date.now()-t0)/1000).toFixed(1);
    setStatus(results.length+' results in '+elapsed+'s',elapsed+'s');
    document.getElementById('exportBtn').style.display='flex';

  }catch(e){showError('Error: '+e.message);}
  finally{btn.disabled=false;btn.innerHTML='⚡ Search';}
}

// ==========================================
// HISTORY
// ==========================================
function addToHistory(query) {
  searchHistory = searchHistory.filter(function(h){return h.query!==query;});
  searchHistory.unshift({query:query, date:Date.now(), results:searchResults.length});
  if(searchHistory.length>30) searchHistory=searchHistory.slice(0,30);
  localStorage.setItem('worker_history',JSON.stringify(searchHistory));
  renderHistory();
}

function renderHistory() {
  var el=document.getElementById('historyList');
  document.getElementById('historyCount').textContent=searchHistory.length;
  if(searchHistory.length===0){
    el.innerHTML='<div style="padding:12px 14px;font-family:var(--mono);font-size:9px;color:var(--text3)">No history</div>';
    return;
  }
  el.innerHTML=searchHistory.slice(0,8).map(function(h,i){
    return '<div class="history-item">'+
      '<span style="font-size:11px;opacity:0.4">🔍</span>'+
      '<span class="hi-query" onclick="loadHistory(\''+h.query.replace(/'/g,"\\'")+'\')" style="cursor:pointer">'+h.query+'</span>'+
      '<span class="hi-date">'+timeAgo(h.date)+'</span>'+
      '<span class="hi-del" onclick="deleteHistory('+i+');event.stopPropagation()">✕</span>'+
    '</div>';
  }).join('');
}

function loadHistory(q) {
  document.getElementById('searchQuery').value=q;
  runSearch();
}

function deleteHistory(i) {
  searchHistory.splice(i,1);
  localStorage.setItem('worker_history',JSON.stringify(searchHistory));
  renderHistory();
}

function timeAgo(ts) {
  var d=(Date.now()-ts)/1000;
  if(d<60)return 'just now';
  if(d<3600)return Math.floor(d/60)+'m';
  if(d<86400)return Math.floor(d/3600)+'h';
  return Math.floor(d/86400)+'d';
}

// ==========================================
// RELATED QUERIES
// ==========================================
function renderRelated(queries) {
  var sec=document.getElementById('relatedSection');
  var el=document.getElementById('relatedQueries');
  el.innerHTML=queries.map(function(q){return '<div class="related-chip" onclick="loadHistory(\''+q.replace(/'/g,"\\'")+'\')" style="cursor:pointer">→ '+q+'</div>';}).join('');
  sec.style.display='block';
}

// ==========================================
// RENDER RESULTS
// ==========================================
function renderResults(results) {
  var list=document.getElementById('resultsList');
  document.getElementById('resultsCount').textContent=results.length;
  if(results.length===0){list.innerHTML='<div style="padding:20px 14px;text-align:center;font-family:var(--mono);font-size:9px;color:var(--text3)">No results</div>';return;}
  list.innerHTML=results.map(function(r,i){
    var score=r.score;
    var sc='',sb='';
    if(score!=null){sc=score>=75?'score-high':score>=50?'score-mid':'score-low';sb='<span class="result-score '+sc+'">'+score+'</span>';}
    return '<div class="result-item" id="ri-'+i+'" onclick="selectResult('+i+')">'+
      (r.category?'<div class="ai-badge ai-top">'+r.category+'</div>':'')+
      '<div class="result-num"><span>#'+(i+1)+'</span>'+sb+'</div>'+
      '<div class="result-title">'+r.title+'</div>'+
      '<div class="result-source">'+r.source+'</div>'+
    '</div>';
  }).join('');
}

// ==========================================
// SELECT RESULT
// ==========================================
function selectResult(idx) {
  document.querySelectorAll('.result-item').forEach(function(el){ el.classList.remove('selected'); });
  var ri = document.getElementById('ri-'+idx);
  if (ri) ri.classList.add('selected');
  selectedResult=searchResults[idx];
  selectedIndices.add(idx);
  document.getElementById('actionBar').style.display='flex';
  document.getElementById('statusLine').style.display='flex';
  if(selectedIndices.size>=2) document.getElementById('compareBtn').style.display='flex';
  renderDetail(selectedResult);
}

function renderDetail(r) {
  var area=document.getElementById('contentArea');
  area.innerHTML=
    '<div class="result-detail">'+
      '<div class="detail-header">'+
        '<div class="detail-meta">'+
          (r.score!=null?'<span class="tag" style="background:var(--amber-dim);color:var(--amber);border:1px solid rgba(245,166,35,0.2)">Score '+r.score+'/100</span>':'')+
          (r.category?'<span class="tag" style="background:var(--bg4);color:var(--text2);border:1px solid var(--border)">'+r.category+'</span>':'')+
          '<span style="font-family:var(--mono);font-size:10px;color:var(--text3)">'+r.source+'</span>'+
        '</div>'+
        '<div class="detail-title">'+r.title+'</div>'+
        '<div class="detail-url"><a href="'+r.url+'" target="_blank">'+r.url+'</a></div>'+
      '</div>'+
      (r.reason?'<div class="divider"></div><div class="section-title">🤖 Relevance</div><div class="snippet-text" style="color:var(--amber);font-style:italic">'+r.reason+'</div>':'')+
      '<div class="divider"></div>'+
      '<div class="section-title">📄 Snippet</div>'+
      '<div class="snippet-text">'+r.snippet+'</div>'+
      (r.summary?'<div class="divider"></div><div class="section-title">📝 AI Summary</div><div class="enriched-content" style="border-color:rgba(91,200,255,0.2)"><pre class="enriched-text" style="font-family:var(--body)">'+r.summary+'</pre></div>':'')+
      (r.enriched?'<div class="divider"></div><div class="section-title">✨ Enriched Content</div><div class="enriched-content"><pre class="enriched-text" style="font-family:var(--body)">'+r.enriched+'</pre></div>':'')+
      (r.timeline?'<div class="divider"></div><div class="section-title">🕐 Timeline</div>'+r.timeline:'')+
    '</div>';
}

// ==========================================
// ENRICH
// ==========================================
async function enrichResult() {
  if(!selectedResult)return;
  if(!workerToken||!backendUrl){openModal('api');return;}
  var btn=document.getElementById('enrichBtn');
  btn.disabled=true;btn.innerHTML='⏳...';
  setStatus('Enriching with AI...');
  try {
    var prompt='Expert researcher. Based on this article, provide enriched content.\n\nTitle: '+selectedResult.title+'\nSource: '+selectedResult.source+'\nSnippet: '+selectedResult.snippet+'\n\nProvide:\n1. **Expanded Context** (3-4 paragraphs)\n2. **5 Key Points**\n3. **Connections to current trends**\n4. **Snippet limitations**';
    selectedResult.enriched=await groqChat([{role:'user',content:prompt}],'Research assistant specialized in information synthesis.',0.6,1500);
    renderDetail(selectedResult);
    setStatus('Enriched ✓');
    toast('Result enriched ✓');
  }catch(e){setStatus('Error: '+e.message);}
  finally{btn.disabled=false;btn.innerHTML='✨ Enrich';}
}

// ==========================================
// SUMMARIZE
// ==========================================
async function summarizeResult() {
  if(!selectedResult)return;
  if(!workerToken||!backendUrl){openModal('api');return;}
  var btn=document.getElementById('summarizeBtn');
  btn.disabled=true;btn.innerHTML='⏳...';
  try {
    selectedResult.summary=await groqChat([{role:'user',content:'Summarize in English (max 150 words):\nTitle: '+selectedResult.title+'\nSource: '+selectedResult.source+'\nContent: '+selectedResult.snippet}],'Expert in executive summaries.',0.5,400);
    renderDetail(selectedResult);
    setStatus('Summary generated ✓');
    toast('Summary ready ✓');
  }catch(e){setStatus('Error: '+e.message);}
  finally{btn.disabled=false;btn.innerHTML='📝 Summarize';}
}

// ==========================================
// ANALYZE ALL
// ==========================================
async function analyzeAll() {
  if(searchResults.length===0)return;
  if(!workerToken||!backendUrl){openModal('api');return;}
  var btn=document.getElementById('analyzeBtn');
  btn.disabled=true;btn.innerHTML='⏳...';
  setStatus('Generating overall analysis...');
  try {
    var prompt='Senior research analyst. Analyze this set of results:\n\n'+
      searchResults.map(function(r,i){return '['+(i+1)+'] '+r.title+' ('+r.source+') — '+r.snippet;}).join('\n\n')+
      '\n\n## 📊 Overview\n[Collective synthesis]\n\n## 🔑 Main Themes\n[3-5 emerging themes]\n\n## 📈 Trends\n[Observed patterns]\n\n## ⚠️ Points of Attention\n[Contradictions and gaps]\n\n## 💡 Deeper Dive\n[What to research next]\n\n## ⭐ Best Sources\n[2-3 most reliable sources]';

    var analysis=await groqChat([{role:'user',content:prompt}],'Multi-source intelligence analyst.',0.7,2000);
    var area=document.getElementById('contentArea');
    area.innerHTML=
      '<div class="result-detail">'+
        '<div class="detail-header">'+
          '<div class="detail-meta">'+
            '<span class="tag" style="background:rgba(181,122,255,0.1);color:var(--purple);border:1px solid rgba(181,122,255,0.2)">Overall Analysis</span>'+
            '<span style="font-family:var(--mono);font-size:10px;color:var(--text3)">'+searchResults.length+' sources</span>'+
          '</div>'+
          '<div class="detail-title">🧠 Analysis — '+document.getElementById('searchQuery').value+'</div>'+
          (window._queryAnalysis?'<div class="snippet-text" style="margin-top:4px;font-style:italic;color:var(--text3)">'+window._queryAnalysis+'</div>':'')+
        '</div>'+
        '<div class="divider"></div>'+
        '<div class="analysis-box">'+
          '<div class="enriched-text" style="font-family:var(--body)">'+formatMd(analysis)+'</div>'+
        '</div>'+
      '</div>';
    setStatus('Analysis complete ✓');
    toast('Analysis generated ✓');
  }catch(e){setStatus('Error: '+e.message);}
  finally{btn.disabled=false;btn.innerHTML='🧠 Overall Analysis';}
}

// ==========================================
// COMPARE
// ==========================================
async function compareSelected() {
  if(selectedIndices.size<2){toast('Select 2+ results','⚠️');return;}
  if(!workerToken||!backendUrl){openModal('api');return;}
  var sel=[...selectedIndices].map(function(i){return searchResults[i];}).filter(Boolean);
  var btn=document.getElementById('compareBtn');
  btn.disabled=true;btn.innerHTML='⏳...';
  try {
    var prompt='Compare these '+sel.length+' results side by side:\n\n'+
      sel.map(function(r,i){return '**['+(i+1)+'] '+r.title+'** ('+r.source+')\n'+r.snippet;}).join('\n\n')+
      '\n\nFor each result, evaluate:\n- Information depth\n- Source credibility\n- Angle/perspective\n- Unique points not covered by the others\n\nFinish with a recommendation on which source to prioritize and why.';
    var result=await groqChat([{role:'user',content:prompt}],'Information source analyst.',0.6,1500);
    var area=document.getElementById('contentArea');
    area.innerHTML=
      '<div class="result-detail">'+
        '<div class="detail-header">'+
          '<div class="detail-meta">'+
            '<span class="tag" style="background:var(--blue-dim);color:var(--blue);border:1px solid rgba(91,200,255,0.2)">Comparison</span>'+
            '<span style="font-family:var(--mono);font-size:10px;color:var(--text3)">'+sel.length+' sources</span>'+
          '</div>'+
          '<div class="detail-title">⚖️ Results Comparison</div>'+
        '</div>'+
        '<div class="divider"></div>'+
        '<div class="analysis-box" style="--before-color:var(--blue)">'+
          '<div class="enriched-text" style="font-family:var(--body)">'+formatMd(result)+'</div>'+
        '</div>'+
      '</div>';
    toast('Comparison generated ✓');
  }catch(e){setStatus('Error: '+e.message);}
  finally{btn.disabled=false;btn.innerHTML='⚖️ Compare';}
}

// ==========================================
// TIMELINE
// ==========================================
async function buildTimeline() {
  if(!selectedResult)return;
  if(!workerToken||!backendUrl){openModal('api');return;}
  var btn=document.getElementById('timelineBtn');
  btn.disabled=true;btn.innerHTML='⏳...';
  try {
    var prompt='Based on the topic "'+selectedResult.title+'" and snippet "'+selectedResult.snippet+'", build a relevant historical timeline in JSON:\n{"events":[{"date":"<year/period>","title":"<title>","description":"<1-2 sentences>","emoji":"<emoji>"}]}\nReturn ONLY the JSON, no markdown. Include 5-8 relevant chronological events.';
    var raw=await groqChat([{role:'user',content:prompt}],'',0.5,800);
    var parsed=JSON.parse(raw.replace(/```json|```/g,'').trim());
    var html='<div class="timeline">'+parsed.events.map(function(e){
      return '<div class="timeline-item">'+
        '<div class="timeline-dot">'+(e.emoji||'📌')+'</div>'+
        '<div class="timeline-content">'+
          '<div class="timeline-date">'+e.date+'</div>'+
          '<div style="font-size:12px;font-weight:500;color:var(--text);margin-bottom:3px">'+e.title+'</div>'+
          '<div class="timeline-text">'+e.description+'</div>'+
        '</div>'+
      '</div>';
    }).join('')+'</div>';
    selectedResult.timeline=html;
    renderDetail(selectedResult);
    toast('Timeline generated ✓');
  }catch(e){setStatus('Error: '+e.message);}
  finally{btn.disabled=false;btn.innerHTML='🕐 Timeline';}
}

// ==========================================
// EXPORT SEARCH
// ==========================================
function generateSearchMarkdown() {
  var q=document.getElementById('searchQuery').value||'Search';
  var date=new Date().toLocaleString('en-US');
  var md='# 🛠️ Worker Research Export\n\n**Query:** '+q+'\n**Date:** '+date+'\n**Results:** '+searchResults.length+'\n\n---\n\n';
  searchResults.forEach(function(r,i){
    md+='## '+(i+1)+'. '+r.title+'\n';
    if(r.score!=null) md+='**Score:** '+r.score+'/100 | **Category:** '+(r.category||'—')+'\n';
    md+='**Source:** '+r.source+'\n**URL:** '+r.url+'\n\n';
    md+='### Snippet\n'+r.snippet+'\n\n';
    if(r.reason) md+='### Relevance\n'+r.reason+'\n\n';
    if(r.summary) md+='### Summary\n'+r.summary+'\n\n';
    if(r.enriched) md+='### Enriched Content\n'+r.enriched+'\n\n';
    md+='---\n\n';
  });
  return md;
}

function exportSearch() { openModal('export-search'); }

// ==========================================
// HELPERS
// ==========================================
function openInTab() { if(selectedResult) window.open(selectedResult.url,'_blank'); }

function formatMd(text) {
  return text
    .replace(/```(\w*)\n([\s\S]*?)```/g,'<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/^## (.*$)/gm,'<br><strong style="color:var(--amber);font-size:13px;font-family:var(--sans);display:block;margin:8px 0 4px">$1</strong>')
    .replace(/^# (.*$)/gm,'<br><strong style="color:var(--text);font-size:15px;font-family:var(--sans);display:block;margin:10px 0 5px">$1</strong>')
    .replace(/\n/g,'<br>');
}

function showSearchLoading() {
  document.getElementById('resultsList').innerHTML='<div class="loading-bar">'+[1,2,3,4,5].map(function(){return '<div><div class="skeleton sk-title" style="margin-bottom:5px"></div><div class="skeleton sk-line w90" style="margin-bottom:3px"></div><div class="skeleton sk-line w60"></div></div>';}).join('')+'</div>';
  document.getElementById('contentArea').innerHTML='<div class="loading-bar"><div class="skeleton" style="height:22px;width:55%;margin-bottom:14px"></div>'+[1,2,3,4].map(function(){return '<div class="skeleton sk-line w90" style="margin-bottom:7px"></div>';}).join('')+'<div class="skeleton sk-line w75" style="margin-bottom:7px"></div><div class="skeleton sk-line w60"></div></div>';
}

function showError(msg) {
  document.getElementById('contentArea').innerHTML='<div class="empty-state"><div class="empty-icon" style="animation:none">⚠️</div><div class="empty-title" style="color:var(--red)">Error</div><div class="empty-sub">'+msg+'</div></div>';
  document.getElementById('resultsList').innerHTML='<div style="padding:16px 14px;text-align:center;font-family:var(--mono);font-size:9px;color:var(--red)">'+msg+'</div>';
}

function setStatus(text,latency) {
  if(latency===undefined) latency='';
  document.getElementById('statusLine').style.display='flex';
  document.getElementById('statusText').textContent=text;
  document.getElementById('latencyText').textContent=latency;
}

// ==========================================
// TOOLS
// ==========================================
var BUILTIN_TOOLS = [
  {id:'default',icon:'💬',name:'Free Chat',desc:'General conversation',color:'#f5a623',system:'You are Worker, a powerful, direct, and helpful AI assistant.',hints:['Explain quantum computing','Write a professional email','Debug my code']},
  {id:'code',icon:'⚡',name:'Code Expert',desc:'Debug & refactoring',color:'#4afa8a',system:'You are a senior software engineer and expert. Analyze, fix, and improve code with detailed explanations. Use markdown for code blocks.',hints:['Review this Python code','Explain this error','Refactor for better performance']},
  {id:'translate',icon:'🌐',name:'Translator Pro',desc:'40+ languages',color:'#5bc8ff',system:'You are a translator specialized in cultural nuances. Automatically detect the source language and translate while preserving tone and context. Provide variations when useful.',hints:['Translate to Spanish','Formal version in French','Translate keeping technical tone']},
  {id:'research',icon:'🔬',name:'Deep Research',desc:'Deep analysis',color:'#b57aff',system:'You are a senior academic researcher. Provide deep analyses, cite multiple perspectives, identify gaps, and propose well-grounded hypotheses.',hints:['Analyze the causes of X','Compare theories about Y','State of the art in Z']},
  {id:'writer',icon:'✍️',name:'Writer Pro',desc:'Creative content',color:'#ff9f43',system:'You are a professional creative writer. Create engaging content, adapting tone, style, and format to the request. Think narrative structure, rhythm, and impact.',hints:['Write an article about X','Create a catchy intro','Rewrite in formal tone']},
  {id:'data',icon:'📊',name:'Data Analyst',desc:'Data & visualization',color:'#fd79a8',system:'You are a data scientist. Analyze data, identify patterns, suggest visualizations, and provide actionable insights. Use markdown tables when useful.',hints:['Analyze this data','Which chart to use for X?','Descriptive stats for Y']},
  {id:'prompt',icon:'🎯',name:'Prompt Engineer',desc:'Optimize prompts',color:'#00cec9',system:'You are an expert in LLM prompt engineering. Analyze, critique, and improve prompts for maximum effectiveness. Explain each improvement.',hints:['Improve this prompt','How to ask Claude X?','Prompt for roleplay of Y']},
  {id:'sql',icon:'🗄️',name:'SQL Master',desc:'Queries & optimization',color:'#6c5ce7',system:'You are a DBA expert in SQL, PostgreSQL, MySQL, and BigQuery. Write, optimize, and explain queries.',hints:['Write a query for X','Optimize this SQL','JOIN between tables A and B']},
  {id:'security',icon:'🔒',name:'Sec Analyst',desc:'Security analysis',color:'#e17055',system:'You are a cybersecurity and ethical hacking expert. Analyze vulnerabilities, explain concepts, and propose solutions. Focus on education.',hints:['Analyze this configuration','What is SQL Injection?','Linux server hardening']},
  {id:'math',icon:'∑',name:'Math Solver',desc:'Equations & proofs',color:'#fdcb6e',system:'You are a math expert. Solve problems step by step and demonstrate rigorous proofs.',hints:['Solve this equation','Prove that X','Explain double integrals']},
  {id:'brainstorm',icon:'🌊',name:'Brainstormer',desc:'Ideas & creativity',color:'#a29bfe',system:'You are a creative facilitator expert in Design Thinking. Generate diverse ideas, explore non-obvious angles. Think laterally.',hints:['10 product ideas for X','How to monetize Y?','Creative name for startup Z']},
  {id:'seo',icon:'📈',name:'SEO & Copy',desc:'Marketing & content',color:'#55efc4',system:'You are an expert in SEO, copywriting, and digital marketing. Create optimized content and strategies that convert.',hints:['Meta description for X','Optimized blog post about Y','CTA for landing page Z']},
];

function getAllTools() { return BUILTIN_TOOLS.concat(customTools); }

function renderTools() {
  var list=document.getElementById('toolsList');
  var all=getAllTools();
  list.innerHTML=all.map(function(t){
    return '<div class="tool-item '+(activeTool&&activeTool.id===t.id?'active':'')+'" onclick="selectTool(\''+t.id+'\')">'+
      '<div class="tool-icon" style="background:'+t.color+'22;border:1px solid '+t.color+'33"><span style="font-size:13px">'+t.icon+'</span></div>'+
      '<div class="tool-info">'+
        '<div class="tool-name">'+t.name+(t.custom?'<span style="font-size:8px;font-family:var(--mono);color:var(--text3);margin-left:4px">custom</span>':'')+'</div>'+
        '<div class="tool-desc">'+t.desc+'</div>'+
      '</div>'+
      (t.custom?'<span onclick="deleteCustomTool(\''+t.id+'\');event.stopPropagation()" style="font-size:10px;color:var(--text3);opacity:0.5;cursor:pointer">✕</span>':'')+
    '</div>'+
    (t.id==='default'?'<div class="tools-divider"></div>':'');
  }).join('');
}

function deleteCustomTool(id) {
  customTools=customTools.filter(function(t){return t.id!==id;});
  localStorage.setItem('worker_customtools',JSON.stringify(customTools));
  if(activeTool&&activeTool.id===id) selectTool('default');
  else renderTools();
  toast('Tool removed');
}

function selectTool(id) {
  activeTool=getAllTools().find(function(t){return t.id===id;});
  renderTools();
  var banner=document.getElementById('toolBanner');
  if(activeTool&&activeTool.id!=='default'){
    banner.style.display='flex';
    document.getElementById('toolBannerIcon').textContent=activeTool.icon+' ';
    document.getElementById('toolBannerName').textContent=activeTool.name;
    document.getElementById('chatHeaderTitle').textContent=activeTool.name;
    // Show tier indicator
    var tierLabel=DEEP_TOOL_IDS.includes(activeTool.id)||activeTool.custom?'🔮 deep':'⚡ normal';
    document.getElementById('toolBannerName').textContent=activeTool.name+' · '+tierLabel;
  } else {
    banner.style.display='none';
    document.getElementById('chatHeaderTitle').textContent='Free Chat';
  }
  updateHints((activeTool&&activeTool.hints)||BUILTIN_TOOLS[0].hints);
  updateApiBadge();
  document.getElementById('chatInput').focus();
}

function clearActiveTool() { selectTool('default'); }

function updateHints(hints) {
  document.getElementById('chatHints').innerHTML=hints.map(function(h){return '<div class="hint-chip" onclick="useHint(\''+h.replace(/'/g,"\\'")+'\')">→ '+h+'</div>';}).join('');
}

function useHint(hint) {
  document.getElementById('chatInput').value=hint;
  autoResize(document.getElementById('chatInput'));
  sendChat();
}

// ==========================================
// CHAT
// ==========================================
function handleChatKey(e) {
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}
}

function autoResize(el) {
  el.style.height='auto';
  el.style.height=Math.min(el.scrollHeight,160)+'px';
}

async function sendChat() {
  var input=document.getElementById('chatInput');
  var msg=input.value.trim();
  if(!msg)return;
  if(!workerToken||!backendUrl){openModal('api');return;}
  input.value=''; autoResize(input);
  document.getElementById('chatSendBtn').disabled=true;
  addMessage('user',msg);
  var thinkId='think-'+Date.now();
  addThinking(thinkId);
  try {
    chatHistory.push({role:'user',content:msg});
    var tool=activeTool||BUILTIN_TOOLS[0];
    var sys=tool.system+'\n\nRespond in English, unless the user writes in a different language.';
    var tier=getTier();
    var result=await workerChat(chatHistory.slice(-20),sys,0.8,2048,tier);
    chatHistory.push({role:'assistant',content:result.content});
    var thinkEl=document.getElementById(thinkId);
    if(thinkEl) thinkEl.remove();
    addMessage('assistant',result.content,tool,result);
    // Auto-append to canvas if open
    if(canvasOpen){
      var cv=document.getElementById('canvasContent');
      cv.innerHTML+=(cv.innerHTML?'\n\n---\n\n':'')+formatMd(result.content);
    }
    // Update badge pill to reflect current tier/provider
    updateApiBadge();
    saveChat();
  }catch(e){
    var thinkEl2=document.getElementById(thinkId);
    if(thinkEl2) thinkEl2.remove();
    addMessage('assistant','⚠️ Error: '+e.message);
  } finally {
    document.getElementById('chatSendBtn').disabled=false;
    input.focus();
  }
}

function addMessage(role,content,tool,meta) {
  var msgs=document.getElementById('chatMessages');
  var now=new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  var toolBadge=tool&&tool.id!=='default'?'<span class="tool-used-badge" style="background:'+tool.color+'22;color:'+tool.color+';border:1px solid '+tool.color+'33">'+tool.icon+' '+tool.name+'</span>':'';
  // Provider badge for assistant messages
  var providerBadge='';
  if(role==='assistant'&&meta&&meta.provider){
    var pColor=meta.provider==='sambanova'?'var(--purple)':'var(--blue)';
    var pLabel=meta.provider==='sambanova'
      ? (meta.fallback?'⚡ Groq 70b (fallback)':'🔮 SambaNova DeepSeek V3')
      : (meta.fallback?'⚡ Groq 70b (fallback)':'⚡ Groq 70b');
    providerBadge='<span style="font-family:var(--mono);font-size:9px;color:'+pColor+';opacity:0.8">'+pLabel+'</span>';
  }
  var formatted=formatMd(content);
  var div=document.createElement('div');
  div.className='msg '+role;
  var msgId='msg-'+Date.now();
  div.innerHTML=
    '<div class="msg-avatar">'+(role==='user'?'U':'W')+'</div>'+
    '<div style="flex:1;min-width:0">'+
      '<div class="msg-bubble" id="'+msgId+'">'+formatted+'</div>'+
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:3px">'+
        '<div class="msg-meta">'+(role==='user'?'You':'Worker')+' · '+now+' '+toolBadge+' '+providerBadge+'</div>'+
        (role==='assistant'?'<div class="msg-actions"><button class="msg-action-btn" onclick="copyToClipboard(getPlainText(\''+msgId+'\'));toast(\'Copied!\')">📋</button><button class="msg-action-btn" onclick="sendToCanvas(\''+msgId+'\')">📄 Canvas</button></div>':'')+
      '</div>'+
    '</div>';
  msgs.appendChild(div);
  msgs.scrollTop=msgs.scrollHeight;
}

function getPlainText(id) {
  var el=document.getElementById(id);
  return el?el.innerText:'';
}

function sendToCanvas(msgId) {
  if(!canvasOpen) toggleCanvas();
  var cv=document.getElementById('canvasContent');
  var text=getPlainText(msgId);
  cv.innerHTML+=(cv.innerHTML?'\n\n---\n\n':'')+text;
  toast('Sent to Canvas ✓');
}

function addThinking(id) {
  var msgs=document.getElementById('chatMessages');
  var div=document.createElement('div');
  div.className='msg assistant'; div.id=id;
  div.innerHTML='<div class="msg-avatar">W</div><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div><span style="margin-left:6px">thinking...</span></div>';
  msgs.appendChild(div);
  msgs.scrollTop=msgs.scrollHeight;
}

function clearChat() {
  chatHistory=[];
  document.getElementById('chatMessages').innerHTML=
    '<div class="msg assistant">'+
      '<div class="msg-avatar">W</div>'+
      '<div><div class="msg-bubble">Chat cleared. Ready for a new conversation! 🛠️</div><div class="msg-meta">Worker · just now</div></div>'+
    '</div>';
  toast('Chat cleared ✓');
}

function saveChat() {
  localStorage.setItem('worker_chat', JSON.stringify(chatHistory.slice(-40)));
}

function exportChat() {
  var lines=chatHistory.map(function(m){return '**'+(m.role==='user'?'You':'Worker')+':** '+m.content;}).join('\n\n---\n\n');
  var md='# 💬 Worker Chat Export\n\n**Date:** '+new Date().toLocaleString('en-US')+'\n**Tool:** '+(activeTool?activeTool.name:'Free Chat')+'\n\n---\n\n'+lines;
  downloadFile('chat-worker.md',md);
  toast('Chat exported ✓');
}

// ==========================================
// CANVAS
// ==========================================
function toggleCanvas() {
  canvasOpen=!canvasOpen;
  document.getElementById('canvasPanel').classList.toggle('open',canvasOpen);
  document.getElementById('canvasToggleBtn').classList.toggle('active',canvasOpen);
}

function clearCanvas() {
  document.getElementById('canvasContent').innerHTML='';
  toast('Canvas cleared');
}

function copyCanvas() {
  copyToClipboard(document.getElementById('canvasContent').innerText);
  toast('Canvas copied ✓');
}

function exportCanvasFile() {
  downloadFile('canvas-worker.md',document.getElementById('canvasContent').innerText);
  toast('Canvas exported ✓');
}

// ==========================================
// VOICE
// ==========================================
function toggleVoice() {
  if(!('webkitSpeechRecognition' in window||'SpeechRecognition' in window)){toast('Your browser does not support voice ⚠️');return;}
  var btn=document.getElementById('voiceBtn');
  if(isListening){
    if(recognition) recognition.stop();
    isListening=false; btn.classList.remove('listening');
    return;
  }
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  recognition=new SR();
  recognition.lang='en-US';
  recognition.continuous=false;
  recognition.interimResults=false;
  recognition.onresult=function(e){
    var t=e.results[0][0].transcript;
    document.getElementById('chatInput').value=t;
    autoResize(document.getElementById('chatInput'));
    sendChat();
  };
  recognition.onerror=function(){isListening=false;btn.classList.remove('listening');};
  recognition.onend=function(){isListening=false;btn.classList.remove('listening');};
  recognition.start();
  isListening=true; btn.classList.add('listening');
  toast('🎤 Listening...');
}

// ==========================================
// COMMAND BAR
// ==========================================
var CMD_ACTIONS = [
  {icon:'🔍',label:'New Search',desc:'Go to Research Hub',kbd:'',action:function(){switchTab('search');document.getElementById('searchQuery').focus();}},
  {icon:'💬',label:'New Chat',desc:'Clear and start conversation',kbd:'',action:function(){switchTab('chat');clearChat();}},
  {icon:'📄',label:'Open Canvas',desc:'Toggle side canvas',kbd:'',action:function(){switchTab('chat');if(!canvasOpen)toggleCanvas();}},
  {icon:'⬇',label:'Export Search',desc:'Download results as .md',kbd:'',action:function(){if(searchResults.length)exportSearch();else toast('Search something first','⚠️');}},
  {icon:'⬇',label:'Export Chat',desc:'Download conversation as .md',kbd:'',action:exportChat},
  {icon:'☀️',label:'Toggle Theme',desc:'Dark / Light',kbd:'',action:toggleTheme},
  {icon:'⚙️',label:'Settings',desc:'Configure backend URL and token',kbd:'',action:function(){openModal('api');}},
  {icon:'🗑',label:'Clear Chat',desc:'Delete conversation history',kbd:'',action:clearChat},
  {icon:'🧠',label:'Overall Analysis',desc:'Analyze all results',kbd:'',action:analyzeAll},
].concat(getAllTools().map(function(t){return {icon:t.icon,label:t.name,desc:'Activate tool: '+t.desc,kbd:'',action:function(){switchTab('chat');selectTool(t.id);}};}));

function openCmd() {
  document.getElementById('cmdOverlay').classList.add('open');
  document.getElementById('cmdInput').value='';
  cmdFocusIdx=-1;
  renderCmdResults();
  setTimeout(function(){document.getElementById('cmdInput').focus();},50);
}

function closeCmd() {
  document.getElementById('cmdOverlay').classList.remove('open');
}

function renderCmdResults() {
  var q=document.getElementById('cmdInput').value.toLowerCase().trim();
  var el=document.getElementById('cmdResults');

  // Recent history search
  var histItems=[];
  if(searchHistory.length){
    histItems=searchHistory.slice(0,5).filter(function(h){return !q||h.query.toLowerCase().includes(q);}).map(function(h){return {
      icon:'🕐',label:h.query,desc:h.results+' results · '+timeAgo(h.date),kbd:'',
      action:function(){switchTab('search');loadHistory(h.query);}
    };});
  }

  var filtered=CMD_ACTIONS.concat(getAllTools().slice(BUILTIN_TOOLS.length).map(function(t){return {icon:t.icon,label:t.name,desc:t.desc,kbd:'',action:function(){switchTab('chat');selectTool(t.id);}};}))
    .filter(function(c){return !q||c.label.toLowerCase().includes(q)||c.desc.toLowerCase().includes(q);});

  cmdItems=histItems.concat(filtered);
  cmdFocusIdx=-1;

  var html='';
  if(histItems.length&&!q){
    html+='<div class="cmd-section-label">Recent History</div>';
    html+=histItems.map(function(c,i){return cmdItemHtml(c,i);}).join('');
    html+='<div class="cmd-section-label">Actions</div>';
    html+=filtered.map(function(c,i){return cmdItemHtml(c,i+histItems.length);}).join('');
  } else {
    if(histItems.length) html+=histItems.map(function(c,i){return cmdItemHtml(c,i);}).join('');
    html+=filtered.map(function(c,i){return cmdItemHtml(c,i+histItems.length);}).join('');
  }

  if(!html) html='<div style="padding:20px;text-align:center;font-family:var(--mono);font-size:10px;color:var(--text3)">No results for "'+q+'"</div>';
  el.innerHTML=html;
}

function cmdItemHtml(c,i) {
  return '<div class="cmd-item" id="cmd-'+i+'" onclick="execCmd('+i+')">'+
    '<div class="cmd-item-icon" style="background:var(--bg4)">'+c.icon+'</div>'+
    '<span class="cmd-item-label">'+c.label+'</span>'+
    '<span class="cmd-item-desc">'+c.desc+'</span>'+
    (c.kbd?'<span class="cmd-item-kbd">'+c.kbd+'</span>':'')+
  '</div>';
}

function execCmd(i) {
  if(cmdItems[i]) cmdItems[i].action();
  closeCmd();
}

function handleCmdKey(e) {
  if(e.key==='Escape'){closeCmd();return;}
  if(e.key==='ArrowDown'){e.preventDefault();cmdFocusIdx=Math.min(cmdFocusIdx+1,cmdItems.length-1);highlightCmd();}
  else if(e.key==='ArrowUp'){e.preventDefault();cmdFocusIdx=Math.max(cmdFocusIdx-1,0);highlightCmd();}
  else if(e.key==='Enter'&&cmdFocusIdx>=0){execCmd(cmdFocusIdx);}
}

function highlightCmd() {
  document.querySelectorAll('.cmd-item').forEach(function(el,i){el.classList.toggle('focused',i===cmdFocusIdx);});
  var focused=document.getElementById('cmd-'+cmdFocusIdx);
  if(focused) focused.scrollIntoView({block:'nearest'});
}

// ==========================================
// KEYBOARD SHORTCUTS
// ==========================================
document.addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();openCmd();}
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&document.getElementById('panel-search').classList.contains('active')){e.preventDefault();runSearch();}
  if(e.key==='/'&&document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='TEXTAREA'){
    e.preventDefault();
    if(document.getElementById('panel-search').classList.contains('active')) document.getElementById('searchQuery').focus();
    else document.getElementById('chatInput').focus();
  }
  if(e.key==='Escape'){
    closeCmd();closeModal();
    if(document.getElementById('cmdOverlay').classList.contains('open'))closeCmd();
  }
});

// ==========================================
// UTILS
// ==========================================
function toast(msg,icon) {
  if(!icon) icon='✓';
  var el=document.getElementById('toast');
  el.innerHTML='<span style="color:var(--amber)">'+icon+'</span> '+msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t=setTimeout(function(){el.classList.remove('show');},2500);
}

function copyToClipboard(text) {
  if(navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(function(){
      var ta=document.createElement('textarea');
      ta.value=text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    });
  } else {
    var ta=document.createElement('textarea');
    ta.value=text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}

function downloadFile(name,content) {
  var a=document.createElement('a');
  a.href='data:text/plain;charset=utf-8,'+encodeURIComponent(content);
  a.download=name; a.click();
}

// ==========================================
// INIT
// ==========================================
updateApiBadge();
renderTools();
renderHistory();
selectTool('default');

// Restore chat
var savedChat=localStorage.getItem('worker_chat');
if(savedChat){
  try{chatHistory=JSON.parse(savedChat);}catch(e){}
}

// Backend pre-configured — no setup required

// ==========================================
// PRODUCTIVITY STATE
// ==========================================
var calDate = new Date();
var calView = 'month';
var calSelectedDate = new Date();
var calEvents = JSON.parse(localStorage.getItem('worker_events') || '[]');
var tasks = JSON.parse(localStorage.getItem('worker_tasks') || '[]');
var activeProdPanel = 'calendar';
var emailTones = { write:'formal', reply:'formal', improve:'formal' };
var mtgOutputType = 'agenda';
var docType = 'geral';
var mtgParticipants = [];
var lastEmailMode = 'write';
var notifDismissed = JSON.parse(localStorage.getItem('worker_notif_dismissed') || '[]');

// ==========================================
// PROD NAV
// ==========================================
function switchProd(panel) {
  activeProdPanel = panel;
  ['calendar','tasks','email','meeting','docreview'].forEach(function(p) {
    var nav=document.getElementById('pnav-'+p);
    if(nav) nav.classList.toggle('active', p===panel);
    var el = document.getElementById('ppanel-'+p);
    if(el) el.style.display = p===panel ? 'block' : 'none';
  });
  if(panel==='calendar') renderCalendar();
  if(panel==='tasks') renderTasks();
}

// ==========================================
// CALENDAR ENGINE
// ==========================================
var MONTHS_PT = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var DOWS_PT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var EVENT_COLORS = ['#f5a623','#4afa8a','#5bc8ff','#b57aff','#ff9f43','#fd79a8','#e17055'];

function calNav(dir) {
  if(calView==='month') calDate = new Date(calDate.getFullYear(), calDate.getMonth()+dir, 1);
  else { calDate = new Date(calDate); calDate.setDate(calDate.getDate() + dir*7); }
  renderCalendar();
}

function calToday() { calDate = new Date(); calSelectedDate = new Date(); renderCalendar(); }

function setCalView(v) { calView=v; ['month','week'].forEach(function(x){var el=document.getElementById('cvt-'+x);if(el)el.classList.toggle('active',x===v);}); renderCalendar(); }

function saveEvents() { localStorage.setItem('worker_events', JSON.stringify(calEvents)); checkNotifications(); }

function renderCalendar() {
  renderMiniCal();
  renderMainCal();
  renderDayEvents();
}

function renderMiniCal() {
  var y=calDate.getFullYear(), m=calDate.getMonth();
  document.getElementById('calMiniTitle').textContent = MONTHS_PT[m]+' '+y;
  document.getElementById('calBigTitle').textContent = calView==='month'
    ? MONTHS_PT[m]+' '+y
    : 'Week of '+getWeekStart(calDate).toLocaleDateString('en-US');

  var dowEl = document.getElementById('calMiniDows');
  dowEl.innerHTML = DOWS_PT.map(function(d){return '<div class="cal-dow">'+d[0]+'</div>';}).join('');

  var first = new Date(y,m,1).getDay();
  var days = new Date(y,m+1,0).getDate();
  var today = new Date();
  var html='';
  for(var i=0;i<first;i++) html+='<div class="cal-day other-month"></div>';
  for(var d=1;d<=days;d++){
    var dt=new Date(y,m,d);
    var isToday=sameDay(dt,today);
    var isSel=sameDay(dt,calSelectedDate);
    var ev=calEvents.filter(function(e){return sameDay(new Date(e.date),dt);});
    var hasEv=ev.some(function(e){return e.type==='event';});
    var hasTask=ev.some(function(e){return e.type==='task';});
    var cls=[isToday?'today':'',isSel?'selected':'',hasEv&&hasTask?'has-both':hasEv?'has-event':hasTask?'has-task':''].join(' ');
    html+='<div class="cal-day '+cls+'" onclick="selectCalDay('+y+','+m+','+d+')">'+d+'</div>';
  }
  document.getElementById('calMiniGrid').innerHTML=html;
}

function renderMainCal() {
  var grid=document.getElementById('calMainGrid');
  if(calView==='month') renderMonthView(grid);
  else renderWeekView(grid);
}

function renderMonthView(grid) {
  var y=calDate.getFullYear(), m=calDate.getMonth();
  var first=new Date(y,m,1).getDay();
  var days=new Date(y,m+1,0).getDate();
  var today=new Date();
  var html='<div class="month-grid">';
  html+=DOWS_PT.map(function(d){return '<div class="month-dow">'+d+'</div>';}).join('');
  // prev month filler
  var prevDays=new Date(y,m,0).getDate();
  for(var i=first-1;i>=0;i--) {
    var d2=prevDays-i;
    html+='<div class="month-cell other-month"><div class="month-cell-num">'+d2+'</div></div>';
  }
  for(var d=1;d<=days;d++){
    var dt=new Date(y,m,d);
    var isToday=sameDay(dt,today);
    var ev=calEvents.filter(function(e){return sameDay(new Date(e.date),dt);});
    var evHtml=ev.slice(0,3).map(function(e){return '<div class="month-event" style="background:'+e.color+'22;color:'+(e.color||'var(--amber)')+';border-left:2px solid '+(e.color||'var(--amber)')+'" onclick="event.stopPropagation();viewEvent(\''+e.id+'\')" title="'+e.title+'">'+e.title+'</div>';}).join('');
    if(ev.length>3) evHtml+='<div style="font-family:var(--mono);font-size:9px;color:var(--text3);padding:1px 3px">+'+(ev.length-3)+' more</div>';
    html+='<div class="month-cell '+(isToday?'today':'')+'" onclick="selectCalDay('+y+','+m+','+d+')">'+
      '<div class="month-cell-num">'+d+'</div>'+evHtml+
    '</div>';
  }
  // fill rest
  var total=first+days;
  var remaining=(7-total%7)%7;
  for(var d3=1;d3<=remaining;d3++) html+='<div class="month-cell other-month"><div class="month-cell-num">'+d3+'</div></div>';
  html+='</div>';
  grid.innerHTML=html;
}

function renderWeekView(grid) {
  var weekStart=getWeekStart(calDate);
  var today=new Date();
  var html='<div class="week-grid">';
  html+='<div class="week-dow" style="background:var(--bg2)"></div>';
  for(var d=0;d<7;d++){
    var dt=new Date(weekStart); dt.setDate(dt.getDate()+d);
    var isToday=sameDay(dt,today);
    html+='<div class="week-dow '+(isToday?'today-col':'')+'">'+DOWS_PT[d]+'<br><span style="font-size:13px;font-weight:700">'+dt.getDate()+'</span></div>';
  }
  for(var h=6;h<23;h++){
    html+='<div class="week-time">'+String(h).padStart(2,'0')+':00</div>';
    for(var d2=0;d2<7;d2++){
      var dt2=new Date(weekStart); dt2.setDate(dt2.getDate()+d2);
      var ev=calEvents.filter(function(e){
        var ed=new Date(e.date);
        return sameDay(ed,dt2)&&ed.getHours()===h;
      });
      var evHtml=ev.map(function(e){return '<div class="week-event" style="background:'+(e.color||'var(--amber)')+'22;color:'+(e.color||'var(--amber)')+';border-left:2px solid '+(e.color||'var(--amber)')+'" onclick="event.stopPropagation();viewEvent(\''+e.id+'\')">'+e.title+'</div>';}).join('');
      html+='<div class="week-cell" onclick="selectCalDay('+dt2.getFullYear()+','+dt2.getMonth()+','+dt2.getDate()+')">'+evHtml+'</div>';
    }
  }
  html+='</div>';
  grid.innerHTML=html;
}

function getWeekStart(d) {
  var dt=new Date(d); dt.setDate(dt.getDate()-dt.getDay()); return dt;
}

function sameDay(a,b) {
  return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
}

function selectCalDay(y,m,d) {
  calSelectedDate=new Date(y,m,d);
  renderMiniCal();
  renderDayEvents();
}

function renderDayEvents() {
  var el=document.getElementById('calEventsList');
  var ev=calEvents.filter(function(e){return sameDay(new Date(e.date),calSelectedDate);});
  var dateStr=calSelectedDate.toLocaleDateString('en-US',{weekday:'long',day:'numeric',month:'long'});
  if(ev.length===0){
    el.innerHTML='<div class="cal-events-title">'+dateStr+'</div><div style="padding:12px 10px;font-family:var(--mono);font-size:10px;color:var(--text3)">No events</div>';
    return;
  }
  el.innerHTML='<div class="cal-events-title">'+dateStr+'</div>'+ev.map(function(e){
    return '<div class="cal-event-chip" style="border-left-color:'+(e.color||'var(--amber)')+'" onclick="viewEvent(\''+e.id+'\')">'+
      '<div class="ev-title">'+e.title+'</div>'+
      '<div class="ev-time">'+new Date(e.date).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})+(e.duration?' · '+e.duration:'')+'</div>'+
      '<div class="ev-type" style="color:'+(e.color||'var(--amber)')+'">'+  (e.type==='task'?'✅ Task':'📅 Event')+'</div>'+
    '</div>';
  }).join('');
}

function viewEvent(id) {
  var ev=calEvents.find(function(e){return e.id===id;});
  if(!ev) return;
  var box=document.getElementById('modalBox');
  box.innerHTML=
    '<div class="modal-title">'+ev.title+'</div>'+
    '<div style="font-family:var(--mono);font-size:10px;color:var(--amber);margin-bottom:14px">'+new Date(ev.date).toLocaleString('en-US')+(ev.duration?' · '+ev.duration:'')+'</div>'+
    (ev.description?'<div style="font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:14px">'+ev.description+'</div>':'')+
    (ev.participants&&ev.participants.length?'<div style="font-family:var(--mono);font-size:10px;color:var(--text3);margin-bottom:10px">👥 '+ev.participants.join(', ')+'</div>':'')+
    '<div class="modal-actions">'+
      '<button class="btn btn-red" onclick="deleteEvent(\''+id+'\');closeModal()">🗑 Delete</button>'+
      '<button class="btn btn-ghost" onclick="closeModal()">Close</button>'+
    '</div>';
  document.getElementById('modalOverlay').classList.add('open');
}

function deleteEvent(id) {
  calEvents=calEvents.filter(function(e){return e.id!==id;});
  saveEvents(); renderCalendar(); toast('Event removed');
}

function openNewEventModal() {
  var box=document.getElementById('modalBox');
  var dateStr=calSelectedDate.toISOString().split('T')[0];
  var colorOpts=EVENT_COLORS.map(function(c){return '<div onclick="this.parentNode.querySelectorAll(\'div\').forEach(function(x){x.style.outline=\'none\'});this.style.outline=\'2px solid white\'" style="width:20px;height:20px;border-radius:50%;background:'+c+';cursor:pointer;transition:all 0.1s" data-color="'+c+'"></div>';}).join('');
  box.innerHTML=
    '<div class="modal-title">📅 New Event</div>'+
    '<div class="modal-label">Title</div>'+
    '<input class="modal-input" id="ne-title" placeholder="Ex: Planning meeting">'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
      '<div><div class="modal-label">Date</div><input type="date" class="modal-input" id="ne-date" value="'+dateStr+'"></div>'+
      '<div><div class="modal-label">Time</div><input type="time" class="modal-input" id="ne-time" value="09:00"></div>'+
    '</div>'+
    '<div class="modal-label">Duration</div>'+
    '<select class="modal-input" id="ne-duration" style="cursor:pointer"><option>30 min</option><option selected>1 hour</option><option>2 hours</option><option>All day</option></select>'+
    '<div class="modal-label">Description</div>'+
    '<textarea class="modal-input" id="ne-desc" rows="2" style="resize:none" placeholder="Optional details…"></textarea>'+
    '<div class="modal-label">Color</div>'+
    '<div style="display:flex;gap:6px;margin-bottom:14px" id="colorPicker">'+colorOpts+'</div>'+
    '<div class="modal-actions">'+
      '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="saveNewEvent()">✓ Save</button>'+
    '</div>';
  document.getElementById('modalOverlay').classList.add('open');
  // Pre-select first color
  setTimeout(function(){var first=document.querySelector('#colorPicker div');if(first)first.style.outline='2px solid white';},50);
}

function saveNewEvent() {
  var title=document.getElementById('ne-title').value.trim();
  if(!title){toast('Title is required','⚠️');return;}
  var date=document.getElementById('ne-date').value;
  var time=document.getElementById('ne-time').value;
  var dur=document.getElementById('ne-duration').value;
  var desc=document.getElementById('ne-desc').value.trim();
  var selColor=document.querySelector('#colorPicker div[style*="outline: 2px"]');
  var color=selColor?selColor.dataset.color:EVENT_COLORS[0];
  var ev={
    id:'ev-'+Date.now(), title:title, type:'event',
    date:new Date(date+'T'+time).toISOString(),
    duration:dur, description:desc, color:color
  };
  calEvents.push(ev);
  saveEvents(); renderCalendar(); closeModal();
  toast('Event saved ✓');
  scheduleNotifications();
}

// ==========================================
// NOTIFICATIONS
// ==========================================
function checkNotifications() {
  var now=new Date();
  var alerts=[];
  calEvents.forEach(function(ev){
    var evDate=new Date(ev.date);
    var diffDays=Math.ceil((evDate-now)/(1000*60*60*24));
    [7,3,1,0].forEach(function(d){
      var key=ev.id+'-'+d;
      if(!notifDismissed.includes(key)){
        if(d===0 && sameDay(evDate,now)) alerts.push({key:key,ev:ev,label:'Today!',color:'var(--red)',urgency:0});
        else if(d===1 && diffDays===1) alerts.push({key:key,ev:ev,label:'Tomorrow',color:'var(--amber)',urgency:1});
        else if(d===3 && diffDays===3) alerts.push({key:key,ev:ev,label:'In 3 days',color:'var(--blue)',urgency:2});
        else if(d===7 && diffDays===7) alerts.push({key:key,ev:ev,label:'In 7 days',color:'var(--green)',urgency:3});
      }
    });
  });
  renderNotifications(alerts);
  return alerts;
}

function renderNotifications(alerts) {
  var list=document.getElementById('notifList');
  var count=document.getElementById('notifBellCount');
  var countEl=document.getElementById('notifCount');
  if(!alerts.length){
    list.innerHTML='<div style="padding:16px;text-align:center;font-family:var(--mono);font-size:10px;color:var(--text3)">No notifications</div>';
    count.style.display='none';
    if(countEl) countEl.textContent='';
    return;
  }
  count.style.display='flex';
  count.textContent=alerts.length;
  if(countEl) countEl.textContent=alerts.length+' pending';
  list.innerHTML=alerts.map(function(a){
    return '<div class="notif-item">'+
      '<div class="notif-dot" style="background:'+a.color+'"></div>'+
      '<div style="flex:1">'+
        '<div class="notif-item-title">'+a.ev.title+'</div>'+
        '<div class="notif-item-sub">'+a.label+' · '+new Date(a.ev.date).toLocaleDateString('en-US',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+'</div>'+
      '</div>'+
      '<button class="btn btn-ghost" style="font-size:9px;padding:2px 6px" onclick="dismissNotif(\''+a.key+'\')">✕</button>'+
    '</div>';
  }).join('');
}

function dismissNotif(key) {
  notifDismissed.push(key);
  localStorage.setItem('worker_notif_dismissed',JSON.stringify(notifDismissed));
  checkNotifications();
}

function toggleNotifPanel() {
  var p=document.getElementById('notifPanel');
  p.classList.toggle('show');
}

function scheduleNotifications() {
  checkNotifications();
}

// ==========================================
// TASKS
// ==========================================
function saveTasks() { localStorage.setItem('worker_tasks',JSON.stringify(tasks)); }

function addTask() {
  var input=document.getElementById('taskInput');
  var title=input.value.trim();
  if(!title) return;
  var priority=document.getElementById('taskPriority').value;
  var dateVal=document.getElementById('taskDate').value;
  var task={id:'t-'+Date.now(),title:title,priority:priority,date:dateVal||null,done:false,subtasks:[]};
  tasks.unshift(task);
  saveTasks(); renderTasks(); input.value='';
  // Add to calendar if date set
  if(dateVal){
    var ev={id:'ev-task-'+task.id,title:'✅ '+title,type:'task',date:new Date(dateVal+'T09:00').toISOString(),color:priority==='high'?'#ff5f57':priority==='mid'?'#f5a623':'#4afa8a'};
    calEvents.push(ev); saveEvents();
    toast('Task added and saved to calendar 📅');
  } else {
    toast('Task added ✓');
  }
}

function renderTasks() {
  var el=document.getElementById('taskList');
  if(!tasks.length){
    el.innerHTML='<div style="text-align:center;padding:32px;font-family:var(--mono);font-size:10px;color:var(--text3)">No tasks. Add one above or use AI to decompose a goal.</div>';
    return;
  }
  var pending=tasks.filter(function(t){return !t.done;});
  var done=tasks.filter(function(t){return t.done;});
  var html='';
  if(pending.length){
    html+='<div class="task-group"><div class="task-group-title">Pending ('+pending.length+')</div>'+pending.map(function(t){return taskHtml(t);}).join('')+'</div>';
  }
  if(done.length){
    html+='<div class="task-group"><div class="task-group-title">Completed ('+done.length+')</div>'+done.map(function(t){return taskHtml(t);}).join('')+'</div>';
  }
  el.innerHTML=html;
}

function taskHtml(t) {
  var pClass=t.priority==='high'?'p-high':t.priority==='mid'?'p-mid':'p-low';
  var pLabel=t.priority==='high'?'High':t.priority==='mid'?'Medium':'Low';
  var subtasksHtml=t.subtasks&&t.subtasks.length?'<div class="subtask-list">'+t.subtasks.map(function(s,si){
    return '<div class="subtask-item" onclick="toggleSubtask(\''+t.id+'\','+si+')">'+
      '<div class="subtask-check" style="'+(s.done?'background:var(--green);border-color:var(--green);color:#000':'')+'">'+
        (s.done?'✓':'')+
      '</div>'+
      '<span style="'+(s.done?'text-decoration:line-through;opacity:0.5':'')+'">'+s.title+'</span>'+
    '</div>';
  }).join('')+'</div>':'';
  return '<div class="task-item '+(t.done?'done':'')+'">'+
    '<div class="task-check" onclick="toggleTask(\''+t.id+'\')">'+(t.done?'✓':'')+'</div>'+
    '<div class="task-body">'+
      '<div class="task-title">'+t.title+'</div>'+
      '<div class="task-meta">'+
        '<span class="task-priority '+pClass+'">'+pLabel+'</span>'+
        (t.date?'<span>📅 '+new Date(t.date+'T12:00').toLocaleDateString('en-US')+'</span>':'')+
        (t.subtasks&&t.subtasks.length?'<span>'+t.subtasks.filter(function(s){return s.done;}).length+'/'+t.subtasks.length+' subtasks</span>':'')+
      '</div>'+
      subtasksHtml+
    '</div>'+
    '<span class="task-del" onclick="deleteTask(\''+t.id+'\')">✕</span>'+
  '</div>';
}

function toggleTask(id) {
  var t=tasks.find(function(x){return x.id===id;});
  if(t){t.done=!t.done;saveTasks();renderTasks();}
}

function toggleSubtask(taskId,si) {
  var t=tasks.find(function(x){return x.id===taskId;});
  if(t&&t.subtasks[si]){t.subtasks[si].done=!t.subtasks[si].done;saveTasks();renderTasks();}
}

function deleteTask(id) {
  tasks=tasks.filter(function(x){return x.id!==id;});
  calEvents=calEvents.filter(function(e){return e.id!=='ev-task-'+id;});
  saveTasks();saveEvents();renderTasks();toast('Task removed');
}

function clearDoneTasks() {
  var doneIds=tasks.filter(function(t){return t.done;}).map(function(t){return t.id;});
  tasks=tasks.filter(function(t){return !t.done;});
  doneIds.forEach(function(id){ calEvents=calEvents.filter(function(e){return e.id!=='ev-task-'+id;}); });
  saveTasks();saveEvents();renderTasks();toast('Completed tasks cleared');
}

function aiDecomposeTask() {
  var area=document.getElementById('decomposeInputArea');
  area.style.display=area.style.display==='none'?'block':'none';
}

async function runDecompose() {
  var goal=document.getElementById('decomposeGoal').value.trim();
  if(!goal||!workerToken||!backendUrl){if(!workerToken||!backendUrl)openModal('api');return;}
  var btn=document.getElementById('decomposeBtn');
  btn.disabled=true;btn.innerHTML='⏳...';
  try {
    var resp=await groqChat([{role:'user',content:'Break down this goal into concrete, actionable tasks: "'+goal+'"\n\nRespond ONLY in JSON:\n{"tasks":[{"title":"<task>","priority":"high|mid|low","subtasks":["<subtask1>","<subtask2>"]}]}'}],'',0.5,800);
    var parsed=JSON.parse(resp.replace(/```json|```/g,'').trim());
    parsed.tasks.forEach(function(t,i){
      var task={
        id:'t-'+Date.now()+i, title:t.title, priority:t.priority||'mid',
        date:null, done:false,
        subtasks:(t.subtasks||[]).map(function(s){return {title:s,done:false};})
      };
      tasks.unshift(task);
    });
    saveTasks();renderTasks();
    document.getElementById('decomposeInputArea').style.display='none';
    document.getElementById('decomposeGoal').value='';
    toast(parsed.tasks.length+' tasks created ✓');
  }catch(e){toast('Error decomposing: '+e.message,'⚠️');}
  finally{btn.disabled=false;btn.innerHTML='🧠 AI Decompose';}
}

// ==========================================
// EMAIL
// ==========================================
function setEmailMode(mode) {
  lastEmailMode=mode;
  ['write','reply','improve'].forEach(function(m){
    var tab=document.getElementById('etab-'+m);
    if(tab) tab.classList.toggle('active',m===mode);
    var form=document.getElementById('email-form-'+m);
    if(form) form.style.display=m===mode?'flex':'none';
  });
  document.getElementById('emailResult').style.display='none';
}

function setTone(mode,tone) {
  emailTones[mode]=tone;
  var prefix=mode==='write'?'ew':mode==='reply'?'er':'ei';
  document.querySelectorAll('#'+prefix+'-tones .tone-chip').forEach(function(el){
    el.classList.toggle('active',el.textContent.toLowerCase()===tone);
  });
}

async function generateEmail(mode) {
  if(!workerToken||!backendUrl){openModal('api');return;}
  var btnId='email'+mode.charAt(0).toUpperCase()+mode.slice(1)+'Btn';
  var btn=document.getElementById(btnId);
  btn.disabled=true;btn.innerHTML='⏳ Generating...';
  try {
    var prompt='';
    var tone=emailTones[mode];
    if(mode==='write'){
      var subject=document.getElementById('ew-subject').value.trim();
      var context=document.getElementById('ew-context').value.trim();
      if(!subject||!context){toast('Fill in subject and context','⚠️');return;}
      prompt='Write a professional email.\n\nSubject/Goal: '+subject+'\nContext: '+context+'\nTone: '+tone+'\n\nWrite ONLY the email (From: Subject: + body), without additional explanations.';
    } else if(mode==='reply'){
      var original=document.getElementById('er-original').value.trim();
      var intent=document.getElementById('er-intent').value.trim();
      if(!original){toast('Paste the received email','⚠️');return;}
      prompt='Write a reply to the email below.\n\nReceived email:\n'+original+'\n\nReply intent: '+(intent||'Reply appropriately')+'\nTone: '+tone+'\n\nWrite ONLY the reply (email body), without explanations.';
    } else {
      var orig=document.getElementById('ei-original').value.trim();
      var focus=document.getElementById('ei-focus').value.trim();
      if(!orig){toast('Paste the email to improve','⚠️');return;}
      prompt='Improve this email.\n\nOriginal email:\n'+orig+'\n\nImprovement focus: '+(focus||'Clarity, conciseness and professionalism')+'\nDesired tone: '+tone+'\n\nReturn ONLY the improved email.';
    }
    var result=await groqChat([{role:'user',content:prompt}],'You are an expert in corporate communication and professional writing.',0.7,1000);
    document.getElementById('emailResultText').textContent=result;
    document.getElementById('emailResult').style.display='block';
    document.getElementById('emailResult').scrollIntoView({behavior:'smooth'});
  }catch(e){toast('Error: '+e.message,'⚠️');}
  finally{btn.disabled=false;btn.innerHTML=mode==='write'?'⚡ Generate Email':mode==='reply'?'↩️ Generate Reply':'✨ Improve Email';}
}

function regenerateEmail() { generateEmail(lastEmailMode); }

// ==========================================
// MEETING
// ==========================================
function setMtgOutput(type) {
  mtgOutputType=type;
  ['agenda','ata','followup','invite'].forEach(function(t){
    var el=document.getElementById('mout-'+t);
    if(el) el.classList.toggle('active',t===type);
  });
}

function addParticipant() {
  var input=document.getElementById('mtg-participant');
  var name=input.value.trim();
  if(!name) return;
  mtgParticipants.push(name);
  renderParticipants();
  input.value='';
}

function removeParticipant(i) {
  mtgParticipants.splice(i,1);
  renderParticipants();
}

function renderParticipants() {
  document.getElementById('mtgParticipants').innerHTML=
    mtgParticipants.map(function(p,i){return '<div class="participant-tag">'+p+'<button onclick="removeParticipant('+i+')">✕</button></div>';}).join('');
}

async function generateMeeting() {
  if(!workerToken||!backendUrl){openModal('api');return;}
  var title=document.getElementById('mtg-title').value.trim();
  var date=document.getElementById('mtg-date').value;
  var time=document.getElementById('mtg-time').value;
  var duration=document.getElementById('mtg-duration').value;
  var agenda=document.getElementById('mtg-agenda').value.trim();
  if(!title||!agenda){toast('Title and agenda are required','⚠️');return;}
  var btn=document.getElementById('mtgGenBtn');
  btn.disabled=true;btn.innerHTML='⏳...';
  try {
    var outputLabels={agenda:'detailed agenda',ata:'meeting minutes template',followup:'post-meeting follow-up email',invite:'meeting invitation'};
    var prompt='Generate a '+outputLabels[mtgOutputType]+' for this meeting:\n\nTitle: '+title+'\nDate: '+(date?new Date(date+'T12:00').toLocaleDateString('en-US'):'TBD')+' at '+time+'\nDuration: '+duration+'\nParticipants: '+(mtgParticipants.join(', ')||'TBD')+'\nAgenda/Goal: '+agenda+'\n\nGenerate a professional and complete document.';
    var result=await groqChat([{role:'user',content:prompt}],'You are an expert in meeting management and corporate communication.',0.7,1500);
    document.getElementById('meetingResultText').textContent=result;
    document.getElementById('meetingResult').style.display='block';
    document.getElementById('meetingResult').scrollIntoView({behavior:'smooth'});
  }catch(e){toast('Error: '+e.message,'⚠️');}
  finally{btn.disabled=false;btn.innerHTML='⚡ Generate';}
}

function saveMeetingToCalendar() {
  var title=document.getElementById('mtg-title').value.trim();
  var date=document.getElementById('mtg-date').value;
  var time=document.getElementById('mtg-time').value;
  var duration=document.getElementById('mtg-duration').value;
  var agenda=document.getElementById('mtg-agenda').value.trim();
  if(!title||!date){toast('Title and date are required to save','⚠️');return;}
  var ev={
    id:'ev-mtg-'+Date.now(), title:'🤝 '+title, type:'event',
    date:new Date(date+'T'+time).toISOString(),
    duration:duration, description:agenda,
    participants:mtgParticipants.slice(),
    color:'#5bc8ff'
  };
  calEvents.push(ev); saveEvents();
  toast('Meeting saved to calendar ✓');
  scheduleNotifications();
}

// ==========================================
// DOC REVIEW
// ==========================================
function setDocType(type) {
  docType=type;
  ['geral','juridico','tecnico','contrato','relatorio','academico'].forEach(function(t){
    var el=document.getElementById('dtype-'+t);
    if(el) el.classList.toggle('active',t===type);
  });
}

function handleDocFile(e) {
  var file=e.target.files[0];
  if(!file) return;
  var reader=new FileReader();
  reader.onload=function(ev){ document.getElementById('docText').value=ev.target.result; toast('File loaded ✓'); };
  reader.readAsText(file);
}

function handleDocDrop(e) {
  e.preventDefault();
  document.getElementById('docDrop').classList.remove('dragover');
  var file=e.dataTransfer.files[0];
  if(!file) return;
  var reader=new FileReader();
  reader.onload=function(ev){ document.getElementById('docText').value=ev.target.result; toast('File loaded ✓'); };
  reader.readAsText(file);
}

async function reviewDoc() {
  var text=document.getElementById('docText').value.trim();
  if(!text){toast('Paste the document or upload a file','⚠️');return;}
  if(!workerToken||!backendUrl){openModal('api');return;}
  var btn=document.getElementById('docReviewBtn');
  btn.disabled=true;btn.innerHTML='⏳ Analyzing...';
  var typeLabels={geral:'general review',juridico:'legal analysis',tecnico:'technical review',contrato:'contract analysis',relatorio:'report review',academico:'academic review'};
  try {
    var prompt='Perform a professional and detailed '+typeLabels[docType]+' of this document.\n\nDocument:\n'+text.slice(0,6000)+'\n\nRespond ONLY in JSON:\n{\n  "summary": "<executive summary in 2-3 sentences>",\n  "score": <overall score 0-100>,\n  "issues": [{"title":"<issue>","description":"<details>","severity":"critical|warning|info","suggestion":"<correction suggestion>"}],\n  "strengths": ["<strength 1>","<strength 2>"],\n  "recommendations": ["<recommendation 1>","<recommendation 2>","<recommendation 3>"]\n}';
    var raw=await groqChat([{role:'user',content:prompt}],'You are a professional reviewer and specialist.',0.4,2000);
    var parsed=JSON.parse(raw.replace(/```json|```/g,'').trim());
    renderDocReview(parsed);
  }catch(e){
    // fallback: render raw text
    var resultEl=document.getElementById('docReviewResult');
    resultEl.style.display='block';
    resultEl.innerHTML='<div class="doc-review-card"><div class="doc-review-card-header">📄 Analysis</div><div class="doc-review-card-body" style="white-space:pre-wrap">'+e.message+'</div></div>';
    toast('Parse error, showing raw text','⚠️');
  }
  finally{btn.disabled=false;btn.innerHTML='🔍 Analyze Document';}
}

function renderDocReview(data) {
  var resultEl=document.getElementById('docReviewResult');
  resultEl.style.display='block';
  var scoreColor=data.score>=75?'var(--green)':data.score>=50?'var(--amber)':'var(--red)';
  var sevMap={critical:{cls:'sev-critical',icon:'🚨'},warning:{cls:'sev-warning',icon:'⚠️'},info:{cls:'sev-info',icon:'ℹ️'}};
  var html=
    '<div class="doc-review-card">'+
      '<div class="doc-review-card-header">📊 Executive Summary <span class="severity-badge" style="background:'+scoreColor+'22;color:'+scoreColor+';border:1px solid '+scoreColor+'44">Score '+data.score+'/100</span></div>'+
      '<div class="doc-review-card-body">'+data.summary+'</div>'+
    '</div>';
  if(data.strengths&&data.strengths.length){
    html+='<div class="doc-review-card"><div class="doc-review-card-header">✅ Strengths <span class="severity-badge sev-ok">'+data.strengths.length+'</span></div><div class="doc-review-card-body"><ul style="padding-left:16px">'+data.strengths.map(function(s){return '<li style="margin-bottom:4px">'+s+'</li>';}).join('')+'</ul></div></div>';
  }
  if(data.issues&&data.issues.length){
    html+='<div class="doc-review-card"><div class="doc-review-card-header">🔍 Issues Found <span class="severity-badge sev-warning">'+data.issues.length+'</span></div><div class="doc-review-card-body">'+data.issues.map(function(issue){
      var s=sevMap[issue.severity]||sevMap.info;
      return '<div style="margin-bottom:14px;padding:10px;background:var(--bg4);border-radius:5px;border-left:3px solid '+(issue.severity==='critical'?'var(--red)':issue.severity==='warning'?'var(--amber)':'var(--blue)')+'">'+
        '<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px">'+
          '<span>'+s.icon+'</span>'+
          '<strong style="font-size:12px">'+issue.title+'</strong>'+
          '<span class="severity-badge '+s.cls+'" style="margin-left:auto">'+issue.severity+'</span>'+
        '</div>'+
        '<div style="font-size:12px;color:var(--text2);margin-bottom:5px">'+issue.description+'</div>'+
        (issue.suggestion?'<div style="font-size:11px;color:var(--green);font-family:var(--mono)">💡 '+issue.suggestion+'</div>':'')+
      '</div>';
    }).join('')+'</div></div>';
  }
  if(data.recommendations&&data.recommendations.length){
    html+='<div class="doc-review-card"><div class="doc-review-card-header">💡 Recommendations</div><div class="doc-review-card-body"><ol style="padding-left:16px">'+data.recommendations.map(function(r){return '<li style="margin-bottom:6px">'+r+'</li>';}).join('')+'</ol></div></div>';
  }
  resultEl.innerHTML=html;
  resultEl.scrollIntoView({behavior:'smooth'});
  toast('Analysis complete ✓');
}

// ==========================================
// NOTIFICATION INIT
// ==========================================
// Check every 5 minutes
scheduleNotifications();
setInterval(scheduleNotifications, 5*60*1000);
