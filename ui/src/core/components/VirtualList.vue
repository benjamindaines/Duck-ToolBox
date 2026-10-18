<script setup lang="ts" generic="T">
import {
  defaultRangeExtractor,
  measureElement,
  useVirtualizer,
  useWindowVirtualizer,
} from "@tanstack/vue-virtual"
import { useElementBounding } from "@vueuse/core"
import { computed, ref, useTemplateRef, watch } from "vue"

const props = withDefaults(
  defineProps<{
    items: readonly T[]
    itemKey: (item: T) => string
    estimateSize: number
    windowScroll?: boolean
  }>(),
  { windowScroll: false },
)
const container = useTemplateRef<HTMLElement>("container")
const content = useTemplateRef<HTMLElement>("content")
const { top } = useElementBounding(content)
const virtual = computed(() => props.items.length > 80)
const focusedKey = ref<string | null>(null)
// Register rows immediately, but let ResizeObserver supply their first real size.
// Reading offsetHeight for each new row forces layout repeatedly during navigation.
const measureRow: typeof measureElement = (element, entry, instance) => {
  if (entry) return measureElement(element, entry, instance)
  const index = instance.indexFromElement(element)
  return (
    instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
    instance.options.estimateSize(index)
  )
}
// Keep a focused row mounted when it scrolls outside the visible range.
const options = computed(() => {
  const items = props.items
  const focused = items.findIndex((item) => props.itemKey(item) === focusedKey.value)
  return {
    count: items.length,
    estimateSize: () => props.estimateSize,
    getItemKey: (index: number) => props.itemKey(items[index]!),
    overscan: 6,
    gap: 2,
    measureElement: measureRow,
    rangeExtractor: (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indexes = defaultRangeExtractor(range)
      if (focused >= 0 && !indexes.includes(focused)) indexes.push(focused)
      return indexes.sort((left, right) => left - right)
    },
  }
})
const windowList = useWindowVirtualizer(
  computed(() => ({
    ...options.value,
    enabled: virtual.value && props.windowScroll,
    scrollMargin: top.value + window.scrollY,
  })),
)
const elementList = useVirtualizer(
  computed(() => ({
    ...options.value,
    enabled: virtual.value && !props.windowScroll,
    getScrollElement: () => container.value,
  })),
)
const list = computed(() => (props.windowScroll ? windowList.value : elementList.value))
const rows = computed(() => {
  // Read the adapter's shallow ref directly: its instance stays the same on scroll.
  const current = props.windowScroll ? windowList.value : elementList.value
  return virtual.value
    ? current.getVirtualItems().map((row) => ({
        item: props.items[row.index]!,
        index: row.index,
        key: props.itemKey(props.items[row.index]!),
        offset: row.start - current.options.scrollMargin,
      }))
    : props.items.map((item, index) => ({ item, index, key: props.itemKey(item), offset: 0 }))
})
const totalSize = computed(() =>
  (props.windowScroll ? windowList.value : elementList.value).getTotalSize(),
)

function measure(element: unknown) {
  if (virtual.value && element instanceof HTMLElement) list.value.measureElement(element)
}

function focus(event: FocusEvent) {
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-index]")
  const item = row && props.items[Number(row.dataset.index)]
  focusedKey.value = item ? props.itemKey(item) : null
}

watch(
  () => props.items,
  () => {
    if (!props.items.some((item) => props.itemKey(item) === focusedKey.value))
      focusedKey.value = null
    if (props.windowScroll) {
      // Filtering at the bottom must leave the new results within reach.
      if (content.value && top.value < 0) content.value.scrollIntoView({ block: "start" })
    } else if (container.value) container.value.scrollTop = 0
  },
)
</script>

<template>
  <div
    ref="container"
    class="@container"
    :class="!windowScroll && 'min-h-0 flex-1 overflow-y-auto'"
  >
    <div
      ref="content"
      :class="virtual ? 'relative' : 'flex flex-col gap-0.5'"
      :style="virtual ? { height: `${totalSize}px` } : undefined"
      @focusin="focus"
    >
      <div
        v-for="row in rows"
        :key="row.key"
        :ref="measure"
        :data-index="row.index"
        :class="virtual && 'absolute top-0 left-0 w-full'"
        :style="virtual ? { transform: `translateY(${row.offset}px)` } : undefined"
      >
        <slot :item="row.item" :index="row.index" />
      </div>
    </div>
  </div>
</template>
