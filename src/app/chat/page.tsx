"use client";
import { useState } from "react";

interface AgentResult {
  text: string;
  type?: string;
  confidence?: number;
  sources?: Array<{ id: string; snippet: string; similarity: number }>;
  metadata?: Record<string, any>;
}

export default function Chat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<{role: "user" | "assistant"; text: string}>>([]);
  const [loading, setLoading] = useState(false);

  const send = async () => {
    if (!input.trim()) return;
    const userText = input;
    setInput("");
    setMessages([...messages, { role: "user", text: userText }]);
    setLoading(true);
    try {
      const resp = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userText,
          context: {
            source: "http",
            serviceId: "chat-demo",
            spaceId: "chat-space-1",
            userId: "demo-user",
            trigger: "mention",
            responseMode: "public",
            memoryAccess: {
              own: true,
              user: true,
              space: true,
              service: true,
              write: false,
            },
          },
        }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        setMessages([...messages, { role: "assistant", text: `Error: ${err.error?.message ?? resp.status}` }]);
      } else {
        const data: AgentResult = await resp.json();
        setMessages([...messages, { role: "assistant", text: data.text ?? "" }]);
      }
    } catch (e) {
      setMessages([...messages, { role: "assistant", text: `Error: ${e}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-gray-900">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[80%] ${m.role === "user" ? "ml-auto" : "mr-auto"} p-3 rounded-lg ${
            m.role === "user" ? "bg-blue-500 text-white" : "bg-gray-200 dark:bg-gray-700 text-white"
          }`}>
            <p className="whitespace-pre-wrap">{m.text}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center p-4 border-t">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 p-2 rounded border disabled:opacity-50"
          disabled={loading}
          onKeyDown={(e) => e.key === "Enter" && !loading && send()}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="ml-2 px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
        >
          {loading ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}