<script setup lang="ts">
import { computed, ref } from 'vue'
import { Handle, Position, VueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'

type WorkflowTemplateKey = 'prReview' | 'dailyDigest' | 'deployCheck'
type WorkflowNodeData = {
  phase: string
  title: string
  detail: string
  kind: 'trigger' | 'agent' | 'decision' | 'delivery'
}

type WorkflowNode = {
  id: string
  type: 'workflow'
  position: { x: number; y: number }
  data: WorkflowNodeData
}

type WorkflowEdge = {
  id: string
  source: string
  target: string
  label?: string
  animated?: boolean
  type?: string
}

type WorkflowTemplate = {
  key: WorkflowTemplateKey
  title: string
  schedule: string
  tone: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

const { t } = useI18n()

const templates = computed<WorkflowTemplate[]>(() => [
  {
    key: 'prReview',
    title: t('workflows.templates.prReview.title'),
    schedule: t('workflows.templates.prReview.schedule'),
    tone: t('workflows.templates.prReview.tone'),
    nodes: [
      workflowNode('trigger', 40, 120, 'trigger', t('workflows.nodes.githubWebhook.phase'), t('workflows.nodes.githubWebhook.title'), t('workflows.nodes.githubWebhook.detail')),
      workflowNode('review', 330, 80, 'agent', t('workflows.nodes.reviewAgent.phase'), t('workflows.nodes.reviewAgent.title'), t('workflows.nodes.reviewAgent.detail')),
      workflowNode('gate', 620, 120, 'decision', t('workflows.nodes.signalGate.phase'), t('workflows.nodes.signalGate.title'), t('workflows.nodes.signalGate.detail')),
      workflowNode('deliver', 910, 120, 'delivery', t('workflows.nodes.githubComment.phase'), t('workflows.nodes.githubComment.title'), t('workflows.nodes.githubComment.detail')),
    ],
    edges: [
      workflowEdge('trigger-review', 'trigger', 'review'),
      workflowEdge('review-gate', 'review', 'gate'),
      workflowEdge('gate-deliver', 'gate', 'deliver'),
    ],
  },
  {
    key: 'dailyDigest',
    title: t('workflows.templates.dailyDigest.title'),
    schedule: t('workflows.templates.dailyDigest.schedule'),
    tone: t('workflows.templates.dailyDigest.tone'),
    nodes: [
      workflowNode('trigger', 40, 140, 'trigger', t('workflows.nodes.cron.phase'), t('workflows.nodes.cron.title'), t('workflows.nodes.cron.detail')),
      workflowNode('collect', 330, 80, 'agent', t('workflows.nodes.collector.phase'), t('workflows.nodes.collector.title'), t('workflows.nodes.collector.detail')),
      workflowNode('summarize', 620, 140, 'agent', t('workflows.nodes.digest.phase'), t('workflows.nodes.digest.title'), t('workflows.nodes.digest.detail')),
      workflowNode('deliver', 910, 140, 'delivery', t('workflows.nodes.telegram.phase'), t('workflows.nodes.telegram.title'), t('workflows.nodes.telegram.detail')),
    ],
    edges: [
      workflowEdge('trigger-collect', 'trigger', 'collect'),
      workflowEdge('collect-summarize', 'collect', 'summarize'),
      workflowEdge('summarize-deliver', 'summarize', 'deliver'),
    ],
  },
  {
    key: 'deployCheck',
    title: t('workflows.templates.deployCheck.title'),
    schedule: t('workflows.templates.deployCheck.schedule'),
    tone: t('workflows.templates.deployCheck.tone'),
    nodes: [
      workflowNode('trigger', 40, 90, 'trigger', t('workflows.nodes.deployWebhook.phase'), t('workflows.nodes.deployWebhook.title'), t('workflows.nodes.deployWebhook.detail')),
      workflowNode('smoke', 330, 90, 'agent', t('workflows.nodes.smokeTest.phase'), t('workflows.nodes.smokeTest.title'), t('workflows.nodes.smokeTest.detail')),
      workflowNode('triage', 620, 90, 'decision', t('workflows.nodes.healthGate.phase'), t('workflows.nodes.healthGate.title'), t('workflows.nodes.healthGate.detail')),
      workflowNode('notify', 910, 40, 'delivery', t('workflows.nodes.slack.phase'), t('workflows.nodes.slack.title'), t('workflows.nodes.slack.detail')),
      workflowNode('silent', 910, 180, 'delivery', t('workflows.nodes.silent.phase'), t('workflows.nodes.silent.title'), t('workflows.nodes.silent.detail')),
    ],
    edges: [
      workflowEdge('trigger-smoke', 'trigger', 'smoke'),
      workflowEdge('smoke-triage', 'smoke', 'triage'),
      workflowEdge('triage-notify', 'triage', 'notify', t('workflows.edges.degraded')),
      workflowEdge('triage-silent', 'triage', 'silent', t('workflows.edges.healthy')),
    ],
  },
])

const selectedTemplateKey = ref<WorkflowTemplateKey>('prReview')
const nodes = ref<WorkflowNode[]>([])
const edges = ref<WorkflowEdge[]>([])
const selectedNodeId = ref('')
const draftName = ref(t('workflows.defaultDraftName'))

const selectedNode = computed(() => nodes.value.find(node => node.id === selectedNodeId.value) || nodes.value[0])
const stats = computed(() => ({
  triggers: nodes.value.filter(node => node.data?.kind === 'trigger').length,
  agents: nodes.value.filter(node => node.data?.kind === 'agent').length,
  deliveries: nodes.value.filter(node => node.data?.kind === 'delivery').length,
}))

function workflowNode(
  id: string,
  x: number,
  y: number,
  kind: WorkflowNodeData['kind'],
  phase: string,
  title: string,
  detail: string,
): WorkflowNode {
  return {
    id,
    type: 'workflow',
    position: { x, y },
    data: { phase, title, detail, kind },
  }
}

function workflowEdge(id: string, source: string, target: string, label?: string): WorkflowEdge {
  return {
    id,
    source,
    target,
    label,
    animated: true,
    type: 'smoothstep',
  }
}

function cloneNodes(source: WorkflowNode[]): WorkflowNode[] {
  return source.map(node => ({
    ...node,
    position: { ...node.position },
    data: { ...node.data },
  }))
}

function cloneEdges(source: WorkflowEdge[]): WorkflowEdge[] {
  return source.map(edge => ({ ...edge }))
}

function loadTemplate(key: WorkflowTemplateKey) {
  selectedTemplateKey.value = key
  const template = templates.value.find(item => item.key === key) || templates.value[0]
  nodes.value = cloneNodes(template.nodes)
  edges.value = cloneEdges(template.edges)
  selectedNodeId.value = nodes.value[0]?.id || ''
  draftName.value = template.title
}

function resetTemplate() {
  loadTemplate(selectedTemplateKey.value)
}

function addAgentStep() {
  const stepNumber = nodes.value.length + 1
  const id = `agent-${Date.now()}`
  const previousNode = nodes.value[nodes.value.length - 1]
  nodes.value.push(workflowNode(
    id,
    Math.min(960, 120 + stepNumber * 160),
    300,
    'agent',
    t('workflows.nodes.custom.phase'),
    t('workflows.nodes.custom.title', { count: stepNumber }),
    t('workflows.nodes.custom.detail'),
  ))
  if (previousNode) {
    edges.value.push(workflowEdge(`edge-${previousNode.id}-${id}`, previousNode.id, id))
  }
  selectedNodeId.value = id
}

function handleNodeClick(payload: { node?: { id?: string } }) {
  if (payload.node?.id) selectedNodeId.value = payload.node.id
}

loadTemplate(selectedTemplateKey.value)
</script>

<template>
  <section class="workflows-view">
    <header class="workflow-header">
      <div>
        <h1>{{ t('workflows.title') }}</h1>
        <p>{{ t('workflows.subtitle') }}</p>
      </div>
      <div class="workflow-actions">
        <button class="secondary-action" type="button" @click="resetTemplate">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v6h6" />
          </svg>
          <span>{{ t('workflows.actions.reset') }}</span>
        </button>
        <button class="primary-action" type="button" @click="addAgentStep">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          <span>{{ t('workflows.actions.addStep') }}</span>
        </button>
      </div>
    </header>

    <div class="workflow-shell">
      <aside class="workflow-templates">
        <div class="panel-heading">
          <span>{{ t('workflows.templatesTitle') }}</span>
        </div>
        <button
          v-for="template in templates"
          :key="template.key"
          type="button"
          class="template-item"
          :class="{ active: template.key === selectedTemplateKey }"
          @click="loadTemplate(template.key)"
        >
          <span class="template-title">{{ template.title }}</span>
          <span class="template-meta">{{ template.schedule }}</span>
          <span class="template-tone">{{ template.tone }}</span>
        </button>
      </aside>

      <main class="workflow-canvas-panel">
        <div class="workflow-canvas-toolbar">
          <div>
            <input v-model="draftName" class="draft-name" :aria-label="t('workflows.draftName')" />
            <span class="draft-status">{{ t('workflows.localDraft') }}</span>
          </div>
          <div class="workflow-stats">
            <span>{{ t('workflows.stats.triggers', { count: stats.triggers }) }}</span>
            <span>{{ t('workflows.stats.agents', { count: stats.agents }) }}</span>
            <span>{{ t('workflows.stats.deliveries', { count: stats.deliveries }) }}</span>
          </div>
        </div>

        <div class="workflow-canvas">
          <VueFlow
            v-model:nodes="nodes"
            v-model:edges="edges"
            class="workflow-flow"
            :min-zoom="0.45"
            :max-zoom="1.25"
            :default-viewport="{ x: 40, y: 80, zoom: 0.78 }"
            fit-view-on-init
            @node-click="handleNodeClick"
          >
            <template #node-workflow="{ data, selected }">
              <div class="workflow-node" :class="[data.kind, { selected }]">
                <Handle type="target" :position="Position.Left" />
                <span class="workflow-node__phase">{{ data.phase }}</span>
                <strong>{{ data.title }}</strong>
                <span>{{ data.detail }}</span>
                <Handle type="source" :position="Position.Right" />
              </div>
            </template>
          </VueFlow>
        </div>
      </main>

      <aside class="workflow-inspector">
        <div class="panel-heading">
          <span>{{ t('workflows.inspectorTitle') }}</span>
        </div>
        <template v-if="selectedNode">
          <div class="inspector-kind" :class="selectedNode.data?.kind">{{ selectedNode.data?.phase }}</div>
          <h2>{{ selectedNode.data?.title }}</h2>
          <p>{{ selectedNode.data?.detail }}</p>
          <div class="inspector-fields">
            <label>
              <span>{{ t('workflows.fields.nodeId') }}</span>
              <input :value="selectedNode.id" readonly>
            </label>
            <label>
              <span>{{ t('workflows.fields.delivery') }}</span>
              <select>
                <option>{{ t('workflows.delivery.origin') }}</option>
                <option>{{ t('workflows.delivery.telegram') }}</option>
                <option>{{ t('workflows.delivery.githubComment') }}</option>
                <option>{{ t('workflows.delivery.local') }}</option>
              </select>
            </label>
          </div>
        </template>
      </aside>
    </div>
  </section>
</template>

<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
</style>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.workflows-view {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: $bg-primary;
  color: $text-primary;
}

.workflow-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 28px 18px;
  border-bottom: 1px solid $border-color;

  h1 {
    margin: 0;
    font-size: 24px;
    line-height: 1.2;
    font-weight: 650;
    letter-spacing: 0;
  }

  p {
    margin: 6px 0 0;
    color: $text-secondary;
    font-size: 13px;
  }
}

.workflow-actions,
.workflow-stats {
  display: flex;
  align-items: center;
  gap: 8px;
}

.primary-action,
.secondary-action {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 6px;
  border: 1px solid $border-color;
  padding: 0 12px;
  font-size: 13px;
  color: $text-primary;
  background: $bg-card;
  cursor: pointer;

  svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}

.primary-action {
  border-color: rgba(var(--accent-primary-rgb), 0.45);
  color: #ffffff;
  background: $accent-primary;
}

.workflow-shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 260px minmax(420px, 1fr) 280px;
}

.workflow-templates,
.workflow-inspector {
  min-height: 0;
  overflow-y: auto;
  background: $bg-sidebar;
  border-color: $border-color;
}

.workflow-templates {
  border-right: 1px solid $border-color;
  padding: 16px 12px;
}

.workflow-inspector {
  border-left: 1px solid $border-color;
  padding: 16px;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  color: $text-muted;
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.template-item {
  width: 100%;
  min-height: 96px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
  padding: 12px;
  border: 1px solid $border-color;
  border-radius: 8px;
  text-align: left;
  color: $text-secondary;
  background: $bg-card;
  cursor: pointer;

  &.active {
    border-color: rgba(var(--accent-primary-rgb), 0.55);
    background: rgba(var(--accent-primary-rgb), 0.1);
  }
}

.template-title {
  color: $text-primary;
  font-weight: 650;
  font-size: 13px;
}

.template-meta,
.template-tone {
  font-size: 12px;
  line-height: 1.35;
}

.workflow-canvas-panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.workflow-canvas-toolbar {
  flex: 0 0 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 18px;
  border-bottom: 1px solid $border-color;
}

.draft-name {
  width: min(360px, 42vw);
  border: 0;
  padding: 0;
  color: $text-primary;
  background: transparent;
  font-size: 15px;
  font-weight: 650;
  outline: none;
}

.draft-status,
.workflow-stats span {
  color: $text-muted;
  font-size: 12px;
}

.workflow-canvas {
  flex: 1;
  min-height: 0;
  background:
    linear-gradient(rgba(var(--border-color-rgb, 64, 64, 64), 0.24) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--border-color-rgb, 64, 64, 64), 0.24) 1px, transparent 1px),
    $bg-primary;
  background-size: 24px 24px;
}

.workflow-flow {
  width: 100%;
  height: 100%;
}

.workflow-node {
  width: 220px;
  min-height: 104px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: 8px;
  color: $text-primary;
  background: $bg-card;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);

  &.selected {
    border-color: $accent-primary;
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.16);
  }

  &.trigger { border-left: 4px solid #10b981; }
  &.agent { border-left: 4px solid #3b82f6; }
  &.decision { border-left: 4px solid #f59e0b; }
  &.delivery { border-left: 4px solid #8b5cf6; }

  strong {
    font-size: 14px;
    line-height: 1.25;
  }

  span {
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.35;
  }
}

.workflow-node__phase {
  color: $text-muted !important;
  font-size: 10px !important;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.inspector-kind {
  display: inline-flex;
  margin-bottom: 12px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  color: $text-primary;
  background: rgba(var(--accent-primary-rgb), 0.12);
}

.workflow-inspector h2 {
  margin: 0 0 8px;
  font-size: 17px;
  line-height: 1.25;
}

.workflow-inspector p {
  margin: 0 0 18px;
  color: $text-secondary;
  font-size: 13px;
  line-height: 1.5;
}

.inspector-fields {
  display: grid;
  gap: 12px;

  label {
    display: grid;
    gap: 6px;
    color: $text-muted;
    font-size: 12px;
  }

  input,
  select {
    width: 100%;
    min-width: 0;
    height: 34px;
    border: 1px solid $border-color;
    border-radius: 6px;
    padding: 0 10px;
    color: $text-primary;
    background: $bg-card;
  }
}

:deep(.vue-flow__edge-path) {
  stroke: rgba(var(--accent-primary-rgb), 0.78);
  stroke-width: 2;
}

:deep(.vue-flow__edge-text) {
  fill: $text-secondary;
  font-size: 11px;
}

@media (max-width: 1180px) {
  .workflow-shell {
    grid-template-columns: 220px minmax(360px, 1fr);
  }

  .workflow-inspector {
    display: none;
  }
}

@media (max-width: 860px) {
  .workflow-header,
  .workflow-canvas-toolbar {
    align-items: flex-start;
    flex-direction: column;
    height: auto;
  }

  .workflow-header {
    padding: 18px;
  }

  .workflow-canvas-toolbar {
    padding: 12px 14px;
  }

  .workflow-shell {
    grid-template-columns: 1fr;
  }

  .workflow-templates {
    display: grid;
    grid-template-columns: repeat(3, minmax(190px, 1fr));
    gap: 8px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid $border-color;
  }

  .panel-heading {
    grid-column: 1 / -1;
  }

  .template-item {
    margin: 0;
  }

  .workflow-canvas {
    min-height: 520px;
  }
}
</style>
