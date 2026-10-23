import { useQuery, useQueryClient } from "@tanstack/vue-query"
import { useStorage } from "@vueuse/core"
import { onScopeDispose, ref, watch } from "vue"
import { contributions } from "@/core/features"
import type { SecurityPatchPreview, SecurityPatchTarget } from "@/core/features"
import { notifyError, notifySuccess } from "@/core/notify"
import { integrityApi } from "./api"
import type { Options, Preview, Task } from "./api"
import { useIntegrityI18n } from "./i18n"

export function useIntegrity() {
  const { t } = useIntegrityI18n()
  const client = useQueryClient()
  const status = useQuery({
    queryKey: ["play-integrity.status"],
    queryFn: integrityApi.status,
    refetchOnWindowFocus: false,
  })
  const config = useQuery({
    queryKey: ["play-integrity.config"],
    queryFn: integrityApi.config,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const content = ref("")
  const preview = ref<Preview | null>(null)
  const patches = ref<
    { target: SecurityPatchTarget; preview: SecurityPatchPreview; selected: boolean }[]
  >([])
  const task = ref<Task | null>(null)
  const taskId = useStorage("duck-toolbox/play-integrity-task", "")
  const backup = useStorage("duck-toolbox/play-integrity-backup", "")
  const options = ref<Options>({
    enabled: true,
    mode: "full",
    skipdelprop: false,
    skippersistprop: false,
    skipmatchdevice: false,
  })
  const busy = ref(false)
  const log = ref("")
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  watch(
    config.data,
    (value) => {
      if (value) content.value = value.content
    },
    { immediate: true },
  )
  watch(
    status.data,
    (value) => {
      if (value) options.value = { ...value.options }
    },
    { immediate: true },
  )
  watch(content, () => {
    preview.value = null
    patches.value = []
  })
  async function action(work: () => Promise<unknown>) {
    if (busy.value) return
    busy.value = true
    try {
      await work()
    } catch (error) {
      notifyError(error)
    } finally {
      busy.value = false
    }
  }
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["play-integrity.status"] }),
      client.invalidateQueries({ queryKey: ["play-integrity.config"] }),
    ])
  }
  async function prepare(value: Preview) {
    preview.value = value
    patches.value = []
    if (value.suggested_patch) {
      for (const target of contributions("securityPatchTargets")) {
        const patch = await target.preview(value.suggested_patch)
        if (patch) patches.value.push({ target, preview: patch, selected: false })
      }
    }
  }
  async function apply() {
    const candidate = preview.value
    if (!candidate) return
    const applied = await integrityApi.apply(candidate)
    backup.value = applied.backup
    const updated: { target: SecurityPatchTarget; backup: string }[] = []
    try {
      for (const patch of patches.value.filter((item) => item.selected)) {
        const result = await patch.target.apply(patch.preview)
        updated.push({ target: patch.target, backup: result.backup })
      }
    } catch (error) {
      const failures: string[] = []
      for (const entry of updated.reverse()) {
        try {
          await entry.target.restore(entry.backup)
        } catch (recovery) {
          failures.push(`${entry.target.id}: ${String(recovery)}; backup=${entry.backup}`)
        }
      }
      try {
        await integrityApi.restore(applied.backup)
        backup.value = ""
      } catch (recovery) {
        failures.push(`Play Integrity: ${String(recovery)}; backup=${applied.backup}`)
      }
      await refresh()
      if (failures.length) throw new Error(`${String(error)}; ${failures.join("; ")}`)
      throw error
    }
    preview.value = null
    await refresh()
    notifySuccess(t("saved"))
  }
  async function poll() {
    if (disposed || !taskId.value) return
    try {
      task.value = await integrityApi.taskStatus(taskId.value)
      if (task.value.state === "completed" && task.value.result) {
        taskId.value = ""
        await prepare(task.value.result)
      } else if (task.value.state !== "running") {
        taskId.value = ""
      } else timer = setTimeout(() => void poll(), 1000)
    } catch (error) {
      notifyError(error)
      taskId.value = ""
    }
  }
  if (taskId.value) void poll()
  onScopeDispose(() => {
    disposed = true
    if (timer) clearTimeout(timer)
  })
  return {
    t,
    status,
    config,
    content,
    preview,
    patches,
    task,
    taskId,
    backup,
    options,
    busy,
    log,
    action,
    refresh,
    apply,
    prepare,
    previewContent: (migrate = false) =>
      action(async () => prepare(await integrityApi.preview(content.value, "auto", migrate))),
    importSource: (source: string) =>
      action(async () => prepare(await integrityApi.importPreview(source))),
    saveOptions: (list: string) =>
      action(async () => {
        await integrityApi.options({ ...options.value, app_replace_list: list })
        await refresh()
        notifySuccess(t("reboot"))
      }),
    generate: (strong: boolean, match: boolean) =>
      action(async () => {
        task.value = await integrityApi.taskStart(strong, match)
        taskId.value = task.value.id
        void poll()
      }),
    cancel: () =>
      action(async () => {
        if (taskId.value) task.value = await integrityApi.taskCancel(taskId.value)
      }),
    restore: () =>
      action(async () => {
        if (backup.value) {
          await integrityApi.restore(backup.value)
          backup.value = ""
          await refresh()
        }
      }),
    restart: () =>
      action(async () => {
        const result = await integrityApi.restart()
        log.value = JSON.stringify(result.processes, null, 2)
        notifySuccess(t("restartSent"))
      }),
    diagnose: () =>
      action(async () => {
        log.value = (await integrityApi.diagnose()).log
      }),
  }
}
