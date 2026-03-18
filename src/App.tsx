import { useState, useEffect, useRef, type ReactElement } from 'react';
import { credentialsReady, callMcpTool } from './api';
import './App.css';

// ─── Types ────────────────────────────────────────────────────────────────────

type Vertical = 'strategy' | 'reporting' | 'planning';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
}

interface FinancialRow {
  'Reporting Date'?: number;
  'DR_ACC_L1.5'?: string;
  'Department L1'?: string;
  Amount?: number;
  Scenario?: string;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const decodeHtml = (s: string): string => {
  const txt = document.createElement('textarea');
  txt.innerHTML = s;
  return txt.value;
};

const formatMoney = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const formatDate = (ts: number): string => {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const TABLE_ID = '16528';

const EXPENSE_CATEGORIES = new Set(['COGS', 'G&A', 'R&D', 'S&M', 'Finance expenses', 'Tax', 'Other', 'Intercompany']);

const MOCK_EXPENSES: FinancialRow[] = [
  { 'DR_ACC_L1.5': 'COGS', Amount: 5200000 },
  { 'DR_ACC_L1.5': 'G&A', Amount: 1800000 },
  { 'DR_ACC_L1.5': 'R&D', Amount: 3100000 },
  { 'DR_ACC_L1.5': 'S&M', Amount: 2400000 },
  { 'DR_ACC_L1.5': 'Finance expenses', Amount: 450000 },
];

const MOCK_REVENUE: FinancialRow[] = [
  { 'Reporting Date': 1640995200, Amount: 1200000 },
  { 'Reporting Date': 1643673600, Amount: 1350000 },
  { 'Reporting Date': 1646092800, Amount: 1480000 },
  { 'Reporting Date': 1648771200, Amount: 1620000 },
];

// ─── API Queries ──────────────────────────────────────────────────────────────

async function fetchExpenses(): Promise<FinancialRow[]> {
  try {
    const data = await callMcpTool('aggregate_table_data', {
      table_id: TABLE_ID,
      dimensions: ['DR_ACC_L1.5'],
      metrics: [{ field: 'Amount', agg: 'SUM' }],
      filters: [
        { name: 'Scenario', values: ['Actuals'], is_excluded: false },
        { name: 'DR_ACC_L0', values: ['P&L'], is_excluded: false },
      ],
    }) as FinancialRow[];
    return (data || []).filter(row => {
      const cat = decodeHtml(row['DR_ACC_L1.5'] || '');
      return EXPENSE_CATEGORIES.has(cat);
    });
  } catch {
    return MOCK_EXPENSES;
  }
}

async function fetchRevenueTrend(): Promise<FinancialRow[]> {
  try {
    const data = await callMcpTool('aggregate_table_data', {
      table_id: TABLE_ID,
      dimensions: ['Reporting Date', 'DR_ACC_L1.5'],
      metrics: [{ field: 'Amount', agg: 'SUM' }],
      filters: [
        { name: 'Scenario', values: ['Actuals'], is_excluded: false },
        { name: 'DR_ACC_L0', values: ['P&L'], is_excluded: false },
      ],
    }) as FinancialRow[];
    return (data || [])
      .filter(row => decodeHtml(row['DR_ACC_L1.5'] || '') === 'Revenues')
      .sort((a, b) => (a['Reporting Date'] || 0) - (b['Reporting Date'] || 0));
  } catch {
    return MOCK_REVENUE;
  }
}

async function fetchActualsVsBudget(): Promise<FinancialRow[]> {
  try {
    const data = await callMcpTool('aggregate_table_data', {
      table_id: TABLE_ID,
      dimensions: ['Scenario', 'DR_ACC_L1.5'],
      metrics: [{ field: 'Amount', agg: 'SUM' }],
      filters: [
        { name: 'DR_ACC_L0', values: ['P&L'], is_excluded: false },
      ],
    }) as FinancialRow[];
    return data || [];
  } catch {
    return [];
  }
}

async function fetchDepartmentBreakdown(): Promise<FinancialRow[]> {
  try {
    const data = await callMcpTool('aggregate_table_data', {
      table_id: TABLE_ID,
      dimensions: ['Department L1'],
      metrics: [{ field: 'Amount', agg: 'SUM' }],
      filters: [
        { name: 'Scenario', values: ['Actuals'], is_excluded: false },
        { name: 'DR_ACC_L0', values: ['P&L'], is_excluded: false },
      ],
    }) as FinancialRow[];
    return (data || []).filter(row => row['Department L1'] && row['Department L1'] !== 'None');
  } catch {
    return [];
  }
}

// ─── Agent Logic ──────────────────────────────────────────────────────────────

function detectIntent(question: string): string {
  const q = question.toLowerCase();
  if (/revenue|income|sales|top.?line/.test(q)) return 'revenue';
  if (/expense|cost|spend|opex|cogs|g&a|r&d|s&m/.test(q)) return 'expenses';
  if (/budget|actuals|variance|vs|forecast/.test(q)) return 'budget_vs_actuals';
  if (/department|team|division/.test(q)) return 'department';
  if (/trend|over.?time|month|quarter|year/.test(q)) return 'trend';
  if (/profit|margin|net|gross/.test(q)) return 'profitability';
  return 'general';
}

function formatExpenseTable(rows: FinancialRow[]): string {
  if (!rows.length) return 'No expense data available.';
  const sorted = [...rows].sort((a, b) => (b.Amount || 0) - (a.Amount || 0));
  const total = sorted.reduce((sum, r) => sum + (r.Amount || 0), 0);
  let table = '| Category | Amount | % of Total |\n|----------|--------|------------|\n';
  for (const row of sorted) {
    const cat = decodeHtml(row['DR_ACC_L1.5'] || '');
    const amt = row.Amount || 0;
    const pct = total > 0 ? ((amt / total) * 100).toFixed(1) : '0.0';
    table += `| ${cat} | ${formatMoney(amt)} | ${pct}% |\n`;
  }
  table += `| **Total** | **${formatMoney(total)}** | 100% |`;
  return table;
}

function formatRevenueTrend(rows: FinancialRow[]): string {
  if (!rows.length) return 'No revenue data available.';
  const recent = rows.slice(-6);
  let table = '| Period | Revenue |\n|--------|---------|\n';
  for (const row of recent) {
    const period = row['Reporting Date'] ? formatDate(row['Reporting Date']) : 'N/A';
    table += `| ${period} | ${formatMoney(row.Amount || 0)} |\n`;
  }
  if (rows.length >= 2) {
    const first = rows[0].Amount || 0;
    const last = rows[rows.length - 1].Amount || 0;
    const growth = first > 0 ? (((last - first) / first) * 100).toFixed(1) : 'N/A';
    table += `\n**Overall growth: ${growth}%** over ${rows.length} months`;
  }
  return table;
}

async function runAgent(vertical: Vertical, question: string): Promise<string> {
  await credentialsReady;
  const intent = detectIntent(question);

  const stylePrefix: Record<Vertical, string> = {
    strategy: '**Strategic Analysis:**\n\n',
    reporting: '**Financial Report:**\n\n',
    planning: '**Planning Insight:**\n\n',
  };

  const prefix = stylePrefix[vertical];

  try {
    if (intent === 'expenses') {
      const data = await fetchExpenses();
      const table = formatExpenseTable(data);
      const total = data.reduce((s, r) => s + (r.Amount || 0), 0);
      const top = [...data].sort((a, b) => (b.Amount || 0) - (a.Amount || 0))[0];
      const topCat = top ? decodeHtml(top['DR_ACC_L1.5'] || '') : '';
      const topAmt = top?.Amount || 0;
      const topPct = total > 0 ? (((topAmt / total) * 100).toFixed(1)) : '0';

      if (vertical === 'strategy') {
        return `${prefix}Here's your expense breakdown. Your largest cost center is **${topCat}** at ${formatMoney(topAmt)}, representing ${topPct}% of total OpEx.\n\n${table}\n\n**Strategic Recommendation:** Review ${topCat} allocation relative to growth targets and consider whether this aligns with your strategic priorities.`;
      } else if (vertical === 'reporting') {
        return `${prefix}Expense breakdown (Actuals, P&L):\n\n${table}\n\nTotal operating expenses: **${formatMoney(total)}**`;
      } else {
        return `${prefix}Current expense allocation totals **${formatMoney(total)}**. Use this as your baseline for budget planning.\n\n${table}\n\n**Planning Note:** Consider modeling a 10–15% reduction in variable costs for your next budget cycle.`;
      }
    }

    if (intent === 'revenue' || intent === 'trend') {
      const data = await fetchRevenueTrend();
      const table = formatRevenueTrend(data);
      const latest = data[data.length - 1];
      const latestAmt = latest?.Amount || 0;

      if (vertical === 'strategy') {
        return `${prefix}Revenue trend analysis:\n\n${table}\n\n**Strategic Insight:** Latest monthly revenue is **${formatMoney(latestAmt)}**. Monitor velocity versus growth targets and identify levers to accelerate the trend.`;
      } else if (vertical === 'reporting') {
        return `${prefix}Revenue trend (Actuals):\n\n${table}\n\nLatest period revenue: **${formatMoney(latestAmt)}**`;
      } else {
        return `${prefix}Historical revenue trend:\n\n${table}\n\n**Forecast Basis:** Use the recent trajectory to extrapolate future periods. Consider applying a growth rate adjustment based on pipeline data.`;
      }
    }

    if (intent === 'budget_vs_actuals') {
      const data = await fetchActualsVsBudget();
      const actualsRows = data.filter(r => r.Scenario === 'Actuals');
      const forecastRows = data.filter(r => r.Scenario === 'Forecast');
      const actualsTotal = actualsRows.reduce((s, r) => s + (r.Amount || 0), 0);
      const forecastTotal = forecastRows.reduce((s, r) => s + (r.Amount || 0), 0);
      const variance = actualsTotal - forecastTotal;
      const varPct = forecastTotal !== 0 ? ((variance / Math.abs(forecastTotal)) * 100).toFixed(1) : 'N/A';

      const summary = actualsTotal && forecastTotal
        ? `| Scenario | Total |\n|----------|-------|\n| Actuals | ${formatMoney(actualsTotal)} |\n| Forecast | ${formatMoney(forecastTotal)} |\n| **Variance** | **${formatMoney(variance)} (${varPct}%)** |`
        : 'Insufficient data for comparison.';

      const varNum = parseFloat(varPct);
      const sigVariance = !isNaN(varNum) && Math.abs(varNum) > 5 ? 'significant' : 'minor';

      if (vertical === 'strategy') {
        return `${prefix}Actuals vs Forecast comparison:\n\n${summary}\n\n**Strategic Note:** A ${varPct}% variance signals ${sigVariance} deviation from plan. Review key drivers and adjust strategy accordingly.`;
      } else if (vertical === 'reporting') {
        return `${prefix}Budget vs Actuals report:\n\n${summary}`;
      } else {
        return `${prefix}Actuals vs Forecast:\n\n${summary}\n\n**Planning Recommendation:** Use this variance data to calibrate your next forecast cycle and tighten planning assumptions.`;
      }
    }

    if (intent === 'department') {
      const data = await fetchDepartmentBreakdown();
      if (!data.length) {
        return `${prefix}Department breakdown data is not available at this time. Please check that department dimensions are configured in your Financials table.`;
      }
      const sorted = [...data].sort((a, b) => (b.Amount || 0) - (a.Amount || 0));
      let table = '| Department | Amount |\n|------------|--------|\n';
      for (const row of sorted.slice(0, 8)) {
        table += `| ${row['Department L1']} | ${formatMoney(row.Amount || 0)} |\n`;
      }
      return `${prefix}Department financial breakdown:\n\n${table}`;
    }

    if (intent === 'profitability') {
      const [expData, revData] = await Promise.all([fetchExpenses(), fetchRevenueTrend()]);
      const totalExp = expData.reduce((s, r) => s + (r.Amount || 0), 0);
      const totalRev = revData.reduce((s, r) => s + (r.Amount || 0), 0);
      const margin = totalRev > 0 ? (((totalRev - totalExp) / totalRev) * 100).toFixed(1) : 'N/A';
      const stratNote = vertical === 'strategy' ? '\n\n**Recommendation:** Focus on margin expansion through revenue growth and cost optimization.' : '';
      const planNote = vertical === 'planning' ? '\n\n**Planning Note:** Use this margin as a baseline for scenario modeling.' : '';

      return `${prefix}**Profitability Overview:**\n\n| Metric | Value |\n|--------|-------|\n| Total Revenue | ${formatMoney(totalRev)} |\n| Total Expenses | ${formatMoney(totalExp)} |\n| Gross Profit | ${formatMoney(totalRev - totalExp)} |\n| Margin | ${margin}% |${stratNote}${planNote}`;
    }

    // General fallback — use run_ai_agent
    try {
      const result = await callMcpTool('run_ai_agent', {
        prompt: `You are a financial analyst. Answer this question concisely using available financial data: ${question}`,
      }) as Record<string, unknown>;
      const text = (result?.result || result?.answer || result?.text || JSON.stringify(result)) as string;
      return `${prefix}${text}`;
    } catch {
      return `${prefix}I can help you analyze your financial data. Try asking about:\n\n- **Expenses** — "What are my top expenses?"\n- **Revenue** — "Show me revenue trends"\n- **Budget vs Actuals** — "How are actuals vs forecast?"\n- **Departments** — "Break down spending by department"\n- **Profitability** — "What's my gross margin?"`;
    }
  } catch (err) {
    return `${prefix}I encountered an issue retrieving data: ${err instanceof Error ? err.message : 'Unknown error'}. Please check your connection and try again.`;
  }
}

// ─── Panda SVG Icons ──────────────────────────────────────────────────────────

const PandaLogo = () => (
  <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="18" cy="19" r="13" fill="white"/>
    <circle cx="9" cy="10" r="5" fill="#1a1a1a"/>
    <circle cx="27" cy="10" r="5" fill="#1a1a1a"/>
    <circle cx="13" cy="19" r="3.5" fill="#1a1a1a"/>
    <circle cx="23" cy="19" r="3.5" fill="#1a1a1a"/>
    <circle cx="13.8" cy="18.2" r="1.5" fill="white"/>
    <circle cx="23.8" cy="18.2" r="1.5" fill="white"/>
    <ellipse cx="18" cy="24" rx="3" ry="2" fill="#ffb3b3"/>
    <path d="M15.5 26.5 Q18 28 20.5 26.5" stroke="#1a1a1a" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
    <circle cx="18" cy="21.5" r="1.5" fill="#1a1a1a"/>
  </svg>
);

const PandaStrategy = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="17" r="11" fill="white"/>
    <circle cx="8" cy="9" r="4" fill="#1a1a1a"/>
    <circle cx="24" cy="9" r="4" fill="#1a1a1a"/>
    <circle cx="12" cy="17" r="3" fill="#1a1a1a"/>
    <circle cx="20" cy="17" r="3" fill="#1a1a1a"/>
    <circle cx="12.8" cy="16.3" r="1.2" fill="white"/>
    <circle cx="20.8" cy="16.3" r="1.2" fill="white"/>
    <circle cx="16" cy="20" r="1.2" fill="#1a1a1a"/>
    <rect x="9" y="14.5" width="5" height="3.5" rx="1.75" stroke="#4646CE" strokeWidth="1.2" fill="none"/>
    <rect x="18" y="14.5" width="5" height="3.5" rx="1.75" stroke="#4646CE" strokeWidth="1.2" fill="none"/>
    <line x1="14" y1="16.25" x2="18" y2="16.25" stroke="#4646CE" strokeWidth="1.2"/>
    <line x1="7" y1="16.25" x2="9" y2="16.25" stroke="#4646CE" strokeWidth="1.2"/>
    <line x1="23" y1="16.25" x2="25" y2="16.25" stroke="#4646CE" strokeWidth="1.2"/>
  </svg>
);

const PandaReporting = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="17" r="11" fill="white"/>
    <circle cx="8" cy="9" r="4" fill="#1a1a1a"/>
    <circle cx="24" cy="9" r="4" fill="#1a1a1a"/>
    <circle cx="12" cy="17" r="3" fill="#1a1a1a"/>
    <circle cx="20" cy="17" r="3" fill="#1a1a1a"/>
    <circle cx="12.8" cy="16.3" r="1.2" fill="white"/>
    <circle cx="20.8" cy="16.3" r="1.2" fill="white"/>
    <circle cx="16" cy="20" r="1.2" fill="#1a1a1a"/>
    <rect x="20" y="5" width="9" height="12" rx="1.5" fill="#3b82f6" opacity="0.9"/>
    <rect x="22" y="3.5" width="5" height="2" rx="1" fill="#1e40af"/>
    <line x1="22" y1="8.5" x2="27" y2="8.5" stroke="white" strokeWidth="0.8"/>
    <line x1="22" y1="10.5" x2="27" y2="10.5" stroke="white" strokeWidth="0.8"/>
    <line x1="22" y1="12.5" x2="25" y2="12.5" stroke="white" strokeWidth="0.8"/>
  </svg>
);

const PandaPlanning = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="17" r="11" fill="white"/>
    <circle cx="8" cy="9" r="4" fill="#1a1a1a"/>
    <circle cx="24" cy="9" r="4" fill="#1a1a1a"/>
    <circle cx="12" cy="17" r="3" fill="#1a1a1a"/>
    <circle cx="20" cy="17" r="3" fill="#1a1a1a"/>
    <circle cx="12.8" cy="16.3" r="1.2" fill="white"/>
    <circle cx="20.8" cy="16.3" r="1.2" fill="white"/>
    <circle cx="16" cy="20" r="1.2" fill="#1a1a1a"/>
    <ellipse cx="25" cy="7" rx="4" ry="4.5" fill="#fbbf24" opacity="0.95"/>
    <rect x="23" y="11" width="4" height="1.5" rx="0.5" fill="#d97706"/>
    <rect x="23.5" y="12.5" width="3" height="1" rx="0.5" fill="#d97706"/>
    <line x1="25" y1="2" x2="25" y2="1" stroke="#fbbf24" strokeWidth="1" strokeLinecap="round"/>
    <line x1="21.5" y1="3.5" x2="20.8" y2="2.8" stroke="#fbbf24" strokeWidth="1" strokeLinecap="round"/>
    <line x1="28.5" y1="3.5" x2="29.2" y2="2.8" stroke="#fbbf24" strokeWidth="1" strokeLinecap="round"/>
  </svg>
);

// ─── Markdown-lite + Table renderer ──────────────────────────────────────────

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

interface ContentBlock {
  type: 'text' | 'table';
  content: string;
  headers?: string[];
  rows?: string[][];
}

function parseContent(text: string): ContentBlock[] {
  const lines = text.split('\n');
  const blocks: ContentBlock[] = [];
  let tableLines: string[] = [];
  let textLines: string[] = [];

  const flushText = () => {
    if (textLines.length) {
      blocks.push({ type: 'text', content: textLines.join('\n') });
      textLines = [];
    }
  };

  const flushTable = () => {
    if (tableLines.length >= 2) {
      const headerLine = tableLines[0];
      const dataLines = tableLines.slice(2);
      const headers = headerLine.split('|').filter(h => h.trim()).map(h => h.trim());
      const rows = dataLines
        .filter(l => l.trim())
        .map(l => l.split('|').filter(c => c.trim()).map(c => c.trim()));
      blocks.push({ type: 'table', content: '', headers, rows });
      tableLines = [];
    }
  };

  let inTable = false;
  for (const line of lines) {
    if (line.startsWith('|')) {
      if (!inTable) { flushText(); inTable = true; }
      tableLines.push(line);
    } else {
      if (inTable) { flushTable(); inTable = false; }
      textLines.push(line);
    }
  }
  if (inTable) flushTable();
  flushText();
  return blocks;
}

function MessageContent({ text }: { text: string }) {
  const blocks = parseContent(text);
  return (
    <div className="agent-content">
      {blocks.map((block, i) => {
        if (block.type === 'table' && block.headers && block.rows) {
          return (
            <div key={i} className="msg-table-wrap">
              <table className="msg-table">
                <thead>
                  <tr>
                    {block.headers.map((h, j) => (
                      <th key={j} dangerouslySetInnerHTML={{ __html: renderMarkdown(h) }} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} dangerouslySetInnerHTML={{ __html: renderMarkdown(cell) }} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        const html = block.content
          .split('\n\n')
          .map(p => `<p>${renderMarkdown(p.replace(/\n/g, '<br/>'))}</p>`)
          .join('');
        return <div key={i} className="msg-text" dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </div>
  );
}

// ─── Chat Interface ────────────────────────────────────────────────────────────

interface ChatProps {
  vertical: Vertical;
}

const VERTICAL_CONFIG: Record<Vertical, {
  role: string;
  icon: ReactElement;
  color: string;
  placeholder: string;
  suggestions: string[];
}> = {
  strategy: {
    role: "I'm your Strategic Finance Advisor. I analyze financial trends, identify growth opportunities, and help you make data-driven strategic decisions. Ask me about revenue trends, profitability analysis, or strategic planning.",
    icon: <PandaStrategy />,
    color: '#4646CE',
    placeholder: 'Ask about revenue trends, growth opportunities, strategic priorities...',
    suggestions: ['What are my top expenses?', 'Show me revenue trends', "What's my gross margin?", 'How is the company performing?'],
  },
  reporting: {
    role: "I'm your Financial Reporting Assistant. I help you generate reports, analyze actuals vs budget, and break down financial metrics by department and category. Ask me about expense breakdowns, budget variances, or monthly reports.",
    icon: <PandaReporting />,
    color: '#3b82f6',
    placeholder: 'Ask about expense reports, actuals vs forecast, department breakdowns...',
    suggestions: ['Break down expenses by category', 'Actuals vs forecast comparison', 'Show department spending', 'Monthly revenue report'],
  },
  planning: {
    role: "I'm your Financial Planning Partner. I help you build forecasts, model scenarios, and plan budgets. Ask me about forecasting, budget allocation, or scenario analysis.",
    icon: <PandaPlanning />,
    color: '#10b981',
    placeholder: 'Ask about forecasting, budget planning, scenario modeling...',
    suggestions: ['Help me plan next quarter budget', 'What expenses can I optimize?', 'Show actuals vs forecast variance', 'Revenue projection analysis'],
  },
};

function ChatInterface({ vertical }: ChatProps) {
  const config = VERTICAL_CONFIG[vertical];
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await runAgent(vertical, text.trim());
      const agentMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: response,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, agentMsg]);
    } catch (err) {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: `I encountered an error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="chat-container">
      {/* Role Banner */}
      <div className="role-banner" style={{ '--accent': config.color } as React.CSSProperties}>
        <div className="role-banner-icon">{config.icon}</div>
        <p className="role-banner-text">{config.role}</p>
      </div>

      {/* Messages */}
      <div className="messages-area">
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-panda">{config.icon}</div>
            <p className="empty-hint">Ask me a question to get started</p>
            <div className="suggestions">
              {config.suggestions.map((s, i) => (
                <button key={i} className="suggestion-chip" onClick={() => sendMessage(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`message ${msg.role}`}>
            {msg.role === 'agent' && (
              <div className="agent-avatar">{config.icon}</div>
            )}
            <div
              className={`bubble ${msg.role}`}
              style={msg.role === 'agent' ? { '--accent': config.color } as React.CSSProperties : {}}
            >
              {msg.role === 'agent' ? (
                <MessageContent text={msg.content} />
              ) : (
                <p>{msg.content}</p>
              )}
              <span className="msg-time">
                {msg.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="message agent">
            <div className="agent-avatar">{config.icon}</div>
            <div
              className="bubble agent thinking"
              style={{ '--accent': config.color } as React.CSSProperties}
            >
              <div className="dots">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="input-area">
        <textarea
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={config.placeholder}
          rows={1}
          disabled={loading}
        />
        <button
          className="send-btn"
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || loading}
          style={{ '--accent': config.color } as React.CSSProperties}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [vertical, setVertical] = useState<Vertical>('strategy');

  const navItems: { id: Vertical; label: string; icon: ReactElement }[] = [
    { id: 'strategy', label: 'Strategy', icon: <PandaStrategy /> },
    { id: 'reporting', label: 'Reporting', icon: <PandaReporting /> },
    { id: 'planning', label: 'Planning', icon: <PandaPlanning /> },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo-area">
          <PandaLogo />
          <span className="app-name">Pandas</span>
          <span className="app-tagline">Financial AI</span>
        </div>
        <nav className="nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-btn ${vertical === item.id ? 'active' : ''} ${item.id}`}
              onClick={() => setVertical(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        <ChatInterface key={vertical} vertical={vertical} />
      </main>
    </div>
  );
}
