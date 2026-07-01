<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NDescriptions,
  NDescriptionsItem,
  NTag,
  useMessage,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import {
  fetchFnosUpdateStatus,
  type FnosUpdateStatus,
} from '@/api/hermes/system'

const { t } = useI18n()
const message = useMessage()
const loading = ref(false)
const status = ref<FnosUpdateStatus | null>(null)

const statusType = computed(() => {
  if (!status.value || status.value.status === 'unavailable') return 'warning'
  return status.value.updateAvailable ? 'success' : 'default'
})

const statusText = computed(() => {
  if (!status.value) return t('settings.updates.notChecked')
  if (status.value.status === 'unavailable') return t('settings.updates.unavailable')
  return status.value.updateAvailable
    ? t('settings.updates.available')
    : t('settings.updates.upToDate')
})

const installCommand = computed(() => {
  const current = status.value
  if (!current?.downloadUrl || !current.latestVersion) return ''

  const filePath = `/tmp/hermes-studio-${current.latestVersion}.fpk`
  const servicePort = current.servicePort || 6060
  return [
    `curl -L -o ${filePath} ${current.downloadUrl}`,
    `printf 'wizard_service_port=${servicePort}\\n' > /tmp/hermes-studio-install.env`,
    `sudo /usr/local/bin/appcenter-cli install-fpk ${filePath} --env /tmp/hermes-studio-install.env`,
  ].join('\n')
})

function formatValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

function formatDate(value: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatRuntime(value: unknown): string {
  if (!value || typeof value !== 'object') return '-'
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}: ${String(item)}`)
    .join(', ')
}

async function loadStatus() {
  loading.value = true
  try {
    status.value = await fetchFnosUpdateStatus()
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err))
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadStatus()
})
</script>

<template>
  <section class="settings-section native-update-settings">
    <header class="section-header">
      <div>
        <h3 class="section-title">{{ t('settings.updates.title') }}</h3>
        <p class="section-hint">{{ t('settings.updates.description') }}</p>
      </div>
      <NButton size="small" :loading="loading" @click="loadStatus">
        {{ t('settings.updates.check') }}
      </NButton>
    </header>

    <NAlert
      v-if="status?.status === 'unavailable'"
      type="warning"
      :title="t('settings.updates.checkFailed')"
      class="status-alert"
    >
      {{ status.error || t('settings.updates.checkFailedHint') }}
    </NAlert>
    <NAlert
      v-else-if="status?.updateAvailable"
      type="success"
      :title="t('settings.updates.available')"
      class="status-alert"
    >
      {{ t('settings.updates.availableHint', { version: status.latestVersion }) }}
    </NAlert>
    <NAlert
      v-else-if="status"
      type="default"
      :title="t('settings.updates.upToDate')"
      class="status-alert"
    >
      {{ t('settings.updates.upToDateHint') }}
    </NAlert>

    <NDescriptions
      v-if="status"
      size="small"
      label-placement="left"
      :column="1"
      bordered
      class="update-details"
    >
      <NDescriptionsItem :label="t('settings.updates.status')">
        <NTag :type="statusType" size="small">{{ statusText }}</NTag>
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('settings.updates.currentVersion')">
        {{ formatValue(status.currentVersion) }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('settings.updates.latestVersion')">
        {{ formatValue(status.latestVersion) }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('settings.updates.releaseTag')">
        {{ formatValue(status.releaseTag) }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('settings.updates.servicePort')">
        {{ formatValue(status.servicePort) }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('settings.updates.gatewayPrefix')">
        {{ formatValue(status.gatewayPrefix) }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('settings.updates.bundledRuntime')">
        {{ formatRuntime(status.bundledRuntime) }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('settings.updates.updatedAt')">
        {{ formatDate(status.updatedAt) }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('settings.updates.checkedAt')">
        {{ formatDate(status.checkedAt) }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('settings.updates.metadataUrl')">
        <a :href="status.metadataUrl" target="_blank" rel="noopener noreferrer">{{ status.metadataUrl }}</a>
      </NDescriptionsItem>
    </NDescriptions>

    <div v-if="status?.downloadUrl || status?.releaseUrl" class="update-actions">
      <NButton
        v-if="status.downloadUrl"
        tag="a"
        :href="status.downloadUrl"
        target="_blank"
        rel="noopener noreferrer"
        type="primary"
      >
        {{ t('settings.updates.downloadFpk') }}
      </NButton>
      <NButton
        v-if="status.releaseUrl"
        tag="a"
        :href="status.releaseUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ t('settings.updates.openRelease') }}
      </NButton>
    </div>

    <div v-if="installCommand" class="install-command">
      <div class="command-title">{{ t('settings.updates.cliInstall') }}</div>
      <pre><code>{{ installCommand }}</code></pre>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.settings-section {
  margin-top: 16px;
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.section-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.section-hint {
  margin: 0;
  color: var(--text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.status-alert {
  margin-bottom: 12px;
}

.update-details {
  margin-top: 12px;
}

.update-details a {
  color: var(--primary-color);
  word-break: break-all;
}

.update-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.install-command {
  margin-top: 14px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
  background: var(--code-bg);
}

.command-title {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-color-secondary);
  font-size: 12px;
}

.install-command pre {
  margin: 0;
  padding: 10px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: $breakpoint-mobile) {
  .section-header {
    flex-direction: column;
  }
}
</style>
