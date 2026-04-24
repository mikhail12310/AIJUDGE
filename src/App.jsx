import { useState, useRef, useEffect } from "react";
import { jsPDF } from "jspdf";

const API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT = `
You are THE NEUTRAL. An advanced AI arbitrator platform designed for legal and mediation proceedings.
You do not merely route or organize documents. You read merits, weigh them against applicable law, interpret the emotional dynamics of parties, and propose binding or semi-binding resolutions.
Maintain absolute neutrality, professional authority, and deep legal rigor.
`;

// Helper: Convert file to Base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// Helper: Gemini API Calls
async function callGeminiJSON(promptArr, apiKey) {
  const parts = promptArr.map(p => {
    if (typeof p === "string") return { text: p };
    // Assuming base64 data URI format: data:image/png;base64,...
    const mimeType = p.split(';')[0].split(':')[1];
    const data = p.split(',')[1];
    return { inline_data: { mime_type: mimeType, data: data } };
  });

  const res = await fetch(`${API_URL}/${MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(text);
}

async function callGeminiText(promptArr, apiKey) {
  const parts = promptArr.map(p => {
    if (typeof p === "string") return { text: p };
    const mimeType = p.split(';')[0].split(':')[1];
    const data = p.split(',')[1];
    return { inline_data: { mime_type: mimeType, data: data } };
  });

  const res = await fetch(`${API_URL}/${MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }
    })
  });

  if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

export default function App() {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  const [jurisdiction, setJurisdiction] = useState("California, USA");
  const [disputeType, setDisputeType] = useState("Landlord-Tenant");
  const [viewMode, setViewMode] = useState("Party A");
  
  // Phase State: 1 (Intake), 2 (Prelim), 3 (Rebuttal), 4 (Chat), 5 (Final)
  const [phase, setPhase] = useState(1);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");

  // Data State
  const [partyAStory, setPartyAStory] = useState("");
  const [partyAEvidence, setPartyAEvidence] = useState([]);
  const [aSubmitted, setASubmitted] = useState(false);

  const [partyBStory, setPartyBStory] = useState("");
  const [partyBEvidence, setPartyBEvidence] = useState([]);
  const [bSubmitted, setBSubmitted] = useState(false);

  const [prelimRuling, setPrelimRuling] = useState(null); // JSON object

  const [partyARebuttal, setPartyARebuttal] = useState("");
  const [aRebuttalSub, setARebuttalSub] = useState(false);
  const [partyBRebuttal, setPartyBRebuttal] = useState("");
  const [bRebuttalSub, setBRebuttalSub] = useState(false);

  const [chatHistory, setChatHistory] = useState([]); // { role, content }
  const [chatInput, setChatInput] = useState("");
  
  const [finalRuling, setFinalRuling] = useState("");

  const chatEndRef = useRef(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory]);

  const handleFileUpload = async (e, setter, currentEvidence) => {
    const files = Array.from(e.target.files);
    const base64Files = await Promise.all(files.map(f => fileToBase64(f)));
    setter([...currentEvidence, ...base64Files]);
  };

  const generatePreliminaryRuling = async () => {
    if (!apiKey) { setError("System configuration error: API Key missing."); return; }
    setError("");
    setLoading("Analyzing stories and evidence...");
    try {
      const prompt = [
        `You are issuing a PRELIMINARY RULING for a ${disputeType} dispute in ${jurisdiction}.`,
        `Party A claims: ${partyAStory}`,
        `Party B claims: ${partyBStory}`,
        `Analyze the text and any attached evidence. Provide a high-level summary of the dispute. Then provide a specific, separate preliminary assessment/feedback directed specifically to Party A, and a separate one directed to Party B. Note what evidence is strong or missing for each side. Provide output strictly in JSON matching the requested schema.`
      ];
      
      const jsonRes = await callGeminiJSON([...prompt, ...partyAEvidence, ...partyBEvidence], apiKey);
      setPrelimRuling(jsonRes);
      setPhase(2);
    } catch (e) {
      setError(e.message);
    }
    setLoading("");
  };

  const generateFinalRuling = async () => {
    if (!apiKey) { setError("System configuration error: API Key missing."); return; }
    setError("");
    setLoading("Drafting Final Settlement Agreement...");
    try {
      const chatTranscript = chatHistory.map(m => `${m.role}: ${m.content}`).join("\\n");
      const prompt = [
        `Generate the FINAL BINDING RESOLUTION for a ${disputeType} dispute in ${jurisdiction}.`,
        `Party A Initial: ${partyAStory}`,
        `Party B Initial: ${partyBStory}`,
        `Preliminary Ruling Summary: ${prelimRuling?.summary || ''}`,
        `Party A Rebuttal: ${partyARebuttal}`,
        `Party B Rebuttal: ${partyBRebuttal}`,
        `Chat Negotiation Transcript:\\n${chatTranscript}`,
        `Consider all evidence uploaded. Write a highly formal, legally enforceable settlement agreement outlining the facts, the legal reasoning, and the binding resolution. Do not use Markdown headers (e.g. ##), just plain text paragraphs with clear spacing, as this will be printed directly to a PDF.`
      ];

      const textRes = await callGeminiText([...prompt, ...partyAEvidence, ...partyBEvidence], apiKey);
      setFinalRuling(textRes);
      setPhase(5);
    } catch (e) {
      setError(e.message);
    }
    setLoading("");
  };

  const downloadPDF = () => {
    const doc = new jsPDF();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("SETTLEMENT AGREEMENT & BINDING RESOLUTION", 105, 20, { align: "center" });
    
    doc.setFontSize(12);
    doc.text(`Jurisdiction: ${jurisdiction} | Type: ${disputeType}`, 105, 28, { align: "center" });
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    
    const lines = doc.splitTextToSize(finalRuling, 180);
    doc.text(lines, 15, 45);
    
    const pageHeight = doc.internal.pageSize.height;
    let y = 45 + (lines.length * 5) + 20;
    if (y > pageHeight - 40) { doc.addPage(); y = 30; }

    doc.text("_________________________", 20, y);
    doc.text("_________________________", 120, y);
    doc.text("Party A Signature", 20, y + 8);
    doc.text("Party B Signature", 120, y + 8);

    doc.save("Settlement_Agreement.pdf");
  };

  const sendChatMessage = (role) => {
    if (!chatInput.trim()) return;
    setChatHistory([...chatHistory, { role, content: chatInput }]);
    setChatInput("");
  };

  const renderPhaseTracker = () => {
    const phases = ["Intake & Evidence", "Preliminary Ruling", "Rebuttal & New Evidence", "Moderated Chat", "Final Ruling & PDF"];
    return (
      <div className="phase-tracker">
        {phases.map((p, i) => {
          const num = i + 1;
          let className = "phase-item";
          if (phase === num) className += " active";
          if (phase > num) className += " completed";
          return (
            <div key={p} className={className}>
              <div className="phase-icon">{phase > num ? "✓" : num}</div>
              <span>{p}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderEvidenceThumbnails = (evArray) => (
    <div className="evidence-grid">
      {evArray.map((src, i) => (
        <img key={i} src={src} alt="Evidence" className="evidence-thumbnail" />
      ))}
    </div>
  );

  return (
    <div className="app-container">
      {loading && (
        <div className="loader-overlay">
          <div className="spinner"></div>
          <h3 style={{color: "var(--color-primary)"}}>{loading}</h3>
        </div>
      )}

      {/* SIDEBAR */}
      <div className="sidebar">
        <div>
          <div className="brand-title">⚖️ The Neutral</div>
          <div className="brand-subtitle">AI Arbitration Engine</div>
        </div>

        <div>
          <div className="input-group">
            <label>Jurisdiction</label>
            <input type="text" value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Dispute Type</label>
            <select value={disputeType} onChange={e => setDisputeType(e.target.value)}>
              <option>Landlord-Tenant</option>
              <option>Family Law</option>
              <option>Employment</option>
              <option>Commercial</option>
            </select>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <label style={{marginBottom: "0.5rem", display: "block"}}>View Portal As:</label>
          <div className="view-mode-group">
            {["Party A", "Party B", "Arbiter"].map(mode => (
              <div 
                key={mode} 
                className={`view-mode-option ${viewMode === mode ? "active" : ""}`}
                onClick={() => setViewMode(mode)}
              >
                {mode === "Party A" ? "🟢" : mode === "Party B" ? "🔵" : "⚖️"} {mode}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 style={{marginBottom: "1rem", fontSize: "1rem"}}>Progress</h4>
          {renderPhaseTracker()}
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="main-content">
        {error && <div className="alert alert-error">{error}</div>}

        {/* --- PARTY A PORTAL --- */}
        {viewMode === "Party A" && (
          <div className="portal">
            <h1 style={{marginBottom: "2rem"}}>🟢 Party A Private Portal</h1>
            
            {phase === 1 && (
              <div className="card">
                <h2 className="card-title">Initial Submission</h2>
                {aSubmitted ? (
                  <div className="alert alert-success">Your statement and evidence have been submitted. Waiting for Party B.</div>
                ) : (
                  <>
                    <p style={{marginBottom: "1.5rem", color: "var(--color-text-muted)"}}>Please provide your complete narrative of the dispute and attach any relevant photographic evidence (JPG/PNG).</p>
                    <div className="input-group">
                      <label>Your Story & Claims</label>
                      <textarea value={partyAStory} onChange={e => setPartyAStory(e.target.value)} placeholder="State your facts clearly..." />
                    </div>
                    <div className="input-group">
                      <label>Upload Evidence</label>
                      <input type="file" multiple accept="image/png, image/jpeg" onChange={e => handleFileUpload(e, setPartyAEvidence, partyAEvidence)} />
                      {renderEvidenceThumbnails(partyAEvidence)}
                    </div>
                    <button className="btn btn-primary" onClick={() => setASubmitted(true)}>Submit to Arbiter</button>
                  </>
                )}
              </div>
            )}

            {(phase === 2 || phase === 3) && (
              <div className="card">
                <h2 className="card-title">Preliminary Ruling Received</h2>
                <div className="ruling-box">
                  <h4>Case Summary</h4>
                  <p>{prelimRuling?.summary}</p>
                  <h4>Assessment for You (Party A)</h4>
                  <p>{prelimRuling?.party_a_assessment}</p>
                </div>

                {phase === 3 && (
                  <div style={{marginTop: "2rem"}}>
                    <h2 className="card-title">Rebuttal Phase</h2>
                    {aRebuttalSub ? (
                      <div className="alert alert-success">Your rebuttal is submitted.</div>
                    ) : (
                      <>
                        <div className="input-group">
                          <label>Your Rebuttal</label>
                          <textarea value={partyARebuttal} onChange={e => setPartyARebuttal(e.target.value)} />
                        </div>
                        <div className="input-group">
                          <label>New Evidence (Optional)</label>
                          <input type="file" multiple accept="image/png, image/jpeg" onChange={e => handleFileUpload(e, setPartyAEvidence, partyAEvidence)} />
                        </div>
                        <button className="btn btn-primary" onClick={() => setARebuttalSub(true)}>Submit Rebuttal</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {phase === 4 && (
              <div className="card">
                <h2 className="card-title">Moderated Chat</h2>
                <div className="chat-container">
                  {chatHistory.map((m, i) => (
                    <div key={i} className={`chat-message ${m.role === "Party A" ? "me" : m.role === "Arbiter" ? "arbiter" : "other"}`}>
                      {m.role !== "Arbiter" && <div className="chat-role">{m.role}</div>}
                      <div>{m.content}</div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div style={{display: "flex", gap: "1rem"}}>
                  <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChatMessage("Party A")} placeholder="Type a message..." />
                  <button className="btn btn-primary" style={{width: "auto"}} onClick={() => sendChatMessage("Party A")}>Send</button>
                </div>
              </div>
            )}

            {phase === 5 && (
              <div className="card">
                <h2 className="card-title">Final Settlement Agreement</h2>
                <div className="ruling-box" style={{borderColor: "var(--color-primary)", backgroundColor: "white"}}>
                  <p style={{whiteSpace: "pre-wrap"}}>{finalRuling}</p>
                </div>
                <button className="btn btn-primary" onClick={downloadPDF}>⬇️ Download PDF</button>
              </div>
            )}
          </div>
        )}

        {/* --- PARTY B PORTAL --- */}
        {viewMode === "Party B" && (
          <div className="portal">
            <h1 style={{marginBottom: "2rem"}}>🔵 Party B Private Portal</h1>
            
            {phase === 1 && (
              <div className="card">
                <h2 className="card-title">Initial Submission</h2>
                {bSubmitted ? (
                  <div className="alert alert-success">Your statement and evidence have been submitted. Waiting for Party A.</div>
                ) : (
                  <>
                    <p style={{marginBottom: "1.5rem", color: "var(--color-text-muted)"}}>Please provide your complete narrative of the dispute and attach any relevant photographic evidence (JPG/PNG).</p>
                    <div className="input-group">
                      <label>Your Story & Counter-Claims</label>
                      <textarea value={partyBStory} onChange={e => setPartyBStory(e.target.value)} placeholder="State your facts clearly..." />
                    </div>
                    <div className="input-group">
                      <label>Upload Evidence</label>
                      <input type="file" multiple accept="image/png, image/jpeg" onChange={e => handleFileUpload(e, setPartyBEvidence, partyBEvidence)} />
                      {renderEvidenceThumbnails(partyBEvidence)}
                    </div>
                    <button className="btn btn-primary" onClick={() => setBSubmitted(true)}>Submit to Arbiter</button>
                  </>
                )}
              </div>
            )}

            {(phase === 2 || phase === 3) && (
              <div className="card">
                <h2 className="card-title">Preliminary Ruling Received</h2>
                <div className="ruling-box">
                  <h4>Case Summary</h4>
                  <p>{prelimRuling?.summary}</p>
                  <h4>Assessment for You (Party B)</h4>
                  <p>{prelimRuling?.party_b_assessment}</p>
                </div>

                {phase === 3 && (
                  <div style={{marginTop: "2rem"}}>
                    <h2 className="card-title">Rebuttal Phase</h2>
                    {bRebuttalSub ? (
                      <div className="alert alert-success">Your rebuttal is submitted.</div>
                    ) : (
                      <>
                        <div className="input-group">
                          <label>Your Rebuttal</label>
                          <textarea value={partyBRebuttal} onChange={e => setPartyBRebuttal(e.target.value)} />
                        </div>
                        <div className="input-group">
                          <label>New Evidence (Optional)</label>
                          <input type="file" multiple accept="image/png, image/jpeg" onChange={e => handleFileUpload(e, setPartyBEvidence, partyBEvidence)} />
                        </div>
                        <button className="btn btn-primary" onClick={() => setBRebuttalSub(true)}>Submit Rebuttal</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {phase === 4 && (
              <div className="card">
                <h2 className="card-title">Moderated Chat</h2>
                <div className="chat-container">
                  {chatHistory.map((m, i) => (
                    <div key={i} className={`chat-message ${m.role === "Party B" ? "me" : m.role === "Arbiter" ? "arbiter" : "other"}`}>
                      {m.role !== "Arbiter" && <div className="chat-role">{m.role}</div>}
                      <div>{m.content}</div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div style={{display: "flex", gap: "1rem"}}>
                  <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChatMessage("Party B")} placeholder="Type a message..." />
                  <button className="btn btn-primary" style={{width: "auto"}} onClick={() => sendChatMessage("Party B")}>Send</button>
                </div>
              </div>
            )}

            {phase === 5 && (
              <div className="card">
                <h2 className="card-title">Final Settlement Agreement</h2>
                <div className="ruling-box" style={{borderColor: "var(--color-primary)", backgroundColor: "white"}}>
                  <p style={{whiteSpace: "pre-wrap"}}>{finalRuling}</p>
                </div>
                <button className="btn btn-primary" onClick={downloadPDF}>⬇️ Download PDF</button>
              </div>
            )}
          </div>
        )}

        {/* --- ARBITER PORTAL --- */}
        {viewMode === "Arbiter" && (
          <div className="portal">
            <h1 style={{marginBottom: "2rem"}}>⚖️ The Arbiter's Chamber</h1>

            {phase === 1 && (
              <div className="card">
                <h2 className="card-title">Awaiting Intake Submissions</h2>
                <div style={{display: "flex", gap: "2rem", marginBottom: "2rem"}}>
                  <div style={{flex: 1, padding: "1.5rem", borderRadius: "8px", background: aSubmitted ? "var(--color-bg)" : "#FFFBEB", border: `1px solid ${aSubmitted ? "var(--color-border)" : "var(--color-accent)"}`}}>
                    <h3 style={{fontSize: "1.2rem", marginBottom: "0.5rem"}}>Party A Status</h3>
                    <p style={{fontWeight: 600, color: aSubmitted ? "#16A34A" : "var(--color-accent)"}}>{aSubmitted ? "✓ Submitted" : "⏳ Waiting"}</p>
                  </div>
                  <div style={{flex: 1, padding: "1.5rem", borderRadius: "8px", background: bSubmitted ? "var(--color-bg)" : "#FFFBEB", border: `1px solid ${bSubmitted ? "var(--color-border)" : "var(--color-accent)"}`}}>
                    <h3 style={{fontSize: "1.2rem", marginBottom: "0.5rem"}}>Party B Status</h3>
                    <p style={{fontWeight: 600, color: bSubmitted ? "#16A34A" : "var(--color-accent)"}}>{bSubmitted ? "✓ Submitted" : "⏳ Waiting"}</p>
                  </div>
                </div>
                <button className="btn btn-accent" style={{width: "100%", padding: "1rem"}} disabled={!aSubmitted || !bSubmitted} onClick={generatePreliminaryRuling}>
                  Generate Preliminary Ruling
                </button>
              </div>
            )}

            {phase === 2 && (
              <div className="card">
                <h2 className="card-title">Preliminary Ruling Rendered</h2>
                <div className="ruling-box">
                  <h4>Summary</h4>
                  <p>{prelimRuling?.summary}</p>
                  <h4>Party A Assessment</h4>
                  <p>{prelimRuling?.party_a_assessment}</p>
                  <h4>Party B Assessment</h4>
                  <p>{prelimRuling?.party_b_assessment}</p>
                </div>
                <button className="btn btn-primary" onClick={() => setPhase(3)}>Open Rebuttal Phase</button>
              </div>
            )}

            {phase === 3 && (
              <div className="card">
                <h2 className="card-title">Awaiting Rebuttals</h2>
                <div style={{display: "flex", gap: "2rem", marginBottom: "2rem"}}>
                  <div style={{flex: 1, padding: "1.5rem", borderRadius: "8px", background: aRebuttalSub ? "var(--color-bg)" : "#FFFBEB", border: `1px solid ${aRebuttalSub ? "var(--color-border)" : "var(--color-accent)"}`}}>
                    <h3 style={{fontSize: "1.2rem", marginBottom: "0.5rem"}}>Party A Rebuttal</h3>
                    <p style={{fontWeight: 600, color: aRebuttalSub ? "#16A34A" : "var(--color-accent)"}}>{aRebuttalSub ? "✓ Submitted" : "⏳ Waiting"}</p>
                  </div>
                  <div style={{flex: 1, padding: "1.5rem", borderRadius: "8px", background: bRebuttalSub ? "var(--color-bg)" : "#FFFBEB", border: `1px solid ${bRebuttalSub ? "var(--color-border)" : "var(--color-accent)"}`}}>
                    <h3 style={{fontSize: "1.2rem", marginBottom: "0.5rem"}}>Party B Rebuttal</h3>
                    <p style={{fontWeight: 600, color: bRebuttalSub ? "#16A34A" : "var(--color-accent)"}}>{bRebuttalSub ? "✓ Submitted" : "⏳ Waiting"}</p>
                  </div>
                </div>
                <button className="btn btn-accent" style={{width: "100%", padding: "1rem"}} disabled={!aRebuttalSub || !bRebuttalSub} onClick={() => {
                  setPhase(4);
                  setChatHistory([{ role: "Arbiter", content: "I have reviewed your rebuttals and new evidence. You may now converse directly to negotiate a settlement before I render the Final Binding Ruling. Please remain respectful; I am monitoring this chat."}]);
                }}>
                  Open Moderated Chat
                </button>
              </div>
            )}

            {phase === 4 && (
              <div className="card">
                <h2 className="card-title">Moderated Chat Monitoring</h2>
                <div className="chat-container">
                  {chatHistory.map((m, i) => (
                    <div key={i} className={`chat-message ${m.role === "Arbiter" ? "arbiter" : "other"}`}>
                      {m.role !== "Arbiter" && <div className="chat-role">{m.role}</div>}
                      <div>{m.content}</div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div style={{display: "flex", gap: "1rem", marginBottom: "2rem"}}>
                  <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChatMessage("Arbiter")} placeholder="Intervene in chat..." />
                  <button className="btn btn-accent" style={{width: "auto"}} onClick={() => sendChatMessage("Arbiter")}>Warn/Intervene</button>
                </div>
                <button className="btn btn-primary" style={{width: "100%"}} onClick={generateFinalRuling}>End Chat & Generate Final Ruling</button>
              </div>
            )}

            {phase === 5 && (
              <div className="card">
                <h2 className="card-title">Final Settlement Agreement Rendered</h2>
                <div className="ruling-box" style={{borderColor: "var(--color-primary)", backgroundColor: "white"}}>
                  <p style={{whiteSpace: "pre-wrap"}}>{finalRuling}</p>
                </div>
                <button className="btn btn-primary" onClick={downloadPDF}>⬇️ Download PDF</button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
