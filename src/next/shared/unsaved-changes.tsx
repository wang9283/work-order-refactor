import { useEffect, useMemo, useRef } from 'react'
import { Form, type FormInstance } from 'antd'

type Registration = symbol

const registrations = new Map<Registration, string>()

function registerUnsavedChanges(label: string): () => void {
  const registration = Symbol(label)
  registrations.set(registration, label)
  return () => registrations.delete(registration)
}

export function hasUnsavedChanges(): boolean {
  return registrations.size > 0
}

export function confirmDiscardUnsavedChanges(): boolean {
  if (!hasUnsavedChanges()) return true
  const labels = [...new Set(registrations.values())].join('、')
  return window.confirm(`“${labels}”还有未保存的修改。切换身份或生产基地会放弃这些修改，是否继续？`)
}

function stableValue(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (current && typeof current === 'object' && typeof current.toISOString === 'function') {
      return current.toISOString()
    }
    return current
  }) || ''
}

export function useUnsavedChanges(dirty: boolean, label: string): void {
  useEffect(() => {
    if (!dirty) return
    return registerUnsavedChanges(label)
  }, [dirty, label])
}

export function useAntFormUnsavedChanges(
  form: FormInstance,
  active: boolean,
  label: string,
): void {
  const watchedValues = Form.useWatch([], form)
  const serialized = useMemo(() => stableValue(watchedValues), [watchedValues])
  const baseline = useRef<string | null>(null)
  const wasActive = useRef(false)

  useEffect(() => {
    if (!active) {
      baseline.current = null
      wasActive.current = false
      return
    }
    if (!wasActive.current || baseline.current === null) {
      baseline.current = serialized
      wasActive.current = true
    }
  }, [active, serialized])

  useUnsavedChanges(
    active && baseline.current !== null && serialized !== baseline.current,
    label,
  )
}

export function useSnapshotUnsavedChanges(
  value: unknown,
  active: boolean,
  label: string,
): void {
  const serialized = useMemo(() => stableValue(value), [value])
  const baseline = useRef<string | null>(null)
  const wasActive = useRef(false)

  useEffect(() => {
    if (!active) {
      baseline.current = null
      wasActive.current = false
      return
    }
    if (!wasActive.current || baseline.current === null) {
      baseline.current = serialized
      wasActive.current = true
    }
  }, [active, serialized])

  useUnsavedChanges(
    active && baseline.current !== null && serialized !== baseline.current,
    label,
  )
}
