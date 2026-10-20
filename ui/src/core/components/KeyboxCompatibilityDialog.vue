<script setup lang="ts">
import { useI18n } from "vue-i18n"

import type { KeyboxInstallConfirmation } from "@/core/keybox"

import ConfirmDialog from "./ConfirmDialog.vue"

defineProps<{ confirmation: KeyboxInstallConfirmation }>()
const { t } = useI18n()
</script>

<template>
  <ConfirmDialog
    v-if="confirmation.warning.value"
    :open="confirmation.open.value"
    :title="t(confirmation.warning.value.titleKey)"
    :description="t(confirmation.warning.value.descriptionKey)"
    :confirm-label="t(confirmation.warning.value.confirmLabelKey)"
    @confirm="confirmation.respond(true)"
    @update:open="!$event && confirmation.respond(false)"
  />
</template>
