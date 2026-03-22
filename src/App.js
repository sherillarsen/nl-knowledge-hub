import React, { useState, useRef, useEffect } from 'react';
import * as mammoth from 'mammoth';

const ARTIFACT_TYPES = [
  'Release Notes',
  'Demo Transcript',
  'Training Transcript',
  'White Paper',
  'Positioning Material',
  'Case Study',
  'Technical Documentation',
  'Network Diagram / Architecture',
  'Security / SOC Report',
  'Compliance Documentation',
  'RFP Response',
  'Other',
];

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;

function chunkText(text, filename, type) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push({ text: text.slice(start, end), source: filename, type });
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

function scoreChunk(chunk, query) {
  const q = query.toLowerCase();
  const t = chunk.text.toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 3);
  let score = 0;
  for (const word of words) {
    const count = (t.match(new RegExp(word, 'g')) || []).length;
    score += count;
  }
  return score;
}

function getRelevantChunks(chunks, query, topK = 8) {
  return chunks
    .map(c => ({ ...c, score: scoreChunk(c, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(c => c.score > 0);
}

async function extractTextFromFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'txt' || ext === 'md') {
    return await file.text();
  }
  if (ext === 'pdf') {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text;
  }
  if (ext === 'docx') {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }
  throw new Error(`Unsupported file type: .${ext}`);
}

const styles = {
  app: { fontFamily: "'DM Sans', sans-serif", minHeight: '100vh', background: '#f8f7f4', color: '#1a1a18' },
  header: { background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.08)', padding: '0 32px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 },
  logoRow: { display: 'flex', alignItems: 'center', gap: 10 },
  logoMark: { width: 30, height: 30, background: '#0F2A4A', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  logoText: { fontFamily: "'DM Serif Display', serif", fontSize: 16, color: '#0F2A4A', lineHeight: 1.1 },
  logoSub: { fontSize: 10, color: '#888', letterSpacing: '0.08em', textTransform: 'uppercase' },
  docCount: { fontSize: 12, color: '#888', background: '#f0ede8', padding: '3px 10px', borderRadius: 100 },
  layout: { display: 'flex', height: 'calc(100vh - 56px)' },
  sidebar: { width: 280, flexShrink: 0, background: '#fff', borderRight: '1px solid rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  sidebarHead: { padding: '16px 16px 8px', fontSize: 11, fontWeight: 500, color: '#999', letterSpacing: '0.07em', textTransform: 'uppercase' },
  uploadZone: { margin: '0 12px', border: '1.5px dashed rgba(0,0,0,0.15)', borderRadius: 10, padding: '16px 12px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s', background: 'transparent' },
  typeSelect: { margin: '8px 12px 0', width: 'calc(100% - 24px)', fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', color: '#1a1a18', outline: 'none' },
  docList: { flex: 1, overflowY: 'auto', padding: '8px 12px', marginTop: 8 },
  docItem: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8, marginBottom: 4, background: '#f8f7f4', border: '1px solid rgba(0,0,0,0.06)' },
  docName: { fontSize: 12, fontWeight: 500, color: '#1a1a18', wordBreak: 'break-word', lineHeight: 1.3 },
  docType: { fontSize: 10, color: '#888', marginTop: 2 },
  docRemove: { marginLeft: 'auto', fontSize: 14, color: '#ccc', cursor: 'pointer', flexShrink: 0, background: 'none', border: 'none', padding: 0, lineHeight: 1 },
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  chatArea: { flex: 1, overflowY: 'auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 16 },
  emptyState: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, opacity: 0.5, padding: 40, textAlign: 'center' },
  emptyTitle: { fontFamily: "'DM Serif Display', serif", fontSize: 20, color: '#0F2A4A' },
  emptySub: { fontSize: 13, color: '#888', maxWidth: 320, lineHeight: 1.5 },
  suggestionRow: { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 8 },
  suggestionPill: { padding: '7px 14px', borderRadius: 100, border: '1px solid rgba(0,0,0,0.12)', fontSize: 12, cursor: 'pointer', background: '#fff', color: '#444', transition: 'all 0.1s' },
  msgRow: { display: 'flex', gap: 10, alignItems: 'flex-start', maxWidth: 760 },
  msgRowUser: { alignSelf: 'flex-end', flexDirection: 'row-reverse', maxWidth: 600 },
  avatar: { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, flexShrink: 0 },
  avatarAI: { background: '#0F2A4A', color: '#fff' },
  avatarUser: { background: '#dbeafe', color: '#1A5FA8' },
  bubble: { padding: '10px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.6, color: '#1a1a18', background: '#fff', border: '1px solid rgba(0,0,0,0.07)', maxWidth: '100%' },
  bubbleUser: { background: '#0F2A4A', color: '#fff', border: 'none' },
  sources: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  sourceChip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 100, fontSize: 11, background: '#eef3fb', color: '#1A5FA8', border: '1px solid rgba(26,95,168,0.15)' },
  ratingRow: { display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' },
  ratingLabel: { fontSize: 11, color: '#aaa' },
  ratingBtn: { fontSize: 14, cursor: 'pointer', background: 'none', border: 'none', padding: '2px 4px', borderRadius: 4, opacity: 0.5, transition: 'opacity 0.1s' },
  loadingDots: { display: 'flex', gap: 4, alignItems: 'center', padding: '2px 0' },
  inputArea: { padding: '16px 32px 20px', background: '#fff', borderTop: '1px solid rgba(0,0,0,0.07)' },
  inputRow: { display: 'flex', gap: 8, alignItems: 'flex-end', background: '#f8f7f4', borderRadius: 12, border: '1px solid rgba(0,0,0,0.1)', padding: '8px 12px' },
  textarea: { flex: 1, border: 'none', background: 'transparent', fontSize: 13, fontFamily: "'DM Sans', sans-serif", color: '#1a1a18', resize: 'none', outline: 'none', lineHeight: 1.5, maxHeight: 120, minHeight: 22 },
  sendBtn: { width: 32, height: 32, borderRadius: 8, background: '#0F2A4A', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendBtnDisabled: { opacity: 0.35, cursor: 'default' },
  processingBadge: { fontSize: 11, color: '#1A5FA8', background: '#eef3fb', padding: '2px 8px', borderRadius: 100, marginLeft: 8 },
  noResults: { background: '#fff8ed', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400e' },
};

const FILE_ICONS = { pdf: '📄', docx: '📝', doc: '📝', txt: '📃', md: '📃', default: '📎' };
function fileIcon(name) { const ext = name.split('.').pop().toLowerCase(); return FILE_ICONS[ext] || FILE_ICONS.default; }

function LoadingDots() {
  return (
    <div style={styles.loadingDots}>
      {[0,1,2].map(i => (
        <div key={i} style={{ width:6, height:6, borderRadius:'50%', background:'#aaa', animation:'bounce 1s infinite', animationDelay:`${i*0.15}s` }}/>
      ))}
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0);opacity:0.5}40%{transform:translateY(-4px);opacity:1}}`}</style>
    </div>
  );
}

export default function App() {
  const [docs, setDocs] = useState([]);
  const [chunks, setChunks] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedType, setSelectedType] = useState(ARTIFACT_TYPES[0]);
  const [ratings, setRatings] = useState({});
  const fileInputRef = useRef();
  const chatRef = useRef();
  const apiKey = process.env.REACT_APP_ANTHROPIC_API_KEY;

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages, loading]);

  async function handleFiles(files) {
    const newDocs = [], newChunks = [];
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['pdf','docx','doc','txt','md'].includes(ext)) { alert(`Unsupported: .${ext}`); continue; }
      setProcessing(file.name);
      try {
        const text = await extractTextFromFile(file);
        const fc = chunkText(text, file.name, selectedType);
        newDocs.push({ name: file.name, type: selectedType, chunks: fc.length });
        newChunks.push(...fc);
      } catch(e) { alert(`Could not process ${file.name}: ${e.message}`); }
    }
    setProcessing(null);
    if (newDocs.length) { setDocs(p => [...p, ...newDocs]); setChunks(p => [...p, ...newChunks]); }
  }

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    setMessages(p => [...p, { role:'user', content:text }]);
    setInput('');
    setLoading(true);
    if (chunks.length === 0) {
      setMessages(p => [...p, { role:'assistant', content:'No documents uploaded yet. Please upload some documents first.', sources:[], noResults:false }]);
      setLoading(false); return;
    }
    const relevant = getRelevantChunks(chunks, text, 8);
    if (relevant.length === 0) {
      setMessages(p => [...p, { role:'assistant', content:"I couldn't find information related to that question in the uploaded documents.", sources:[], noResults:true }]);
      setLoading(false); return;
    }
    const contextText = relevant.map((c,i) => `[Source ${i+1}: ${c.source} — ${c.type}]\n${c.text}`).join('\n\n---\n\n');
    const uniqueSources = [...new Set(relevant.map(c => c.source))];
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          model:'claude-sonnet-4-20250514',
          max_tokens:1024,
          system:'You are the Northern Light Knowledge Hub assistant. Answer questions using ONLY the document excerpts provided. Be specific and cite which documents support your answer. If the documents do not contain enough information, say so clearly.',
          messages:[{ role:'user', content:`Here are relevant excerpts:\n\n${contextText}\n\n---\n\nQuestion: ${text}` }]
        })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      const answer = data.content?.[0]?.text || 'No response received.';
      setMessages(p => [...p, { role:'assistant', content:answer, sources:uniqueSources, noResults:false }]);
    } catch(e) {
      setMessages(p => [...p, { role:'assistant', content:`Error: ${e.message}. Check your API key in Vercel environment variables.`, sources:[], noResults:false }]);
    }
    setLoading(false);
  }

  const canSend = input.trim().length > 0 && !loading;

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.logoRow}>
          <div style={styles.logoMark}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="#7BB8F0" strokeWidth="1.5"/>
              <path d="M4.5 8L8 4.5L11.5 8L8 11.5Z" fill="#7BB8F0"/>
              <circle cx="8" cy="8" r="2" fill="white"/>
            </svg>
          </div>
          <div>
            <div style={styles.logoText}>Northern Light</div>
            <div style={styles.logoSub}>Knowledge Hub POC</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {processing && <span style={styles.processingBadge}>Processing {processing}…</span>}
          {docs.length > 0 && <span style={styles.docCount}>{docs.length} doc{docs.length!==1?'s':''} · {chunks.length} chunks</span>}
        </div>
      </header>
      <div style={styles.layout}>
        <div style={styles.sidebar}>
          <div style={styles.sidebarHead}>Documents</div>
          <select style={styles.typeSelect} value={selectedType} onChange={e => setSelectedType(e.target.value)}>
            {ARTIFACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{...styles.uploadZone, margin:'8px 12px 0', ...(dragOver?{borderColor:'#1A5FA8',background:'#f0f6ff'}:{})}}
            onClick={() => fileInputRef.current.click()}
            onDragOver={e=>{e.preventDefault();setDragOver(true)}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{e.preventDefault();setDragOver(false);handleFiles(Array.from(e.dataTransfer.files))}}>
            <div style={{fontSize:22,marginBottom:6}}>📎</div>
            <div style={{fontSize:13,fontWeight:500}}>Drop files or click to upload</div>
            <div style={{fontSize:11,color:'#999',marginTop:3}}>PDF · DOCX · TXT · MD</div>
          </div>
          <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.doc,.txt,.md" style={{display:'none'}} onChange={e=>handleFiles(Array.from(e.target.files))}/>
          <div style={styles.docList}>
            {docs.length===0 && <div style={{fontSize:12,color:'#bbb',textAlign:'center',marginTop:16}}>No documents yet</div>}
            {docs.map(doc => (
              <div key={doc.name} style={styles.docItem}>
                <span style={{fontSize:16,flexShrink:0,marginTop:1}}>{fileIcon(doc.name)}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={styles.docName}>{doc.name}</div>
                  <div style={styles.docType}>{doc.type} · {doc.chunks} chunks</div>
                </div>
                <button style={styles.docRemove} onClick={()=>{setDocs(p=>p.filter(d=>d.name!==doc.name));setChunks(p=>p.filter(c=>c.source!==doc.name));}}>×</button>
              </div>
            ))}
          </div>
        </div>
        <div style={styles.main}>
          <div ref={chatRef} style={styles.chatArea}>
            {messages.length===0 && (
              <div style={styles.emptyState}>
                <div style={{fontSize:36}}>🔍</div>
                <div style={styles.emptyTitle}>Ask anything about your documents</div>
                <div style={styles.emptySub}>Upload Northern Light documents on the left, then ask questions. The system will find relevant information and cite its sources.</div>
                {docs.length>0 && (
                  <div style={styles.suggestionRow}>
                    {['What are the key features of the latest release?','How does the system handle security and compliance?','What integration options are available?','Summarize the main topics in these documents'].map(s=>(
                      <button key={s} style={styles.suggestionPill} onClick={()=>sendMessage(s)}>{s}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {messages.map((msg,i) => (
              <div key={i} style={{...styles.msgRow,...(msg.role==='user'?styles.msgRowUser:{})}}>
                <div style={{...styles.avatar,...(msg.role==='user'?styles.avatarUser:styles.avatarAI)}}>{msg.role==='user'?'You':'NL'}</div>
                <div>
                  <div style={{...styles.bubble,...(msg.role==='user'?styles.bubbleUser:{})}}>
                    {msg.noResults?<div style={styles.noResults}>{msg.content}</div>:<div style={{whiteSpace:'pre-wrap'}}>{msg.content}</div>}
                  </div>
                  {msg.role==='assistant'&&msg.sources?.length>0&&(
                    <div style={styles.sources}>{msg.sources.map(s=><span key={s} style={styles.sourceChip}>📄 {s}</span>)}</div>
                  )}
                  {msg.role==='assistant'&&!msg.noResults&&(
                    <div style={styles.ratingRow}>
                      <span style={styles.ratingLabel}>Helpful?</span>
                      {['👍','👎'].map(e=>(
                        <button key={e} style={{...styles.ratingBtn,opacity:ratings[i]===e?1:0.4}} onClick={()=>setRatings(r=>({...r,[i]:e}))}>{e}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading&&<div style={styles.msgRow}><div style={{...styles.avatar,...styles.avatarAI}}>NL</div><div style={styles.bubble}><LoadingDots/></div></div>}
          </div>
          <div style={styles.inputArea}>
            <div style={styles.inputRow}>
              <textarea style={styles.textarea} value={input}
                onChange={e=>{setInput(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px'}}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage(input)}}}
                placeholder={docs.length===0?'Upload documents first, then ask a question…':'Ask a question about your documents…'}
                rows={1} disabled={loading}/>
              <button style={{...styles.sendBtn,...(canSend?{}:styles.sendBtnDisabled)}} onClick={()=>sendMessage(input)} disabled={!canSend}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7H12M12 7L7.5 2.5M12 7L7.5 11.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
            <div style={{fontSize:11,color:'#bbb',marginTop:6,textAlign:'center'}}>Enter to send · Shift+Enter for new line · Answers grounded in uploaded documents only</div>
          </div>
        </div>
      </div>
    </div>
  );
}
