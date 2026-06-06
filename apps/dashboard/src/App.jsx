import { useState, useEffect, useCallback } from "react";
import { io } from "socket.io-client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from "recharts";

const socket = io("/", {
  reconnectionAttempts: 10,
  timeout: 5000,
  transports: ["websocket", "polling"],
});

const STATUS = {
  waiting:   { color: "#9ca3af", bg: "rgba(156,163,175,0.12)", label: "waiting" },
  active:    { color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  label: "active"  },
  completed: { color: "#34d399", bg: "rgba(52,211,153,0.12)",  label: "done"    },
  failed:    { color: "#f87171", bg: "rgba(248,113,113,0.12)", label: "failed"  },
};

function Pill({ status }) {
  const s = STATUS[status] || STATUS.waiting;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 99,
      fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
      textTransform: "uppercase",
      background: s.bg, color: s.color,
      border: `1px solid ${s.color}22`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.color, display: "inline-block" }} />
      {s.label}
    </span>
  );
}

function MetricCard({ label, value, color, sub }) {
  return (
    <div style={{
      background: "var(--bg)", border: "1px solid var(--border)",
      borderRadius: 12, padding: "16px 20px",
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 600, color: color || "var(--text-h)", letterSpacing: "-1px", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text)" }}>{sub}</div>}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 10 }}>
      {children}
    </div>
  );
}

export default function App() {
  const [jobs, setJobs]         = useState([]);
  const [stats, setStats]       = useState([]);
  const [connected, setConnected] = useState(false);
  const [events, setEvents]     = useState([]);
  const [throughput, setThroughput] = useState([]);

  const fetchJobs = useCallback(() => {
    fetch("/api/jobs").then(r => r.json()).then(d => setJobs(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const fetchStats = useCallback(() => {
    fetch("/api/jobs/stats").then(r => r.json()).then(d => setStats(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  useEffect(() => {
    fetchJobs();
    fetchStats();
    const interval = setInterval(() => { fetchJobs(); fetchStats(); }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    socket.on("connect",       () => setConnected(true));
    socket.on("disconnect",    () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));

    const handle = (eventName) => (data) => {
      const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
      setEvents(prev => [{ eventName, ...data, ts }, ...prev].slice(0, 30));
      setThroughput(prev => {
        const last = prev[prev.length - 1];
        const now = Date.now();
        if (last && now - last.t < 2000) {
          return [...prev.slice(0, -1), { ...last, count: last.count + 1 }];
        }
        return [...prev.slice(-19), { t: now, label: ts, count: 1 }];
      });
      fetchJobs();
      fetchStats();
    };

    socket.on("job:active",    handle("job:active"));
    socket.on("job:completed", handle("job:completed"));
    socket.on("job:failed",    handle("job:failed"));
    socket.on("job:retry",     handle("job:retry"));

    return () => {
      ["job:active","job:completed","job:failed","job:retry"].forEach(e => socket.off(e));
    };
  }, []);

  const safe = jobs || [];
  const total     = stats.reduce((a, s) => a + Number(s.count), 0);
  const completed = stats.filter(s => s.status === "completed").reduce((a, s) => a + Number(s.count), 0);
  const failed    = stats.filter(s => s.status === "failed").reduce((a, s) => a + Number(s.count), 0);
  const waiting   = stats.filter(s => s.status === "waiting").reduce((a, s) => a + Number(s.count), 0);
  const active    = stats.filter(s => s.status === "active").reduce((a, s) => a + Number(s.count), 0);

  const chartData = ["email", "image", "report"].map(queue => {
    const qs = (stats || []).filter(s => s.queue === queue);
    return {
      queue,
      completed: +((qs.find(s => s.status === "completed")?.count) || 0),
      failed:    +((qs.find(s => s.status === "failed")?.count) || 0),
      waiting:   +((qs.find(s => s.status === "waiting")?.count) || 0),
    };
  });

  const eventColor = (name) => ({
    "job:active":    "#60a5fa",
    "job:completed": "#34d399",
    "job:failed":    "#f87171",
    "job:retry":     "#fbbf24",
  })[name] || "#9ca3af";

  return (
    <div style={{ minHeight: "100svh", fontFamily: "var(--sans)", color: "var(--text)" }}>
      {/* Topbar */}
      <div style={{
        borderBottom: "1px solid var(--border)",
        padding: "0 32px",
        height: 52,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: "var(--accent)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-h)", letterSpacing: "0.02em" }}>TaskQueue</span>
          <span style={{ fontSize: 12, color: "var(--text)", padding: "2px 8px", background: "var(--code-bg)", borderRadius: 4, fontFamily: "var(--mono)" }}>monitor</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: connected ? "#34d399" : "#f87171",
            boxShadow: connected ? "0 0 6px #34d399" : "none",
          }} />
          <span style={{ fontSize: 12, color: connected ? "#34d399" : "#f87171", fontWeight: 500 }}>
            {connected ? "live" : "offline"}
          </span>
        </div>
      </div>

      <div style={{ padding: "24px 32px", maxWidth: 1200, margin: "0 auto" }}>

        {/* Metrics row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
          <MetricCard label="Total jobs"  value={total}     />
          <MetricCard label="Active"      value={active}    color="#60a5fa" sub="processing now" />
          <MetricCard label="Completed"   value={completed} color="#34d399" sub="success" />
          <MetricCard label="Failed (DLQ)" value={failed}   color="#f87171" sub="needs review" />
          <MetricCard label="Waiting"     value={waiting}   color="#fbbf24" sub="in queue" />
        </div>

        {/* Charts row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>

          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
            <SectionLabel>Jobs by queue</SectionLabel>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} barGap={2}>
                <XAxis dataKey="queue" tick={{ fontSize: 11, fill: "var(--text)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text)" }} axisLine={false} tickLine={false} width={24} />
                <Tooltip
                  contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: "var(--code-bg)" }}
                />
                <Bar dataKey="completed" fill="#34d399" radius={[3,3,0,0]} maxBarSize={28} />
                <Bar dataKey="failed"    fill="#f87171" radius={[3,3,0,0]} maxBarSize={28} />
                <Bar dataKey="waiting"   fill="#fbbf24" radius={[3,3,0,0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              {[["completed","#34d399"],["failed","#f87171"],["waiting","#fbbf24"]].map(([k,c]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text)" }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{k}
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
            <SectionLabel>Throughput (events/sec)</SectionLabel>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={throughput}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "var(--text)" }} axisLine={false} tickLine={false} width={20} />
                <Tooltip contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="count" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bottom row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>

          {/* Jobs table */}
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
              <SectionLabel>Recent jobs</SectionLabel>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--code-bg)" }}>
                    {["Job ID","Queue","Status","Attempts","Created"].map(h => (
                      <th key={h} style={{ fontSize: 10, fontWeight: 700, color: "var(--text)", textAlign: "left", padding: "8px 16px", textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {safe.map((job, i) => (
                    <tr key={job.id} style={{ borderTop: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--code-bg)22" }}>
                      <td style={{ padding: "10px 16px", fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)" }}>{job.id.slice(0,8)}…</td>
                      <td style={{ padding: "10px 16px", fontSize: 13 }}>
                        <span style={{ padding: "2px 8px", borderRadius: 4, background: "var(--code-bg)", fontSize: 12, fontFamily: "var(--mono)" }}>{job.queue}</span>
                      </td>
                      <td style={{ padding: "10px 16px" }}><Pill status={job.status} /></td>
                      <td style={{ padding: "10px 16px", fontSize: 13, color: job.attempts >= job.max_attempts ? "#f87171" : "var(--text)" }}>
                        {job.attempts}<span style={{ color: "var(--border)", margin: "0 2px" }}>/</span>{job.max_attempts}
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--text)", fontFamily: "var(--mono)" }}>
                        {new Date(job.created_at).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live events */}
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <SectionLabel>Live events</SectionLabel>
              {connected && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", animation: "pulse 1.5s infinite" }} />}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", maxHeight: 340 }}>
              {events.length === 0 && (
                <div style={{ padding: "20px 20px", fontSize: 13, color: "var(--text)", opacity: 0.5 }}>Waiting for events…</div>
              )}
              {events.map((e, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "7px 16px",
                  borderBottom: "1px solid var(--border)44",
                  fontSize: 12,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: eventColor(e.eventName), flexShrink: 0 }} />
                  <span style={{ color: eventColor(e.eventName), fontWeight: 600, width: 60, flexShrink: 0 }}>{e.eventName.split(":")[1]}</span>
                  <span style={{ fontFamily: "var(--mono)", color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.jobId?.slice(0,8)}…</span>
                  <span style={{ color: "var(--text)", opacity: 0.5, flexShrink: 0, fontFamily: "var(--mono)" }}>{e.ts}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
      `}</style>
    </div>
  );
}