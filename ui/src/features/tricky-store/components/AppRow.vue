<script setup lang="ts">
import { SlidersHorizontal } from "@lucide/vue"
import { onLongPress } from "@vueuse/core"
import { useTemplateRef } from "vue"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import AppIcon from "@/core/components/AppIcon.vue"

import type { TargetMode } from "../api"
import { useTrickyI18n } from "../i18n"
import AppSelection from "./AppSelection.vue"

const props = defineProps<{
  packageName: string
  label: string
  system: boolean
  /** Mode when selected, `null` when the app is not a target. */
  mode: TargetMode | null
  customPolicy: boolean
  /** The backend supports per-app modes or policies. */
  tunable: boolean
}>()
const emit = defineEmits<{ toggle: []; tune: [] }>()
const { t } = useTrickyI18n()

const row = useTemplateRef<HTMLElement>("row")
let longPressed = false

// Tricky Addon opens the mode dialog on long press (context menu) of a selected app.
onLongPress(
  row,
  (event) => {
    if (event.target instanceof Element && event.target.closest("button")) return
    if (props.mode === null || !props.tunable) return
    longPressed = true
    emit("tune")
  },
  { delay: 450 },
)

function click() {
  if (longPressed) {
    longPressed = false
    return
  }
  emit("toggle")
}

const markers: Record<TargetMode, string> = { auto: "", generate: "!", hack: "?" }
</script>

<template>
  <div
    ref="row"
    role="checkbox"
    tabindex="0"
    :aria-checked="mode !== null"
    :class="[
      'state-layer focus-visible:ring-ring/50 relative grid min-h-18 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-3 ps-4 pe-3 transition-[border-radius,background-color] duration-350 ease-spring-fast outline-none select-none focus-visible:ring-3 @min-[18rem]:grid-cols-[auto_minmax(0,1fr)_auto] @min-[18rem]:items-center',
      // Material 3 Expressive segmented list: a selected row turns fully round.
      mode !== null ? 'bg-secondary rounded-lg' : 'bg-card rounded-xs',
    ]"
    @click="click"
    @pointerdown="longPressed = false"
    @contextmenu.prevent
    @keydown.space.self.prevent="emit('toggle')"
    @keydown.enter.self.prevent="emit('toggle')"
  >
    <AppIcon :package-name="packageName" :label="label" />
    <div class="min-w-0 flex-1">
      <div class="text-base leading-6 [overflow-wrap:anywhere]">{{ label }}</div>
      <div
        dir="ltr"
        class="text-muted-foreground font-mono text-sm leading-5 [overflow-wrap:anywhere] rtl:text-right"
      >
        {{ packageName }}
      </div>
      <div
        v-if="(mode && mode !== 'auto') || (customPolicy && mode !== null) || system"
        class="mt-1 flex flex-wrap gap-1"
      >
        <Badge v-if="mode && mode !== 'auto'">
          <span class="font-mono">{{ markers[mode] }}</span>
          {{ mode === "generate" ? t("ta.mode_certificate_generating") : t("ta.mode_leaf_hack") }}
        </Badge>
        <Badge v-if="customPolicy && mode !== null" variant="secondary" class="bg-card">{{
          t("list.customPolicy")
        }}</Badge>
        <Badge v-if="system" variant="outline">{{ t("list.system") }}</Badge>
      </div>
    </div>
    <div
      class="col-start-2 flex items-center justify-end gap-2 @min-[18rem]:col-start-3 @min-[18rem]:row-start-1"
    >
      <Button
        v-if="mode !== null && tunable"
        variant="ghost"
        size="icon"
        :aria-label="t('list.tune', { name: label })"
        @click.stop="emit('tune')"
      >
        <SlidersHorizontal class="size-5" />
      </Button>
      <AppSelection :checked="mode !== null" />
    </div>
  </div>
</template>
