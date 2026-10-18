<script setup lang="ts">
import { Check } from "@lucide/vue"

// The row owns checkbox semantics and interaction; this is only its visual indicator.
defineProps<{ checked: boolean }>()
</script>

<template>
  <span
    aria-hidden="true"
    class="pointer-events-none grid size-4.5 shrink-0 place-content-center rounded-[2px] border-2 transition-colors"
    :class="
      checked ? 'bg-primary text-primary-foreground border-primary' : 'border-muted-foreground'
    "
  >
    <Check v-if="checked" class="size-3.5" :stroke-width="3.5" />
  </span>
</template>
