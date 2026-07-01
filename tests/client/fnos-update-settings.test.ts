// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

const fetchFnosUpdateStatusMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/hermes/system', () => ({
  fetchFnosUpdateStatus: fetchFnosUpdateStatusMock,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}))

vi.mock('naive-ui', async () => {
  const passthrough = (tag: string, className: string) => defineComponent({
    props: ['type', 'title', 'label', 'bordered', 'column', 'size'],
    setup(props, { slots }) {
      return () => h(tag, { class: className }, [
        props.label ? h('span', { class: `${className}-label` }, String(props.label)) : null,
        slots.default?.(),
      ])
    },
  })
  return {
    NAlert: passthrough('div', 'n-alert'),
    NButton: defineComponent({
      props: ['loading', 'href', 'target', 'tag', 'type'],
      emits: ['click'],
      setup(props, { emit, slots }) {
        const tag = props.tag === 'a' ? 'a' : 'button'
        return () => h(tag, {
          class: 'n-button',
          href: props.href,
          target: props.target,
          type: tag === 'button' ? 'button' : undefined,
          onClick: () => emit('click'),
        }, slots.default?.())
      },
    }),
    NDescriptions: passthrough('dl', 'n-descriptions'),
    NDescriptionsItem: passthrough('div', 'n-descriptions-item'),
    NTag: passthrough('span', 'n-tag'),
    useMessage: () => ({ error: vi.fn() }),
  }
})

import NativeUpdateSettings from '@/components/hermes/settings/NativeUpdateSettings.vue'

describe('NativeUpdateSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchFnosUpdateStatusMock.mockResolvedValue({
      status: 'ok',
      source: 'fnos-native',
      currentVersion: '0.6.24',
      latestVersion: '0.6.25',
      updateAvailable: true,
      metadataUrl: 'https://example.test/hermes-studio.latest.json',
      checkedAt: '2026-07-01T02:30:00.000Z',
      downloadUrl: 'https://github.com/MScorpioLee/hermes-studio/releases/download/fnos-v0.6.25/hermes-studio.fpk',
      releaseUrl: 'https://github.com/MScorpioLee/hermes-studio/releases/tag/fnos-v0.6.25',
      releaseTag: 'fnos-v0.6.25',
      servicePort: 6060,
      gatewayPrefix: '/app/hermes-studio',
      updatedAt: '2026-07-01T02:00:00Z',
      builtFrom: 'abc123',
      bundledRuntime: null,
    })
  })

  it('loads and renders the native fnOS update status', async () => {
    const wrapper = mount(NativeUpdateSettings)
    await flushPromises()

    expect(fetchFnosUpdateStatusMock).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('0.6.24')
    expect(wrapper.text()).toContain('0.6.25')
    expect(wrapper.text()).toContain('settings.updates.available')
    expect(wrapper.find('a[href$="hermes-studio.fpk"]').exists()).toBe(true)

    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(fetchFnosUpdateStatusMock).toHaveBeenCalledTimes(2)
  })
})
