<script setup lang="ts">
import { Copy } from "@lucide/vue"
import { useI18n } from "vue-i18n"

import { Button } from "@/components/ui/button"
import { useCopy } from "@/core/links"

export interface KeyValueRow {
  label: string
  value: string | number | null | undefined
  mono?: boolean
  copy?: boolean
}

defineProps<{ rows: KeyValueRow[] }>()

const { t } = useI18n()
const copy = useCopy()
</script>

<template>
  <dl class="@container divide-border min-w-0 divide-y">
    <div
      v-for="row in rows"
      :key="row.label"
      class="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-1.5 py-3 first:pt-0 last:pb-0 @min-[28rem]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @min-[28rem]:gap-4"
    >
      <dt class="text-muted-foreground min-w-0 text-sm leading-6 [overflow-wrap:anywhere]">
        {{ row.label }}
      </dt>
      <dd
        class="flex min-w-0 items-start gap-2 text-start @min-[28rem]:justify-end @min-[28rem]:text-end"
      >
        <!-- Paths, hashes and versions are left-to-right even in right-to-left layouts. -->
        <bdi
          :dir="row.mono ? 'ltr' : undefined"
          :class="[
            'min-w-0 text-sm leading-6 [overflow-wrap:anywhere]',
            row.mono ? 'font-mono' : 'font-medium',
          ]"
        >
          {{ row.value === null || row.value === undefined || row.value === "" ? "—" : row.value }}
        </bdi>
        <Button
          v-if="row.copy && row.value"
          size="icon-sm"
          variant="ghost"
          class="text-muted-foreground -my-1.5 -me-1.5"
          :aria-label="t('core.actions.copy')"
          @click="copy(String(row.value))"
        >
          <Copy class="size-4.5" />
        </Button>
      </dd>
    </div>
  </dl>
</template>
