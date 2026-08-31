import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Cpu,
  FileCheck2,
  FileText,
  FolderOpen,
  Gauge,
  Image,
  LockKeyhole,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Upload,
  Users,
  X,
} from 'lucide-react'
import './App.css'
import type { AppDispatch, RootState, View } from './store'
import { setAttachmentIntent, setComposer, setExecutionStatus, setGuardrailsOpen, setMobileOpen, setRoutingOpen, setTraceVisible, setView, showToast, signIn, signOut, toggleTheme } from './store'

const navItems: { id: View; label: string; icon: typeof MessageSquare }[] = [
  { id: 'workbench', label: 'New Chat', icon: MessageSquare },
  { id: 'chats', label: 'Chats', icon: Activity },
  { id: 'dashboard', label: 'Workspaces', icon: FolderOpen },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'tasks', label: 'Tasks', icon: TerminalSquare },
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'activity', label: 'Activity / Runs', icon: Gauge },
]

const traceEvents = [
  ['09:42:11', 'REQUEST_RECEIVED', 'Inspection report analysis requested', 'done'],
  ['09:42:11', 'INPUT_GUARD', 'All input checks passed', 'done'],
  ['09:42:11', 'TASK_CLASSIFIED', 'Document analysis + deliverable', 'done'],
  ['09:42:11', 'MODEL_SELECTED', 'Local Reasoner selected', 'done'],
  ['09:42:12', 'FILE_READ', 'inspection_report_2026.pdf', 'done'],
  ['09:42:13', 'VISION_ANALYSIS', 'OCR and layout analysis completed', 'done'],
  ['09:42:14', 'MODEL_INFERENCE', 'Extracting findings and recommendation', 'active'],
  ['--:--:--', 'ARTIFACT_CREATED', 'approval-note.docx', 'pending'],
]

function StatusDot({ tone = 'green' }: { tone?: 'green' | 'blue' | 'amber' }) {
  return <span className={`status-dot ${tone}`} />
}

function Sidebar() {
  const dispatch = useDispatch<AppDispatch>()
  const { view, mobileOpen } = useSelector((state: RootState) => state.ui)
  const closeMobile = () => dispatch(setMobileOpen(false))
  return (
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="brand-row">
        <div className="brand-mark"><ShieldCheck size={19} /></div>
        <div><strong>SOVEREIGN AI</strong><span>On-Premise Agentic Workbench</span></div>
        <button className="icon-button mobile-close" onClick={closeMobile} aria-label="Close navigation"><X size={17} /></button>
      </div>
      <button className="new-chat" onClick={() => { dispatch(setView('workbench')); closeMobile() }}><Plus size={16} /> New Chat <span>Ctrl K</span></button>
      <p className="nav-label">WORKSPACE</p>
      <nav>
        {navItems.map(({ id, label, icon: Icon }, index) => (
          <button key={`${label}-${index}`} className={`nav-item ${view === id ? 'selected' : ''}`} onClick={() => { dispatch(setView(id)); closeMobile() }}>
            <Icon size={17} /> {label}
          </button>
        ))}
      </nav>
      <p className="nav-label">SYSTEM</p>
      <button className={`nav-item ${view === 'settings' ? 'selected' : ''}`} onClick={() => { dispatch(setView('settings')); closeMobile() }}><Settings size={17} /> Settings</button>
      <div className="sidebar-spacer" />
      <div className="sovereignty-card">
        <div className="sovereignty-heading"><StatusDot /> <span>LOCAL ONLY</span><MoreHorizontal size={15} /></div>
        <div className="sovereignty-line"><span>External Network</span><b>BLOCKED</b></div>
        <p>All processing stays<br />on this workstation</p>
        <div className="sovereignty-foot"><LockKeyhole size={13} /> Sovereignty verified</div>
      </div>
      <div className="profile"><div className="avatar">AR</div><div><b>Arjun Rao</b><span>Operations Engineering</span></div><MoreHorizontal size={16} /></div>
    </aside>
  )
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const dispatch = useDispatch<AppDispatch>()
  return <header className="topbar">
    <button className="icon-button menu-button" onClick={onMenu} aria-label="Open navigation"><Menu size={19} /></button>
    <div className="workspace-title"><span>WORKSPACE</span><b>Industrial Operations Workspace</b></div>
    <div className="top-statuses">
      <div className="top-status"><span>LOCAL GPU</span><b><Cpu size={14} /> 5.8 / 8 GB</b></div>
      <div className="top-status"><span>ACTIVE MODEL</span><b>Local Reasoner</b></div>
      <div className="local-pill"><StatusDot /> LOCAL</div><button className="theme-switch" onClick={() => dispatch(toggleTheme())}>Theme</button><button className="sign-out" onClick={() => dispatch(signOut())}>Sign out</button>
    </div>
  </header>
}

function ModelRouting() {
  const dispatch = useDispatch<AppDispatch>()
  const open = useSelector((state: RootState) => state.ui.routingOpen)
  return <section className="panel routing-panel">
    <button className="panel-heading" onClick={() => dispatch(setRoutingOpen(!open))}><span><Sparkles size={16} /> Model Routing</span>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
    {open && <div className="routing-content">
      <div className="route-flow"><span>REQUEST</span><ArrowRight size={14} /><span>TASK ANALYSIS</span><ArrowRight size={14} /><strong>DOCUMENT + REASONING</strong></div>
      <div className="selected-model"><div><span>SELECTED MODEL</span><b>Local Reasoner</b></div><div className="model-availability"><StatusDot /> Available</div></div>
      <div className="why"><b>Why this model?</b><span>Complex reasoning required</span><span>Document analysis</span><span>No coding-specific capability required</span></div>
    </div>}
  </section>
}

function Guardrails() {
  const dispatch = useDispatch<AppDispatch>()
  const open = useSelector((state: RootState) => state.ui.guardrailsOpen)
  const checks = ['Input inspection', 'Prompt injection protection', 'Secret detection', 'Tool policy', 'Protected path checks', 'Output inspection']
  return <section className="panel guardrail-panel">
    <button className="panel-heading" onClick={() => dispatch(setGuardrailsOpen(!open))}><span><ShieldCheck size={16} /> Security &amp; Guardrails <em>6 / 6 passed</em></span>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
    {open && <div className="guardrail-list">{checks.map((check) => <div key={check}><Check size={14} /> {check}<span>PASSED</span></div>)}</div>}
  </section>
}

function ExecutionTrace() {
  const dispatch = useDispatch<AppDispatch>()
  const { traceVisible, executionStatus } = useSelector((state: RootState) => state.ui)
  if (!traceVisible) return null
  return <aside className="trace-panel">
    <div className="trace-header"><div><span className="eyebrow">AUDIT / EXPLAINABILITY</span><h2>Execution Trace</h2></div><button className="icon-button" onClick={() => dispatch(setTraceVisible(false))} aria-label="Close execution trace"><X size={17} /></button></div>
    <div className="run-id"><span>RUN #A84F12</span><span><StatusDot tone={executionStatus === 'completed' ? 'green' : 'blue'} /> {executionStatus === 'completed' ? 'COMPLETED' : 'IN PROGRESS'}</span></div>
    <div className="timeline">{traceEvents.map(([time, type, description, state]) => <div className={`trace-event ${state}`} key={`${time}-${type}`}><div className="trace-time">{time}</div><div className="trace-marker">{state === 'done' ? <Check size={11} /> : state === 'active' ? <span /> : null}</div><div className="trace-copy"><b>{type}</b><span>{description}</span></div></div>)}</div>
    <div className="trace-footer"><FileCheck2 size={15} /><span>All events are recorded locally<br /><b>Retention policy: 30 days</b></span></div>
  </aside>
}

function Composer() {
  const dispatch = useDispatch<AppDispatch>()
  const { composer, toast } = useSelector((state: RootState) => state.ui)
  return <div className="composer-wrap">
    {toast && <div className="sent-note"><Check size={14} /> {toast}</div>}
    <div className="composer"><textarea value={composer} onChange={(event) => dispatch(setComposer(event.target.value))} placeholder="Ask your local AI to analyze, create, calculate, code, or review..." rows={2} /><div className="composer-tools"><div><button className="tool-button" onClick={() => dispatch(setAttachmentIntent('document'))}><Paperclip size={15} /> Attach</button><button className="tool-button" onClick={() => dispatch(setAttachmentIntent('image'))}><Image size={15} /> Image</button><button className="tool-button workspace-tool"><FolderOpen size={15} /> Industrial Operations <ChevronDown size={13} /></button></div><button className="send-button" onClick={() => { dispatch(showToast('Request queued for local execution')); dispatch(setExecutionStatus('running')); dispatch(setTraceVisible(true)); dispatch(setComposer('')) }} aria-label="Send request"><Send size={17} /></button></div></div>
    <div className="composer-foot"><span><LockKeyhole size={12} /> Your data stays inside the organization.</span><span>Tools: <b>Controlled</b> <ChevronDown size={12} /></span></div>
  </div>
}

function Dashboard() {
  const dispatch = useDispatch<AppDispatch>()
  const attachmentIntent = useSelector((state: RootState) => state.ui.attachmentIntent)
  const openWorkbench = (intent: 'none' | 'document' | 'image' = 'none') => {
    dispatch(setAttachmentIntent(intent))
    dispatch(setView('workbench'))
  }
  return <main className="main-content dashboard-view"><div className="dashboard-hero"><div><span className="eyebrow">INDUSTRIAL OPERATIONS WORKSPACE</span><h1>Your AI stays<br /><em>on-premise.</em></h1><p>Analyze confidential documents, write code, execute local tools, and create deliverables without sending organizational data to external AI services.</p></div><div className="hero-proof"><div><StatusDot /><b>LOCAL ONLY</b><span>External network blocked</span></div><div><ShieldCheck size={17} /><b>POLICY CONTROLLED</b><span>Guardrails before and after execution</span></div></div></div><section className="quick-actions"><button onClick={() => openWorkbench()}><MessageSquare size={19} /><span><b>Start Conversation</b><small>Ask your local assistant</small></span><ArrowRight size={16} /></button><button onClick={() => openWorkbench('document')}><FileText size={19} /><span><b>Analyze Document</b><small>Upload a confidential file</small></span><ArrowRight size={16} /></button><button onClick={() => dispatch(setView('tasks'))}><TerminalSquare size={19} /><span><b>Run Coding Task</b><small>Use Local Coder + sandbox</small></span><ArrowRight size={16} /></button><button onClick={() => openWorkbench()}><FileCheck2 size={19} /><span><b>Create Deliverable</b><small>Generate a controlled artifact</small></span><ArrowRight size={16} /></button></section>{attachmentIntent !== 'none' && <div className="intent-banner"><Paperclip size={15} /> {attachmentIntent === 'document' ? 'Document analysis mode ready in the workbench.' : 'Image analysis mode ready in the workbench.'}<button onClick={() => dispatch(setAttachmentIntent('none'))}>Dismiss</button></div>}<div className="dashboard-grid"><section className="dashboard-section"><div className="section-heading"><div><span className="eyebrow">WORKSPACE PULSE</span><h2>Today&apos;s activity</h2></div><button className="text-button" onClick={() => dispatch(setView('status'))}>View runs <ArrowRight size={14} /></button></div><div className="metrics"><div><b>12</b><span>Tasks completed</span><small>+3 this week</small></div><div><b>3</b><span>Models used</span><small>All local</small></div><div><b>8</b><span>Documents processed</span><small>100% on-device</small></div><div><b>2</b><span>Guardrail events</span><small>Policy reviewed</small></div></div></section><section className="dashboard-section intelligence"><div className="section-heading"><div><span className="eyebrow">ORCHESTRATOR REGISTRY</span><h2>Available local intelligence</h2></div><button className="text-button" onClick={() => dispatch(setView('models'))}>Manage <ArrowRight size={14} /></button></div><div className="intelligence-list"><button onClick={() => dispatch(setView('models'))}><Cpu size={17} /><span><b>Local Reasoner</b><small>Document analysis · Tool use</small></span><span className="available"><StatusDot /> Available</span></button><button onClick={() => dispatch(setView('models'))}><TerminalSquare size={17} /><span><b>Local Coder</b><small>Code generation · Sandbox</small></span><span className="available"><StatusDot /> Available</span></button><button onClick={() => dispatch(setView('models'))}><Image size={17} /><span><b>Local Vision</b><small>OCR · Image understanding</small></span><span className="available"><StatusDot /> Available</span></button></div></section></div></main>
}

function Workbench() {
  const dispatch = useDispatch<AppDispatch>()
  const traceVisible = useSelector((state: RootState) => state.ui.traceVisible)
  return <main className="main-content workbench-view">
    <div className="content-column">
      <div className="page-heading"><div><span className="eyebrow">LOCAL AI EXECUTION</span><h1>Agent Workbench</h1><p>Confidential workspace <i /> All processing local</p></div><div className="heading-actions"><button className="outline-button" onClick={() => dispatch(setView('activity'))}><Activity size={15} /> View activity</button>{traceVisible ? <button className="outline-button" onClick={() => dispatch(setTraceVisible(false))}><X size={15} /> Hide trace</button> : <button className="outline-button" onClick={() => dispatch(setTraceVisible(true))}><Gauge size={15} /> View trace</button>}</div></div>
      <div className="chat-area">
        <div className="message user-message"><div className="avatar small">AR</div><div><span className="message-meta">YOU <time>09:42:11</time></span><p>Analyze the uploaded inspection report and prepare an approval note identifying critical findings.</p><div className="attachment"><FileText size={17} /><div><b>inspection_report_2026.pdf</b><span>Engineering Report · 2.4 MB · CONFIDENTIAL</span></div><Check size={15} /></div></div></div>
        <div className="message assistant-message"><div className="assistant-icon"><Sparkles size={16} /></div><div className="assistant-body"><span className="message-meta">SOVEREIGN AI <time>09:42:11</time></span><div className="execution-card"><div className="execution-top"><div><span className="eyebrow">TASK EXECUTION</span><b>Preparing approval note</b></div><span className="running"><span /> PROCESSING</span></div><div className="execution-steps"><div className="complete"><Check /> Input guardrail passed</div><div className="complete"><Check /> Task classified: Document Analysis</div><div className="complete"><Check /> Model selected: Local Reasoner</div><div className="complete"><Check /> Document access authorized</div><div className="active"><span /> Vision / OCR processing document...</div></div></div><p className="assistant-intro">I found 6 pages in the inspection report. I am extracting findings and cross-checking the recommendation against the approval workflow.</p><ModelRouting /><Guardrails /><div className="response-preview"><div className="response-header"><div><span className="eyebrow">DRAFT OUTPUT</span><h3>Approval note in progress</h3></div><span className="doc-badge"><FileText size={14} /> DOCX</span></div><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-line short" /></div></div></div>
      </div>
      <Composer />
    </div>
    <ExecutionTrace />
  </main>
}

function Tasks() {
  const tasks = [['Inspection Report -> Approval Note', 'Running', 'Local Reasoner', 'File Read, OCR, Document Writer', '4 / 6'], ['Internal Tool Debugging', 'Completed', 'Local Coder', 'File Read, Sandbox Execution', '6 / 6'], ['Scanned Engineering Drawing Analysis', 'Completed', 'Local Vision', 'OCR, Image Analysis', '5 / 5']]
  return <main className="main-content single-view"><div className="page-heading"><div><span className="eyebrow">ORCHESTRATED WORK</span><h1>Agent Tasks</h1><p>Monitor local agents, tools, and generated deliverables.</p></div><button className="primary-button"><Plus size={16} /> New task</button></div><div className="task-list">{tasks.map(([title, status, model, tools, steps]) => <div className="task-card" key={title}><div className="task-icon"><TerminalSquare size={18} /></div><div className="task-main"><div className="task-title"><h3>{title}</h3><span className={`status-label ${status.toLowerCase()}`}><StatusDot tone={status === 'Running' ? 'blue' : 'green'} /> {status}</span></div><div className="task-details"><span><Cpu size={14} /> {model}</span><span><LockKeyhole size={14} /> {tools}</span></div><div className="progress-track"><span style={{ width: `${(parseInt(steps) / 6) * 100}%` }} /></div></div><div className="task-steps"><b>{steps}</b><span>steps</span><ChevronRight size={18} /></div></div>)}</div></main>
}

function Chats() {
  const dispatch = useDispatch<AppDispatch>()
  const groups: [string, string[]][] = [['TODAY', ['Inspection Report Review', 'Approval Note Draft']], ['YESTERDAY', ['Pump Maintenance Analysis', 'SCADA Code Debugging']], ['EARLIER', ['Vendor Comparison', 'P&ID Analysis']]]
  return <main className="main-content single-view"><div className="page-heading"><div><span className="eyebrow">CONVERSATION ARCHIVE</span><h1>Chats</h1><p>Local conversations from the Industrial Operations workspace.</p></div><button className="primary-button" onClick={() => dispatch(setView('workbench'))}><Plus size={16} /> New chat</button></div><div className="chat-history">{groups.map(([group, chats]) => <section key={group}><span className="history-label">{group}</span>{chats.map((chat) => <button className="history-row" key={chat} onClick={() => { dispatch(setComposer(`Continue: ${chat}`)); dispatch(setView('workbench')) }}><div className="history-icon"><MessageSquare size={15} /></div><span><b>{chat}</b><small>Local Reasoner · Workspace conversation</small></span><time>09:42</time><ChevronRight size={16} /></button>)}</section>)}</div></main>
}

function ActivityRuns() {
  const dispatch = useDispatch<AppDispatch>()
  const runs = [['#A84F12', 'Inspection report to approval note', 'Local Reasoner', 'In progress', '09:42:11'], ['#A84E98', 'Internal utility CSV parser', 'Local Coder', 'Completed', 'Yesterday'], ['#A84D20', 'Scanned engineering drawing', 'Local Vision', 'Completed', 'Aug 29, 2026']]
  return <main className="main-content single-view"><div className="page-heading"><div><span className="eyebrow">AUDIT / EXPLAINABILITY</span><h1>Activity &amp; Runs</h1><p>Review what the local orchestrator did and why.</p></div><div className="demo-label"><CircleDot size={13} /> DEMO DATA</div></div><div className="run-list">{runs.map(([id, name, model, status, time]) => <button className="run-row" key={id} onClick={() => { dispatch(setTraceVisible(true)); dispatch(setView('workbench')) }}><div className="run-symbol"><Activity size={16} /></div><div><b>{name}</b><span>{id} · {model}</span></div><span className={`run-status ${status === 'Completed' ? 'complete' : 'active'}`}><StatusDot tone={status === 'Completed' ? 'green' : 'blue'} /> {status}</span><time>{time}</time><ChevronRight size={16} /></button>)}</div><div className="audit-note"><ShieldCheck size={16} /><div><b>Local audit retention</b><span>Events are recorded on this workstation and never sent to an external service.</span></div></div></main>
}

function Documents() {
  const docs = [['inspection_report_2026.pdf', 'Engineering Report', '2.4 MB', 'CONFIDENTIAL', 'Just now', 'Processed locally'], ['pump_maintenance_log.docx', 'Maintenance Record', '841 KB', 'INTERNAL', 'Yesterday', 'Processed locally'], ['p_and_id_unit_4_scan.tif', 'Scanned Drawing', '18.2 MB', 'CONFIDENTIAL', 'Aug 29, 2026', 'OCR complete'], ['vendor_comparison_q3.xlsx', 'Financial Document', '412 KB', 'INTERNAL', 'Aug 27, 2026', 'Processed locally']]
  return <main className="main-content single-view"><div className="page-heading"><div><span className="eyebrow">CONFIDENTIAL WORKSPACE</span><h1>Documents</h1><p>Files are indexed and processed on this workstation only.</p></div><button className="primary-button"><Upload size={16} /> Upload document</button></div><div className="document-toolbar"><div className="search-field"><Search size={15} /><input placeholder="Search documents" /></div><button className="filter-button">All classifications <ChevronDown size={14} /></button></div><div className="document-table"><div className="table-head"><span>FILENAME</span><span>TYPE</span><span>SIZE</span><span>CLASSIFICATION</span><span>LAST ACCESSED</span><span>STATUS</span></div>{docs.map(([name, type, size, classification, accessed, status]) => <div className="document-row" key={name}><div className="file-name"><div className="file-icon"><FileText size={16} /></div><b>{name}</b></div><span>{type}</span><span>{size}</span><span className="classification">{classification}</span><span>{accessed}</span><span className="local-status"><StatusDot /> {status}</span></div>)}</div></main>
}

function Models() {
  const models: [string, string, string[], string, string, string, string][] = [['Local Coder', 'Coding and tool execution', ['CODING', 'TOOL USE', 'REASONING'], '16K tokens', '6.2 GB', 'coder.local/v1', 'Code generation, sandbox tasks'], ['Local Reasoner', 'General reasoning and analysis', ['REASONING', 'DOCUMENT ANALYSIS', 'TOOL USE'], '32K tokens', '7.8 GB', 'reasoner.local/v1', 'Complex analysis, deliverables'], ['Local Vision', 'Visual document understanding', ['VISION', 'IMAGE ANALYSIS', 'OCR'], '16K tokens', '5.4 GB', 'vision.local/v1', 'Scans, drawings, photographs']]
  return <main className="main-content single-view"><div className="page-heading"><div><span className="eyebrow">ORCHESTRATOR REGISTRY</span><h1>Local Models</h1><p>Available intelligence for this workspace. No external models configured.</p></div><button className="outline-button"><Settings size={15} /> Registry settings</button></div><div className="model-grid">{models.map(([name, role, caps, context, vram, endpoint, use]) => <div className="model-card" key={name}><div className="model-card-top"><div className="model-avatar"><Cpu size={19} /></div><span className="available"><StatusDot /> Available</span></div><h2>{name}</h2><p>{role}</p><div className="capabilities">{caps.map((cap) => <span key={cap}>{cap}</span>)}</div><div className="model-specs"><div><span>CONTEXT</span><b>{context}</b></div><div><span>EST. VRAM</span><b>{vram}</b></div><div><span>ENDPOINT</span><b>{endpoint}</b></div></div><div className="model-use"><CircleDot size={14} /> {use}</div></div>)}</div></main>
}

function SystemStatus() {
  const stats = [['PROCESSING LOCATION', 'LOCAL WORKSTATION'], ['EXTERNAL NETWORK', 'BLOCKED'], ['LOCAL MODELS', '3 AVAILABLE'], ['EXTERNAL API CALLS', '0'], ['LOCAL TOOL EXECUTIONS', '12'], ['GUARDRAIL BLOCKS', '2']]
  return <main className="main-content single-view"><div className="page-heading"><div><span className="eyebrow">TRUST CENTER / DEMONSTRATION DATA</span><h1>Sovereignty &amp; System Status</h1><p>Observable evidence of where work runs and how it is controlled.</p></div><div className="demo-label"><CircleDot size={13} /> DEMO DATA</div></div><div className="status-grid">{stats.map(([label, value]) => <div className="status-stat" key={label}><span>{label}</span><b>{value}</b></div>)}</div><div className="architecture panel"><div className="architecture-heading"><div><span className="eyebrow">LOCAL EXECUTION PATH</span><h2>System architecture</h2></div><span className="verified"><Check size={14} /> Verified locally</span></div><div className="architecture-flow"><div className="arch-node"><Users size={18} /><b>User</b></div><ArrowRight className="arch-arrow" /><div className="arch-node primary"><ShieldCheck size={18} /><b>Sovereign Workbench</b></div><ArrowRight className="arch-arrow" /><div className="arch-node"><Cpu size={18} /><b>Local Orchestrator</b></div><div className="arch-branches"><span><Cpu size={14} /> Local Models</span><span><Image size={14} /> Local OCR / Vision</span><span><TerminalSquare size={14} /> Local Tools</span><span><FolderOpen size={14} /> Local Workspace</span></div><div className="external-block"><X size={15} /> External Internet</div></div></div></main>
}

function SettingsView() {
  const dispatch = useDispatch<AppDispatch>()
  const { theme, workspace } = useSelector((state: RootState) => state.ui)
  return <main className="main-content single-view"><div className="page-heading"><div><span className="eyebrow">WORKSPACE CONFIGURATION</span><h1>Settings</h1><p>Review local execution policy and workstation preferences.</p></div></div><div className="settings-grid"><section className="settings-card"><div className="settings-icon"><ShieldCheck size={18} /></div><div><span className="eyebrow">WORKSPACE</span><h2>{workspace}</h2><p>All files, models, and traces belong to this local workspace.</p></div><button className="outline-button" onClick={() => dispatch(showToast('Workspace selector is ready for configuration'))}>Change workspace</button></section><section className="settings-card"><div className="settings-icon"><LockKeyhole size={18} /></div><div><span className="eyebrow">TOOL POLICY</span><h2>Controlled execution</h2><p>File read, OCR, sandbox, and document writer require explicit policy permission.</p></div><span className="available"><StatusDot /> Enforced</span></section><section className="settings-card"><div className="settings-icon"><Gauge size={18} /></div><div><span className="eyebrow">APPEARANCE</span><h2>{theme === 'dark' ? 'Dark' : 'Light'} interface</h2><p>Use a low-glare surface for long operational review sessions.</p></div><button className="outline-button" onClick={() => dispatch(toggleTheme())}>Switch theme</button></section></div></main>
}

function Landing({ onLogin }: { onLogin: () => void }) {
  return <div className="landing-page"><header className="landing-nav"><div className="brand-row"><div className="brand-mark"><ShieldCheck size={19} /></div><div><strong>SOVEREIGN AI</strong><span>On-Premise Agentic Workbench</span></div></div><div className="landing-nav-right"><span><StatusDot /> Local by design</span><button className="landing-login" onClick={onLogin}>Sign in <ArrowRight size={15} /></button></div></header><main className="landing-main"><div className="landing-copy"><span className="eyebrow">CONFIDENTIAL AI OPERATIONS</span><h1>Your AI stays<br /><em>on-premise.</em></h1><p>Analyze confidential documents, write code, execute local tools, and create deliverables without sending organizational data to external AI services.</p><div className="landing-actions"><button className="primary-button" onClick={onLogin}>Open workbench <ArrowRight size={16} /></button><button className="landing-secondary" onClick={onLogin}><PlayCircleIcon /> View the 60-second demo</button></div><div className="landing-proof"><span><ShieldCheck size={15} /> External network blocked</span><span><Cpu size={15} /> 3 local models available</span><span><FileCheck2 size={15} /> Auditable execution</span></div></div><div className="landing-console"><div className="console-top"><span><StatusDot /> SYSTEM READY</span><span>LOCAL ORCHESTRATOR / v0.8.4</span></div><div className="console-title"><span className="eyebrow">LIVE WORKFLOW</span><h2>Inspection report<br />to approval note</h2></div><div className="console-pipeline"><div className="pipeline-node done"><span>01</span><b>Input guard</b><small>Passed</small></div><ArrowRight /><div className="pipeline-node active"><span>02</span><b>Local Reasoner</b><small>Selected by router</small></div><ArrowRight /><div className="pipeline-node"><span>03</span><b>Artifact</b><small>Approval note .docx</small></div></div><div className="console-trace"><div><span>09:42:13</span><b>VISION_ANALYSIS</b><small>OCR completed locally</small></div><div><span>09:42:14</span><b>OUTPUT_GUARD</b><small>Ready for review</small></div></div><div className="console-footer"><LockKeyhole size={14} /> No external calls in this workspace <span>0</span></div></div></main><div className="landing-bottom"><span>BUILT FOR CONTROLLED ENVIRONMENTS</span><span>Industrial operations</span><span>Public sector</span><span>Engineering teams</span><span>Defence-linked manufacturing</span></div></div>
}

function PlayCircleIcon() {
  return <span className="play-icon"><Play size={13} /></span>
}

function Login({ onBack }: { onBack: () => void }) {
  const dispatch = useDispatch<AppDispatch>()
  const [accessCode, setAccessCode] = useState('')
  return <div className="login-page"><div className="login-aside"><div className="brand-row"><div className="brand-mark"><ShieldCheck size={19} /></div><div><strong>SOVEREIGN AI</strong><span>On-Premise Agentic Workbench</span></div></div><div className="login-aside-copy"><span className="eyebrow">WORKSTATION ACCESS</span><h1>Confidential work<br />stays <em>close.</em></h1><p>This demo workspace runs entirely on the local machine. No external provider is configured.</p><div className="login-trust"><div><StatusDot /><b>LOCAL ONLY</b><span>External network blocked</span></div><div><ShieldCheck size={17} /><b>POLICY ENFORCED</b><span>Guardrails active before execution</span></div></div></div></div><div className="login-panel"><div className="login-card"><span className="eyebrow">SIGN IN TO WORKSPACE</span><h2>Welcome back</h2><p className="login-muted">Use your workstation identity to continue.</p><label>WORKSPACE</label><div className="login-select"><FolderOpen size={15} /> Industrial Operations Workspace <ChevronDown size={14} /></div><label>ACCESS CODE <span>DEMO</span></label><input value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="Enter access code" type="password" /><button className="login-submit" onClick={() => dispatch(signIn())}>Continue to workbench <ArrowRight size={16} /></button><p className="login-foot"><LockKeyhole size={13} /> Demo mode: any access code accepted</p></div><button className="back-link" onClick={onBack}><ChevronRight size={14} className="back-chevron" /> Back to product overview</button></div></div>
}

function App() {
  const dispatch = useDispatch<AppDispatch>()
  const { authenticated, view, theme } = useSelector((state: RootState) => state.ui)

  const page = view === 'dashboard' ? <Dashboard /> : view === 'chats' ? <Chats /> : view === 'tasks' ? <Tasks /> : view === 'documents' ? <Documents /> : view === 'models' ? <Models /> : view === 'activity' ? <ActivityRuns /> : view === 'status' ? <SystemStatus /> : view === 'settings' ? <SettingsView /> : <Workbench />
  if (!authenticated) return <LoginOrLanding />
  return <div className={`app-shell ${theme}`}><Sidebar /><div className="app-body"><TopBar onMenu={() => dispatch(setMobileOpen(true))} />{page}</div></div>
}

function LoginOrLanding() {
  const [showLogin, setShowLogin] = useState(false)
  return showLogin ? <Login onBack={() => setShowLogin(false)} /> : <Landing onLogin={() => setShowLogin(true)} />
}

export default App
