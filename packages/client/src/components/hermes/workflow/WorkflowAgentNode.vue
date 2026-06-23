<script setup lang="ts">
import { computed, ref } from 'vue'
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'
import { NButton, NInput, NModal, NSelect, NUpload, useMessage } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import WorkflowModelSelector from './WorkflowModelSelector.vue'
import type { WorkflowAgentNodeData, WorkflowAgentNodeEditableData } from './types'
import type { CodingAgentApiMode } from '@/api/coding-agents'
import type { ProviderApiMode } from '@/api/hermes/system'
import { getFileDownloadUrl } from '@/api/hermes/files'

import '@vue-flow/node-resizer/dist/style.css'

const props = defineProps<NodeProps<WorkflowAgentNodeData>>()
const { t } = useI18n()
const message = useMessage()
const imageUploadFileList = ref<UploadFileInfo[]>([])
const uploadingImages = ref(false)
const previewPath = ref('')
const previewVisible = ref(false)

const statusClass = computed(() => `status-${props.data.status}`)
const isCodingAgent = computed(() => props.data.agent !== 'hermes')
const apiModeOptions = computed(() => [
  { label: t('codingAgents.protocolOpenAiChat'), value: 'chat_completions' },
  { label: t('codingAgents.protocolOpenAiResponses'), value: 'codex_responses' },
  { label: t('codingAgents.protocolAnthropicMessages'), value: 'anthropic_messages' },
])
const imageAttachments = computed(() => props.data.images.filter(isImagePath))
const fileAttachments = computed(() => props.data.images.filter(path => !isImagePath(path)))

function updateField<K extends keyof WorkflowAgentNodeEditableData>(key: K, value: WorkflowAgentNodeEditableData[K]) {
  props.data.onUpdate(props.id, { [key]: value } as Partial<WorkflowAgentNodeEditableData>)
}

function handleModelSelect(selection: { provider: string; model: string; apiMode?: ProviderApiMode }) {
  const patch: Partial<WorkflowAgentNodeEditableData> = {
    provider: selection.provider,
    model: selection.model,
  }
  if (
    selection.apiMode === 'chat_completions' ||
    selection.apiMode === 'codex_responses' ||
    selection.apiMode === 'anthropic_messages'
  ) {
    patch.apiMode = selection.apiMode
  }
  props.data.onUpdate(props.id, patch)
}

async function handleImageFileChange(data: { fileList: UploadFileInfo[] }) {
  if (uploadingImages.value) return
  imageUploadFileList.value = data.fileList
  const files = data.fileList
    .map(file => file.file)
    .filter((file): file is File => !!file)
  if (files.length === 0) return
  await uploadImages(files)
}

function removeImage(path: string) {
  updateField('images', props.data.images.filter(image => image !== path))
}

function imageName(path: string) {
  return path.split('/').pop() || path
}

function imageUrl(path: string) {
  return getFileDownloadUrl(path, imageName(path))
}

function isImagePath(path: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(path.split('?')[0] || path)
}

function openPreview(path: string) {
  previewPath.value = path
  previewVisible.value = true
}

function handlePreviewPointer(event: Event, path: string) {
  event.preventDefault()
  event.stopPropagation()
  openPreview(path)
}

async function uploadImages(files: File[]) {
  uploadingImages.value = true
  try {
    const paths = await props.data.onUploadImages(props.id, files)
    updateField('images', [...props.data.images, ...paths])
    imageUploadFileList.value = []
  } catch (err: any) {
    message.error(err?.message || t('files.uploadFailed'))
  } finally {
    uploadingImages.value = false
  }
}
</script>

<template>
  <div class="workflow-agent-node" :class="[statusClass, { selected }]">
    <NodeResizer
      :is-visible="selected"
      :min-width="260"
      :min-height="360"
      color="var(--accent-info)"
      handle-class-name="workflow-resize-handle"
      line-class-name="workflow-resize-line"
    />
    <Handle id="input" type="target" :position="Position.Left" class="workflow-handle input-handle" />

    <div class="node-header">
      <span class="node-status-dot" />
      <span class="node-title">{{ data.title }}</span>
    </div>

    <div
      class="node-controls nodrag nopan"
      @click.stop
      @pointerdown.stop
      @pointerup.stop
      @mousedown.stop
      @mouseup.stop
      @touchstart.stop
      @touchend.stop
    >
      <NSelect
        :value="data.agent"
        :options="data.agentOptions"
        size="small"
        :placeholder="t('workflow.node.agent')"
        @update:value="value => updateField('agent', value as string)"
      />
      <WorkflowModelSelector
        :provider="data.provider"
        :model="data.model"
        :groups="data.modelGroups"
        @select="handleModelSelect"
      />
      <NSelect
        v-if="isCodingAgent"
        :value="data.apiMode"
        :options="apiModeOptions"
        size="small"
        :placeholder="t('workflow.node.apiMode')"
        @update:value="value => updateField('apiMode', value as CodingAgentApiMode)"
      />
      <NSelect
        :value="data.skills"
        multiple
        tag
        filterable
        size="small"
        :placeholder="t('workflow.node.skillsPlaceholder')"
        @update:value="value => updateField('skills', value as string[])"
      />
      <NInput
        class="node-prompt-input"
        :value="data.input"
        type="textarea"
        size="small"
        :resizable="false"
        :input-props="{ style: { height: '100%', resize: 'none' } }"
        :placeholder="t('workflow.node.promptPlaceholder')"
        @update:value="value => updateField('input', value)"
      />
      <div class="node-images">
        <NUpload
          v-model:file-list="imageUploadFileList"
          class="image-card-upload"
          multiple
          accept="image/*"
          list-type="image-card"
          :default-upload="false"
          :disabled="uploadingImages"
          @change="handleImageFileChange"
        />
        <div v-if="imageAttachments.length > 0" class="image-preview-grid">
            <div
            v-for="image in imageAttachments"
            :key="image"
            class="image-preview"
            :title="image"
            role="button"
            tabindex="0"
            @pointerup="event => handlePreviewPointer(event, image)"
            @keydown.enter.stop.prevent="openPreview(image)"
            @keydown.space.stop.prevent="openPreview(image)"
          >
            <img :src="imageUrl(image)" :alt="imageName(image)">
            <button
              class="image-remove"
              type="button"
              :aria-label="t('common.delete')"
              @click.stop="removeImage(image)"
            >
              ×
            </button>
            <span class="image-name">{{ imageName(image) }}</span>
          </div>
        </div>
        <div v-if="fileAttachments.length > 0" class="file-paths">
          <button
            v-for="file in fileAttachments"
            :key="file"
            class="file-path"
            type="button"
            :title="file"
            @pointerup="event => handlePreviewPointer(event, file)"
          >
            <span class="file-name">{{ imageName(file) }}</span>
            <span class="file-remove" @click.stop="removeImage(file)">×</span>
          </button>
        </div>
      </div>
    </div>

    <Handle id="output" type="source" :position="Position.Right" class="workflow-handle output-handle" />

    <NModal
      v-model:show="previewVisible"
      preset="card"
      :title="imageName(previewPath)"
      :style="{ width: 'min(760px, calc(100vw - 32px))' }"
    >
      <img
        v-if="isImagePath(previewPath)"
        class="attachment-preview-image"
        :src="imageUrl(previewPath)"
        :alt="imageName(previewPath)"
      >
      <div v-else class="attachment-preview-file">
        <span>{{ previewPath }}</span>
        <NButton tag="a" :href="imageUrl(previewPath)" target="_blank" size="small">
          {{ t('files.open') }}
        </NButton>
      </div>
    </NModal>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.workflow-agent-node {
  width: 100%;
  height: 100%;
  min-width: 260px;
  min-height: 360px;
  border: 1px solid $border-color;
  border-radius: 8px;
  background: $bg-card;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  color: $text-primary;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: border-color $transition-fast, box-shadow $transition-fast, transform $transition-fast;

  &.selected {
    border-color: var(--accent-info);
    box-shadow: 0 0 0 3px rgba(var(--accent-info-rgb), 0.16), 0 12px 28px rgba(0, 0, 0, 0.12);
  }
}

.workflow-agent-node :deep(.workflow-resize-handle) {
  width: 10px;
  height: 10px;
  border: 2px solid $bg-card;
  background: var(--accent-info);
}

.workflow-agent-node :deep(.workflow-resize-line) {
  border-color: var(--accent-info);
}

.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid $border-light;
  font-size: 13px;
  font-weight: 600;
  flex: 0 0 auto;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
}

.node-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: $text-muted;
}

.status-ready .node-status-dot {
  background: var(--success);
}

.status-running .node-status-dot {
  background: var(--accent-info);
  box-shadow: 0 0 8px rgba(var(--accent-info-rgb), 0.65);
}

.node-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  flex: 1;
  min-height: 0;
}

.node-prompt-input {
  flex: 1;
  min-height: 96px;

  :deep(.n-input-wrapper),
  :deep(.n-input__textarea) {
    height: 100%;
    resize: none !important;
  }

  :deep(.n-input__textarea-el) {
    height: 100% !important;
    min-height: 84px;
    resize: none !important;

    &::-webkit-resizer {
      display: none;
    }
  }
}

.node-images {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.image-card-upload {
  :deep(.n-upload-file-list) {
    display: grid;
    grid-template-columns: repeat(3, 56px);
    gap: 6px;
  }

  :deep(.n-upload-file),
  :deep(.n-upload-trigger) {
    width: 56px;
    height: 56px;
    margin: 0;
  }
}

.image-preview-grid {
  display: grid;
  grid-template-columns: repeat(3, 56px);
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
  padding-right: 2px;
}

.image-preview {
  position: relative;
  min-width: 0;
  aspect-ratio: 1;
  border: 1px solid $border-light;
  border-radius: 6px;
  background: $bg-input;
  overflow: hidden;
  cursor: zoom-in;
}

.image-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.image-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.58);
  color: #fff;
  cursor: pointer;
  line-height: 18px;
  padding: 0;
  opacity: 0;
  transform: scale(0.92);
  transition: opacity $transition-fast, transform $transition-fast, background-color $transition-fast;

  &:hover {
    background: var(--error);
  }
}

.image-preview:hover .image-remove,
.image-remove:focus-visible {
  opacity: 1;
  transform: scale(1);
}

.image-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.58);
  color: $text-secondary;
  color: #fff;
  font-size: 10px;
  line-height: 1.3;
  padding: 3px 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-paths {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.file-path {
  max-width: 100%;
  position: relative;
  display: inline-flex;
  align-items: center;
  border: 1px solid $border-light;
  border-radius: 4px;
  background: $bg-input;
  color: $text-secondary;
  font-size: 11px;
  line-height: 1.4;
  padding: 2px 18px 2px 6px;
  cursor: pointer;

  &:hover {
    border-color: var(--accent-info);
    color: $text-primary;
  }
}

.file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-remove {
  position: absolute;
  top: -5px;
  right: -5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.58);
  color: #fff;
  opacity: 0;
  transform: scale(0.92);
  transition: opacity $transition-fast, transform $transition-fast, background-color $transition-fast;

  &:hover {
    background: var(--error);
  }
}

.file-path:hover .file-remove,
.file-remove:focus-visible {
  opacity: 1;
  transform: scale(1);
}

.attachment-preview-image {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin: 0 auto;
  object-fit: contain;
}

.attachment-preview-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.attachment-preview-file span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (hover: none), (pointer: coarse) {
  .image-remove,
  .file-remove {
    opacity: 1;
    transform: scale(1);
  }
}

.workflow-handle {
  width: 12px;
  height: 12px;
  border: 2px solid $bg-card;
  background: var(--accent-info);
}

.input-handle {
  left: -7px;
}

.output-handle {
  right: -7px;
}
</style>
