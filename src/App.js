import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

// ── Text extraction utilities ──────────────────────────────────────────────

async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n\n';
  }
  return text.trim();
}

import * as mammoth from 'mammoth';

async function extractTextFromDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

async function extractTextFromTxt(file) {
  return await file.text();
}

async function extractText(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return await extractTextFromPDF(file);
  if (ext === 'docx' || ext === 'doc') return await extractTextFromDocx(file);
  if (ext === 'txt' || ext === 'md') return await extractTextFromTxt(file);
  throw new Error(`Unsupported file type: .${ext}`);
}

// ── Chunking ──────────────────────────────────────────────────────────────

function chunkText(text, chunkSize = 1200, overlap = 150) {
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let current = '';
  for (const para of paragraphs) {
    if ((current + para).length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      const words = current.split(' ');
      current = words.slice(-Math.floor(overlap / 6)).join(' ') + '\n\n' + para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 80);
}

// ── Retrieval: find most relevant chunks ─────────────────────────────────

function scoreChunk(chunk, query) {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const chunkLower = chunk.toLowerCase();
  let score = 0;
  for (const word of queryWords) {
    const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = (chunkLower.match(regex) || []).length;
    score += matches * (word.length > 6 ? 2 : 1);
  }
  // Boost exact phrase match
  if (chunkLower.includes(query.toLowerCase().substring(0, 30))) score += 10;
  return score;
}

function retrieveRelevantChunks(docs, query, topK = 8) {
  const allChunks = [];
  for (const doc of docs) {
    if (!doc.chunks) continue;
    for (const chunk of doc.chunks) {
      allChunks.push({ chunk, docName: doc.name, score: scoreChunk(chunk, query) });
    }
  }
  return allChunks
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ── Format AI response text into paragraphs ────────────────────────────────

function FormattedMessage({ text }) {
  const lines = text.split('\n').filter(l => l.trim());
  const elements = [];
  let listItems = [];

  const flushList = () => {
    if (listItems.length) {
      elements.push(<ul key={`ul-${elements.length}`}>{listItems}</ul>);
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[\-\*•]\s+/.test(line)) {
      listItems.push(<li key={i}>{line.replace(/^[\-\*•]\s+/, '')}</li>);
    } else if (/^\d+\.\s+/.test(line)) {
      listItems.push(<li key={i}>{line.replace(/^\d+\.\s+/, '')}</li>);
    } else {
      flushList();
      if (line.startsWith('**') && line.endsWith('**')) {
        elements.push(<p key={i}><strong>{line.slice(2, -2)}</strong></p>);
      } else {
        elements.push(<p key={i}>{line}</p>);
      }
    }
  }
  flushList();
  return <>{elements}</>;
}

// ── File type helpers ──────────────────────────────────────────────────────

function getDocIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'pdf') return { label: 'PDF', cls: 'pdf' };
  if (ext === 'docx' || ext === 'doc') return { label: 'DOC', cls: 'docx' };
  return { label: 'TXT', cls: 'txt' };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Suggestions ────────────────────────────────────────────────────────────

const PERSONA_CONFIG = {
  sales: {
    label: 'Sales',
    color: '#0F2A4A',
    description: 'Answers framed for prospects — latest version, value, and positioning',
    suggestions: [
      'What are the key differentiators of Northern Light?',
      'How does NL handle enterprise search at scale?',
      'What integrations and APIs are supported?',
      'What security and compliance certifications does NL hold?',
      'What does a typical deployment look like?',
      'What is the ROI story for new customers?',
    ],
    systemPrompt: `You are a Sales assistant for Northern Light, an enterprise knowledge management platform. Answer questions based strictly on the provided document excerpts, framed for a sales context.
- Always answer based on the latest/current version of the product
- Frame answers around customer value and business outcomes
- Be specific and cite which document(s) your answer comes from
- Keep answers concise and customer-ready (2-4 paragraphs)
- If a capability is not in the documents, say so clearly rather than speculating`,
  },
  product: {
    label: 'Product',
    color: '#1A5FA8',
    description: 'Answers focused on patterns, gaps, and insights across the corpus',
    suggestions: [
      'What feature requests or pain points appear most often?',
      'What changed between product versions?',
      'What topics are covered across these documents?',
      'What gaps or missing capabilities are mentioned?',
      'What customer use cases are described?',
      'Summarize key themes across all uploaded documents',
    ],
    systemPrompt: `You are a Product Intelligence assistant for Northern Light. Analyze the provided document excerpts to surface insights, patterns, and themes.
- Look for recurring themes, feature requests, and pain points across documents
- Note version differences and how the product has evolved
- Identify gaps — things customers ask about that are not well documented
- Synthesize across multiple documents rather than answering from just one
- Be analytical — this audience wants insights, not just answers
- Cite which documents support your observations`,
  },
};

// ── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  const [docs, setDocs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState('server');
  const [apiKeyValid, setApiKeyValid] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [ratings, setRatings] = useState({});
  const [persona, setPersona] = useState('sales');

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    
  }, [apiKey]);

  const processFiles = useCallback(async (files) => {
    const newDocs = [...files].map(file => ({
      id: `${Date.now()}-${Math.random()}`,
      name: file.name,
      size: file.size,
      status: 'processing',
      chunks: null,
      error: null,
      file,
    }));

    setDocs(prev => [...prev, ...newDocs]);

    for (const doc of newDocs) {
      try {
        await new Promise(res => setTimeout(res, 100)); // let UI update
        const text = await extractText(doc.file);
        const chunks = chunkText(text);
        setDocs(prev => prev.map(d =>
          d.id === doc.id ? { ...d, status: 'ready', chunks, charCount: text.length } : d
        ));
      } catch (err) {
        setDocs(prev => prev.map(d =>
          d.id === doc.id ? { ...d, status: 'error', error: err.message } : d
        ));
      }
    }
  }, []);

  const handleFileChange = (e) => {
    if (e.target.files?.length) processFiles(e.target.files);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files);
  };

  const removeDoc = (id) => setDocs(prev => prev.filter(d => d.id !== id));

  const readyDocs = docs.filter(d => d.status === 'ready');



  const sendMessage = async (text) => {
    const question = (text || input).trim();
    if (!question || loading) return;
    
    if (readyDocs.length === 0) { setError('Please upload at least one document first.'); return; }

    setError('');
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: question, id: Date.now() }]);
    setLoading(true);

    try {
      const relevant = retrieveRelevantChunks(readyDocs, question);
      const sourceNames = [...new Set(relevant.map(r => r.docName))];

      const contextText = relevant.length > 0
        ? relevant.map((r, i) => `[Source: ${r.docName}]\n${r.chunk}`).join('\n\n---\n\n')
        : readyDocs.map(d => d.chunks?.slice(0, 3).join('\n\n') || '').join('\n\n---\n\n');

      const systemPrompt = PERSONA_CONFIG[persona].systemPrompt;

      const userPrompt = `Here are relevant excerpts from Northern Light's internal documents:

${contextText}

---

Question: ${question}

Please answer based on the document excerpts above. If you reference specific information, mention which document it came from.`;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          
          
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `API error ${res.status}`);
      }

      const data = await res.json();
      const answer = data.content?.[0]?.text || 'No response received.';
      const msgId = Date.now();

      setMessages(prev => [...prev, {
        role: 'ai',
        text: answer,
        sources: sourceNames,
        id: msgId,
      }]);
    } catch (err) {
      setError(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleRating = (msgId, value) => {
    setRatings(prev => ({ ...prev, [msgId]: prev[msgId] === value ? null : value }));
  };

  const hasContent = messages.length > 0;

  return (
    <div className="app">
      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-brand">
          <div className="topbar-logo">
            <img src="/Webclip%20white.png" alt="Northern Light" style={{width:36,height:36,objectFit:'contain'}} />
          </div>
          <div>
            <div className="topbar-title">Northern Light</div>
            <div className="topbar-subtitle">Knowledge Hub · POC</div>
          </div>
        </div>
        <div className="topbar-right">
          <div className="persona-switcher">
            {Object.entries(PERSONA_CONFIG).map(([key, cfg]) => (
              <button
                key={key}
                className={"persona-btn" + (persona === key ? ' active' : '')}
                style={persona === key ? {background: cfg.color, color: '#fff', borderColor: cfg.color} : {}}
                onClick={() => setPersona(key)}
              >
                {cfg.label}
              </button>
            ))}
          </div>
          {readyDocs.length > 0 && (
            <span className="doc-count-badge">
              {readyDocs.length} doc{readyDocs.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      <div className="main-layout">
        {/* Left panel */}
        <aside className="left-panel">
          {/* API Status */}
          <div className="panel-section">
            <div className="api-key-status valid" style={{marginTop: 0}}>✓ AI powered by Claude</div>
          </div>

          {/* Upload */}
          <div className="panel-section">
            <div className="section-label">Upload Documents</div>
            <div
              className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt,.md"
                multiple
                onChange={handleFileChange}
              />
              <div className="upload-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <div className="upload-title">Drop files or click to upload</div>
              <div className="upload-sub">PDF, Word, or plain text</div>
            </div>
          </div>

          {/* Document list */}
          {docs.length > 0 && (
            <div className="doc-list">
              {docs.map(doc => {
                const icon = getDocIcon(doc.name);
                return (
                  <div className="doc-item" key={doc.id}>
                    <div className={`doc-item-icon ${icon.cls}`}>{icon.label}</div>
                    <div className="doc-item-info">
                      <div className="doc-item-name" title={doc.name}>{doc.name}</div>
                      <div className="doc-item-meta">
                        {doc.status === 'ready' && `${formatBytes(doc.size)} · ${doc.chunks?.length || 0} chunks`}
                        {doc.status === 'processing' && 'Processing…'}
                        {doc.status === 'error' && `Error: ${doc.error}`}
                      </div>
                    </div>
                    <div className={`doc-item-status ${doc.status}`} title={doc.status} />
                    <button className="doc-remove" onClick={() => removeDoc(doc.id)} title="Remove">✕</button>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* Right panel — chat */}
        <main className="right-panel">
          {!hasContent ? (
            <div className="empty-state">
              <div className="empty-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--navy)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </div>
              <div className="empty-title">Ask your documents anything</div>
              <div className="persona-badge" style={{background: PERSONA_CONFIG[persona].color}}>
                {PERSONA_CONFIG[persona].label} view
              </div>
              <div className="empty-sub">
                {PERSONA_CONFIG[persona].description}. Upload documents on the left then ask a question.
              </div>
              {readyDocs.length > 0 && (
                <div className="suggestion-grid">
                  {PERSONA_CONFIG[persona].suggestions.map((s, i) => (
                    <button key={i} className="suggestion-card" onClick={() => sendMessage(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="chat-messages">
              {messages.map(msg => (
                <div key={msg.id} className={`message ${msg.role}`}>
                  <div className={`message-avatar ${msg.role}`}>
                    {msg.role === 'ai' ? 'NL' : 'You'}
                  </div>
                  <div className="message-body">
                    <div className="message-bubble">
                      {msg.role === 'ai'
                        ? <FormattedMessage text={msg.text} />
                        : <p>{msg.text}</p>
                      }
                    </div>
                    {msg.role === 'ai' && msg.sources?.length > 0 && (
                      <div className="sources-row">
                        {msg.sources.map((s, i) => (
                          <span key={i} className="source-chip">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                            </svg>
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    {msg.role === 'ai' && (
                      <div className="rating-row">
                        <span className="rating-label">Helpful?</span>
                        <button
                          className={`rating-btn ${ratings[msg.id] === 'up' ? 'active-up' : ''}`}
                          onClick={() => handleRating(msg.id, 'up')}
                        >👍</button>
                        <button
                          className={`rating-btn ${ratings[msg.id] === 'down' ? 'active-down' : ''}`}
                          onClick={() => handleRating(msg.id, 'down')}
                        >👎</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="message ai">
                  <div className="message-avatar ai">NL</div>
                  <div className="message-body">
                    <div className="message-bubble">
                      <div className="loading-dots">
                        <span/><span/><span/>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Errors / warnings */}
          {error && (
            <div className="error-banner">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {error}
              <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14 }}>✕</button>
            </div>
          )}

          {hasContent && readyDocs.length === 0 && !loading && (
            <div className="no-docs-warning">
              ⚠ No documents loaded — upload files on the left to enable Q&A
            </div>
          )}

          {/* Input */}
          <div className="chat-input-area">
            <div className="chat-input-row">
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                placeholder={readyDocs.length === 0
                  ? 'Upload documents first, then ask a question…'
                  : 'Ask a question about your documents…'
                }
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={loading}
              />
              <button
                className="send-btn"
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                title="Send (Enter)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
            <div className="input-hint">
              Enter to send · Shift+Enter for new line · Answers grounded in your documents only
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
