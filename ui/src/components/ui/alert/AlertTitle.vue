<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="alert-title"
    :class="cn('col-start-2 min-w-0 font-semibold leading-6 [overflow-wrap:anywhere]', props.class)"
  >
    <slot />
  </div>
</template>
