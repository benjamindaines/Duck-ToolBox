<script setup lang="ts">
import { Search } from "@lucide/vue"
import { computed, ref, watch } from "vue"
import { useI18n } from "vue-i18n"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import AppIcon from "@/core/components/AppIcon.vue"
import VirtualList from "@/core/components/VirtualList.vue"
import { useRouteModal } from "@/core/modal"

import { useTrickyI18n } from "../i18n"
import { matches } from "../selection"
import { useTrickyStore } from "../store"
import AppSelection from "./AppSelection.vue"

const props = defineProps<{ labels: ReadonlyMap<string, string> }>()
const { open, close } = useRouteModal("system-apps")
const store = useTrickyStore()
const { t } = useTrickyI18n()
const global = useI18n()

const query = ref("")
const checked = ref(new Set<string>())
/** Checked apps first, frozen while the dialog is open so rows do not jump. */
const order = ref<string[]>([])

watch(
  open,
  (isOpen) => {
    if (!isOpen || !store.draft || !store.status) return
    query.value = ""
    checked.value = new Set(store.draft.systemApps)
    const label = (name: string) => props.labels.get(name) ?? name
    order.value = store.status.packages
      .filter((entry) => entry.system)
      .map((entry) => entry.package_name)
      .sort(
        (a, b) =>
          Number(checked.value.has(b)) - Number(checked.value.has(a)) ||
          label(a).localeCompare(label(b)),
      )
  },
  { immediate: true },
)

const rows = computed(() =>
  order.value
    .map((packageName) => ({ packageName, label: props.labels.get(packageName) ?? packageName }))
    .filter((row) => matches(row, query.value)),
)

function toggle(name: string) {
  const next = new Set(checked.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  checked.value = next
}

function save() {
  store.setSystemApps(checked.value)
  close()
}
</script>

<template>
  <Dialog v-model:open="open">
    <!-- Picking from the list is the common case: do not raise the keyboard on open. -->
    <DialogContent class="flex max-h-[85vh] flex-col gap-3" @open-auto-focus.prevent>
      <DialogHeader>
        <DialogTitle>{{ t("ta.add_system_app_title") }}</DialogTitle>
      </DialogHeader>
      <InputGroup class="bg-muted rounded-full border-0">
        <InputGroupAddon><Search /></InputGroupAddon>
        <InputGroupInput
          v-model="query"
          type="search"
          :placeholder="t('ta.search_bar_search_placeholder')"
        />
      </InputGroup>
      <VirtualList
        :items="rows"
        :item-key="(row) => row.packageName"
        :estimate-size="64"
        class="-mx-3"
      >
        <template #default="{ item: row }">
          <div
            role="checkbox"
            tabindex="0"
            :aria-checked="checked.has(row.packageName)"
            class="state-layer focus-visible:ring-ring/50 relative flex min-h-16 cursor-pointer items-center gap-4 rounded-md px-3 py-2 outline-none select-none focus-visible:ring-3"
            @click="toggle(row.packageName)"
            @keydown.space.prevent="toggle(row.packageName)"
            @keydown.enter.prevent="toggle(row.packageName)"
          >
            <AppIcon :package-name="row.packageName" :label="row.label" />
            <div class="min-w-0 flex-1">
              <div class="text-base leading-6 [overflow-wrap:anywhere]">{{ row.label }}</div>
              <div
                dir="ltr"
                class="text-muted-foreground font-mono text-sm leading-5 [overflow-wrap:anywhere] rtl:text-right"
              >
                {{ row.packageName }}
              </div>
            </div>
            <AppSelection :checked="checked.has(row.packageName)" />
          </div>
        </template>
      </VirtualList>
      <DialogFooter class="flex-row">
        <Button variant="outline" class="flex-1" @click="close()">{{
          global.t("core.actions.cancel")
        }}</Button>
        <Button class="flex-1" @click="save">{{ t("ta.functional_button_save") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
