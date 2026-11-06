/** Split an amount in cents deterministically, preserving the exact total. */
export function splitLumpSum(totalCents: number, personIds: string[]): Array<{ personId: string; amountCents: number }> {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error('总包金额必须为非负整数分')
  if (!personIds.length || personIds.some((id) => !id) || new Set(personIds).size !== personIds.length) {
    throw new Error('参与人员不能为空或重复')
  }
  const ordered = [...personIds].sort()
  const base = Math.floor(totalCents / ordered.length)
  const remainder = totalCents % ordered.length
  return ordered.map((personId, index) => ({ personId, amountCents: base + (index < remainder ? 1 : 0) }))
}
