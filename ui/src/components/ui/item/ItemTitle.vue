<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="item-title"
    :class="cn('flex min-w-0 max-w-full items-center gap-2 text-base leading-6 [overflow-wrap:anywhere]', props.class)"
  >
    <slot />
  </div>
</template>
