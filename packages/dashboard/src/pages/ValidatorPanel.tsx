import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../App.js";
import type { Task, Agent } from "@talken/shared";

interface ValidatorPanelProps {
  agentId: string;
}

export function ValidatorPanel({ agentId }: ValidatorPanelProps) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [stakeAmount, setStakeAmount] = useState("200");
  const [unstakeAmount, setUnstakeAmount] = useState("50");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [agentRes, tasksRes] = await Promise.all([
        fetch(`${API_BASE}/agents/${agentId}`, {
          headers: { "X-Talken-Agent-Id": agentId },
        }),
        fetch(`${API_BASE}/tasks?status=submitted`, {
          headers: { "X-Talken-Agent-Id": agentId },
        }),
      ]);
      if (agentRes.ok) {
        const data = await agentRes.json();
        setAgent(data.agent);
      }
      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setPendingTasks(data.tasks ?? []);
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleStake = async () => {
    try {
      const res = await fetch(`${API_BASE}/validators/stake`, {
        method: "POST",
        headers: {
          "X-Talken-Agent-Id": agentId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: parseFloat(stakeAmount) }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Stake failed");
    }
  };

  const handleUnstake = async () => {
    try {
      const res = await fetch(`${API_BASE}/validators/unstake`, {
        method: "POST",
        headers: {
          "X-Talken-Agent-Id": agentId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: parseFloat(unstakeAmount) }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Unstake failed");
    }
  };

  const handleVote = async (taskId: string, passed: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/verify`, {
        method: "POST",
        headers: {
          "X-Talken-Agent-Id": agentId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ passed }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Vote failed");
    }
  };

  if (loading) return <p className="text-gray-400">Loading...</p>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Validator Panel</h2>

      {error && (
        <p className="text-red-400 bg-red-900/30 rounded p-3 mb-4">{error}</p>
      )}

      {/* Agent info */}
      {agent && (
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700 mb-6">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Balance</span>
              <p className="text-xl font-bold">{agent.balance}</p>
            </div>
            <div>
              <span className="text-gray-400">Staked</span>
              <p className="text-xl font-bold">{agent.stakeAmount}</p>
            </div>
            <div>
              <span className="text-gray-400">Reputation</span>
              <p className="text-xl font-bold">{agent.reputation}</p>
            </div>
          </div>
        </div>
      )}

      {/* Stake / Unstake */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <h3 className="font-semibold mb-3">Stake</h3>
          <div className="flex gap-2">
            <input
              type="number"
              min="1"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={handleStake}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded font-medium"
            >
              Stake
            </button>
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <h3 className="font-semibold mb-3">Unstake</h3>
          <div className="flex gap-2">
            <input
              type="number"
              min="1"
              value={unstakeAmount}
              onChange={(e) => setUnstakeAmount(e.target.value)}
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={handleUnstake}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded font-medium"
            >
              Unstake
            </button>
          </div>
        </div>
      </div>

      {/* Pending tasks to vote on */}
      <h3 className="text-lg font-semibold mb-4">Pending Verification Tasks</h3>
      {pendingTasks.length === 0 && (
        <p className="text-gray-400">No tasks pending verification.</p>
      )}
      <div className="space-y-3">
        {pendingTasks.map((task) => (
          <div
            key={task.id}
            className="bg-gray-800 rounded-lg p-4 border border-gray-700"
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-xs font-mono text-gray-400">{task.id}</span>
                <h4 className="font-medium capitalize">{task.skill}</h4>
              </div>
              <span className="text-sm text-gray-400">Fee: {task.fee}</span>
            </div>
            {task.result && (
              <pre className="text-xs text-gray-400 bg-gray-900 rounded p-2 mb-3 max-h-24 overflow-auto">
                {JSON.stringify(task.result, null, 2)}
              </pre>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => handleVote(task.id, true)}
                className="px-4 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm font-medium"
              >
                Pass
              </button>
              <button
                onClick={() => handleVote(task.id, false)}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm font-medium"
              >
                Fail
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
