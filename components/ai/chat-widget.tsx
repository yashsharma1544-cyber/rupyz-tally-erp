"use client";

import { useState, useEffect, useRef } from "react";
import { MessageSquare, X, Send, Plus, AlertCircle, Loader2 } from "lucide-react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ChatThread {
  id: string;
  title: string | null;
  updated_at: string;
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showThreads, setShowThreads] = useState(false);
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // Load thread list when opened
  useEffect(() => {
    if (!open) return;
    fetch("/api/ai/chat/threads").then(r => r.json()).then(d => {
      if (d.ok) setThreads(d.threads);
    }).catch(() => {});
  }, [open]);

  // Load thread messages when threadId changes
  useEffect(() => {
    if (!threadId) { setMessages([]); return; }
    fetch(`/api/ai/chat/threads?id=${threadId}`).then(r => r.json()).then(d => {
      if (d.ok) setMessages(d.messages);
    }).catch(() => {});
  }, [threadId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  async function send() {
    if (!draft.trim() || sending) return;
    const userMsg: ChatMessage = { 
      id: `tmp-${Date.now()}`, 
      role: "user", 
      content: draft.trim() 
    };
    setMessages(m => [...m, userMsg]);
    const messageToSend = draft.trim();
    setDraft("");
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, message: messageToSend }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed");
        return;
      }
      setThreadId(data.threadId);
      setMessages(m => [...m, {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: data.reply,
      }]);
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setSending(false);
    }
  }

  function newThread() {
    setThreadId(null);
    setMessages([]);
    setShowThreads(false);
  }

  function openThread(id: string) {
    setThreadId(id);
    setShowThreads(false);
  }

  if (!mounted) return null;

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open AI chat"
          className="fixed bottom-6 right-6 z-40 bg-accent text-white rounded-full p-3 shadow-lg hover:opacity-90 transition-opacity"
        >
          <MessageSquare size={20} />
        </button>
      )}

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:inset-auto lg:bottom-6 lg:right-6 lg:w-[420px] lg:h-[600px] bg-paper-card border border-paper-line rounded-md shadow-xl flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-paper-line flex items-center justify-between gap-2">
            <h3 className="font-semibold inline-flex items-center gap-1.5">
              <MessageSquare size={14} className="text-accent" />
              AI Assistant
            </h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowThreads(!showThreads)}
                className="text-xs text-ink-muted hover:text-ink px-2 py-1"
              >
                {showThreads ? "Chat" : "History"}
              </button>
              <button
                type="button"
                onClick={newThread}
                className="text-ink-muted hover:text-ink p-1"
                aria-label="New chat"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-ink-muted hover:text-ink p-1"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Body */}
          {showThreads ? (
            <div className="flex-1 overflow-y-auto p-2">
              {threads.length === 0 ? (
                <div className="p-4 text-sm text-ink-subtle">No previous conversations.</div>
              ) : (
                threads.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => openThread(t.id)}
                    className="w-full text-left px-2 py-2 hover:bg-paper-subtle rounded text-sm truncate"
                  >
                    <div className="truncate font-medium">{t.title || "Untitled"}</div>
                    <div className="text-2xs text-ink-subtle">
                      {new Date(t.updated_at).toLocaleString("en-IN")}
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.length === 0 && (
                  <div className="text-sm text-ink-subtle p-4 text-center">
                    Ask anything about your business data.<br/>
                    e.g., &quot;Which beats had the worst week?&quot;
                  </div>
                )}
                {messages.map(m => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      m.role === "user" 
                        ? "bg-accent text-white" 
                        : "bg-paper-subtle text-ink"
                    }`}>
                      <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div className="bg-paper-subtle rounded-lg px-3 py-2 text-sm inline-flex items-center gap-2">
                      <Loader2 size={12} className="animate-spin" />
                      <span className="text-ink-muted">Thinking...</span>
                    </div>
                  </div>
                )}
                {error && (
                  <div className="bg-danger-soft text-danger text-xs rounded px-3 py-2 flex items-start gap-2">
                    <AlertCircle size={12} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="border-t border-paper-line p-2">
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder="Ask anything..."
                    rows={1}
                    disabled={sending}
                    className="flex-1 resize-none border border-paper-line rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
                    style={{ maxHeight: 100 }}
                  />
                  <button
                    type="button"
                    onClick={send}
                    disabled={sending || !draft.trim()}
                    className="bg-accent text-white rounded p-2 hover:opacity-90 disabled:opacity-50"
                    aria-label="Send"
                  >
                    <Send size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
