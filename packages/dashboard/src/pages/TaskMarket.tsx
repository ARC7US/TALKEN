import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../App.js";
import type { Task } from "@talken/shared";

interface TaskMarketProps {
  agentId: string;
  onViewTask: (taskId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  published: "bg-blue-600",
  accepted: "bg-yellow-600",
  submitted: "bg-purple-600",
  verified: "bg-indigo-600",
  confirmed: "bg-emerald-600",
  settled: "bg-green-700",
  expired: "bg-gray-600",
  rejected: "bg-red-600",
};

export function TaskMarket({ agentId, onViewTask }: TaskMarketProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        headers: { "X-Talken-Agent-Id": agentId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTasks(data.tasks ?? []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch tasks");
    }
  }, [agentId]);

  useEffect(() => {
    setLoading(true);
    fetchTasks().finally(() => setLoading(false));
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleAccept = async (taskId: string) => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/accept`, {
        method: "POST",
        headers: { "X-Talken-Agent-Id": agentId },
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await fetchTasks();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Accept failed");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Task Market</h2>
        <button
          onClick={fetchTasks}
          className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm"
        >
          Refresh
        </button>
      </div>

      {loading && tasks.length === 0 && (
        <p className="text-gray-400">Loading tasks...</p>
      )}
      {error && (
        <p className="text-red-400 bg-red-900/30 rounded p-3 mb-4">{error}</p>
      )}
      {tasks.length === 0 && !loading && (
        <p className="text-gray-400">No tasks found.</p>
      )}

      <div className="grid gap-4">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="bg-gray-800 rounded-lg p-5 border border-gray-700 hover:border-gray-500 transition-colors cursor-pointer"
            onClick={() => onViewTask(task.id)}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <span className="text-xs font-mono text-gray-400">
                  {task.id}
                </span>
                <h3 className="text-lg font-semibold mt-1 capitalize">
                  {task.skill}
                </h3>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-medium text-white ${STATUS_COLORS[task.status] ?? "bg-gray-600"}`}
              >
                {task.status}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-4 text-sm mb-4">
              <div>
                <span className="text-gray-400">Fee</span>
                <p className="font-medium">{task.fee}</p>
              </div>
              <div>
                <span className="text-gray-400">Complexity</span>
                <p className="font-medium">{task.complexity}</p>
              </div>
              <div>
                <span className="text-gray-400">Publisher</span>
                <p className="font-medium font-mono text-xs">{task.publisherId}</p>
              </div>
              <div>
                <span className="text-gray-400">Executor</span>
                <p className="font-medium font-mono text-xs">
                  {task.executorId ?? "—"}
                </p>
              </div>
            </div>

            {task.status === "published" && (
              <button
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-medium"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAccept(task.id);
                }}
              >
                Accept Task
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
