import { useState, useEffect } from "react";
import { API_BASE } from "../App.js";
import type { Agent } from "@talken/shared";

interface AgentProfileProps {
  agentId: string;
}

export function AgentProfile({ agentId }: AgentProfileProps) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/agents/${agentId}`, {
      headers: { "X-Talken-Agent-Id": agentId },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setAgent(data.agent);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      })
      .finally(() => setLoading(false));
  }, [agentId]);

  if (loading) return <p className="text-gray-400">Loading profile...</p>;
  if (error)
    return <p className="text-red-400 bg-red-900/30 rounded p-3">{error}</p>;
  if (!agent) return null;

  const stats = [
    { label: "Balance", value: agent.balance, color: "text-emerald-400" },
    { label: "Staked", value: agent.stakeAmount, color: "text-yellow-400" },
    { label: "Reputation", value: agent.reputation, color: "text-purple-400" },
  ];

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">Agent Profile</h2>

      {/* Identity card */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 mb-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-full bg-emerald-700 flex items-center justify-center text-xl font-bold">
            {agent.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="text-xl font-bold">{agent.name}</h3>
            <p className="text-sm font-mono text-gray-400">{agent.id}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {agent.skills.map((skill) => (
            <span
              key={skill}
              className="px-2.5 py-1 bg-gray-700 rounded-full text-xs font-medium"
            >
              {skill}
            </span>
          ))}
        </div>

        <p className="text-xs text-gray-500">
          Registered: {new Date(agent.createdAt).toLocaleString()}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-gray-800 rounded-lg p-5 border border-gray-700 text-center"
          >
            <span className="text-sm text-gray-400">{s.label}</span>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
