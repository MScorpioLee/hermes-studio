# Workflow Storage Plan

This document captures the first workflow storage scope for Hermes Web UI.

## Requirements

- Users can create a workflow with a name, selected profile, and optional
  workspace path.
- A workflow can have multiple start nodes and multiple terminal nodes.
- Nodes and edges are stored as JSON strings on the workflow record for the
  first implementation.
- Each node can select an agent, provider, model, and API mode.
- API mode describes the runtime request shape used by coding agents, such as
  `chat_completions`, `codex_responses`, or `anthropic_messages`.
- Each node has one `input` field. There is no separate node system prompt in
  this scope.
- Each node can reference skills by skill name only. Skill details are resolved
  at execution time through the selected agent's skill runtime.
- Each node can reference multiple uploaded images by stored path. No separate
  workflow image table is used.
- Edge relationships must not form a cycle. Cycle detection is enforced in the
  service layer when saving a workflow.
- A workflow can run from all inferred start nodes or from one or more selected
  nodes.
- Workflow execution messages are stored in a dedicated table with fields aligned
  to the existing single-chat message shape.

## Workflow Definition

`workflows.nodes_json` stores an array of node objects:

```json
[
  {
    "id": "node-1",
    "type": "agent",
    "title": "Node 1",
    "agent": "codex",
    "provider": "openai",
    "model": "gpt-5",
    "apiMode": "anthropic_messages",
    "input": "Analyze the uploaded screenshots.",
    "skills": ["github-pr-workflow", "code-review"],
    "images": ["workflows/wf_1/node_1/screenshot.png"],
    "position": { "x": 100, "y": 200 },
    "size": { "width": 260, "height": 240 }
  }
]
```

`workflows.edges_json` stores an array of edge objects:

```json
[
  {
    "id": "edge-1",
    "source": "node-1",
    "target": "node-2",
    "sourceHandle": "output",
    "targetHandle": "input"
  }
]
```

Start nodes are inferred as nodes with no incoming edge. Terminal nodes are
inferred as nodes with no outgoing edge.

## Execution Rules

- `workflow_runs.start_node_ids_json = []` means run from all inferred start
  nodes.
- A non-empty `start_node_ids_json` means run from those selected nodes and their
  downstream reachable subgraph.
- A node with multiple upstream dependencies runs after all upstream nodes in the
  selected execution subgraph complete.
- A run completes when every reachable node in the selected execution subgraph
  completes.
- `workflow_runs.snapshot_nodes_json` and `snapshot_edges_json` store the
  workflow definition at run start so historical run records remain stable after
  later workflow edits.

## Tables

```sql
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT 'default',
  workspace TEXT,
  nodes_json TEXT NOT NULL DEFAULT '[]',
  edges_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT 'default',
  workspace TEXT,
  start_node_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'queued',
  snapshot_nodes_json TEXT NOT NULL DEFAULT '[]',
  snapshot_edges_json TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  error TEXT
);

CREATE TABLE workflow_run_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  node_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  display_role TEXT,
  display_content TEXT,
  tool_call_id TEXT,
  tool_calls TEXT,
  tool_name TEXT,
  timestamp INTEGER NOT NULL,
  token_count INTEGER,
  finish_reason TEXT,
  reasoning TEXT,
  reasoning_details TEXT,
  reasoning_content TEXT,
  sequence INTEGER NOT NULL DEFAULT 0
);
```
