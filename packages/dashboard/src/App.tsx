import { useState } from "react";
import { TaskMarket } from "./pages/TaskMarket.js";
import { TaskDetail } from "./pages/TaskDetail.js";
import { PublishTask } from "./pages/PublishTask.js";
import { ValidatorPanel } from "./pages/ValidatorPanel.js";
import { AgentProfile } from "./pages/AgentProfile.js";

export const API_BASE = "/api/v1";

const PRESET_AGENTS = [
  { id: "publisher_1", label: "Publisher 1" },
  { id: "executor_1", label: "Executor 1" },
  { id: "validator_1", label: "Validator 1" },
  { id: "validator_2", label: "Validator 2" },
  { id: "validator_3", label: "Validator 3" },
];

type Page =
  | { name: "market" }
  | { name: "taskDetail"; taskId: string }
  | { name: "publishTask" }
  | { name: "validatorPanel" }
  | { name: "agentProfile" };

export function App() {
  const [currentAgentId, setCurrentAgentId] = useState("publisher_1");
  const [page, setPage] = useState<Page>({ name: "market" });

  const navigate = (p: Page) => setPage(p);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Top nav bar */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1
            className="text-xl font-bold text-emerald-400 cursor-pointer"
            onClick={() => navigate({ name: "market" })}
          >
            TALKEN
          </h1>
          <nav className="flex gap-2 text-sm">
            <button
              className={`px-3 py-1 rounded ${page.name === "market" ? "bg-emerald-600" : "hover:bg-gray-700"}`}
              onClick={() => navigate({ name: "market" })}
            >
              Market
            </button>
            <button
              className={`px-3 py-1 rounded ${page.name === "publishTask" ? "bg-emerald-600" : "hover:bg-gray-700"}`}
              onClick={() => navigate({ name: "publishTask" })}
            >
              Publish Task
            </button>
            <button
              className={`px-3 py-1 rounded ${page.name === "validatorPanel" ? "bg-emerald-600" : "hover:bg-gray-700"}`}
              onClick={() => navigate({ name: "validatorPanel" })}
            >
              Validator
            </button>
            <button
              className={`px-3 py-1 rounded ${page.name === "agentProfile" ? "bg-emerald-600" : "hover:bg-gray-700"}`}
              onClick={() => navigate({ name: "agentProfile" })}
            >
              Profile
            </button>
          </nav>
        </div>

        {/* Agent switcher */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Agent:</span>
          <select
            className="bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:outline-none focus:border-emerald-500"
            value={currentAgentId}
            onChange={(e) => setCurrentAgentId(e.target.value)}
          >
            {PRESET_AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-6xl mx-auto p-6">
        {page.name === "market" && (
          <TaskMarket
            agentId={currentAgentId}
            onViewTask={(taskId) => navigate({ name: "taskDetail", taskId })}
          />
        )}
        {page.name === "taskDetail" && (
          <TaskDetail
            taskId={page.taskId}
            agentId={currentAgentId}
            onBack={() => navigate({ name: "market" })}
          />
        )}
        {page.name === "publishTask" && (
          <PublishTask
            agentId={currentAgentId}
            onPublished={() => navigate({ name: "market" })}
          />
        )}
        {page.name === "validatorPanel" && (
          <ValidatorPanel agentId={currentAgentId} />
        )}
        {page.name === "agentProfile" && (
          <AgentProfile agentId={currentAgentId} />
        )}
      </main>
    </div>
  );
}
