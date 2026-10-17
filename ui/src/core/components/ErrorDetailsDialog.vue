<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { isDuckError } from "@/core/duckd"
import { useCopy } from "@/core/links"
import { errorDescription, errorDetails, errorTitle } from "@/core/notify"

import KeyValueList from "./KeyValueList.vue"

const { t } = useI18n()
const copy = useCopy()

const rows = computed(() => {
  const error = errorDetails.error
  if (!isDuckError(error))
    return [{ label: t("core.errors.message"), value: errorDescription(error) }]
  return [
    { label: t("core.errors.command"), value: error.command, mono: true },
    { label: t("core.errors.code"), value: error.code, mono: true },
  ]
})

const report = computed(() => {
  const error = errorDetails.error
  if (!isDuckError(error)) return errorDescription(error)
  const details = error.details === undefined ? "" : `\n\n${JSON.stringify(error.details, null, 2)}`
  return `${error.command}: ${error.code}\n${error.message}${details}`
})
</script>

<template>
  <Dialog v-model:open="errorDetails.open">
    <DialogContent
      class="max-h-[85dvh] min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
    >
      <DialogHeader>
        <DialogTitle class="[overflow-wrap:anywhere]">
          {{ errorTitle(errorDetails.error) }}
        </DialogTitle>
      </DialogHeader>
      <div class="min-h-0 min-w-0 space-y-3 overflow-y-auto [overflow-wrap:anywhere]">
        <DialogDescription class="whitespace-pre-wrap">
          {{ errorDescription(errorDetails.error) }}
        </DialogDescription>
        <KeyValueList :rows="rows" />
        <pre
          dir="ltr"
          class="bg-muted max-h-64 min-w-0 overflow-auto rounded-lg p-3 font-mono text-xs leading-5 whitespace-pre-wrap"
          >{{ report }}</pre>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="copy(report)">{{ t("core.actions.copy") }}</Button>
        <Button @click="errorDetails.open = false">{{ t("core.actions.close") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
