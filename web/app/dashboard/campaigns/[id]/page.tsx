'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Campaign {
  id: string
  name: string
  description: string | null
  filter_kind: string
  status: string
  invited_count: number
  opened_count: number
  submitted_count: number
  completed_count: number
  created_at: string
  updated_at: string
}

interface Target {
  id: string
  campaign_id: string
  payee_id: string
  status: string
  reminder_count: number
  last_reminder_at: string | null
  created_at: string
  // joined payee fields (optional, depending on backend join)
  vendor_name?: string | null
  legal_name?: string | null
  contact_email?: string | null
  country?: string | null
}

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'slate',
  active: 'green',
  completed: 'blue',
}

const TARGET_TONE: Record<string, BadgeTone> = {
  invited: 'slate',
  opened: 'blue',
  submitted: 'yellow',
  completed: 'green',
}

const TARGET_ORDER = ['invited', 'opened', 'submitted', 'completed']

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id as string

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [remindingId, setRemindingId] = useState<string | null>(null)
  const [bulkReminding, setBulkReminding] = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const data = await api.getCampaign(id)
      setCampaign(data?.campaign ?? null)
      setTargets(Array.isArray(data?.targets) ? data.targets : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load campaign')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const funnel = useMemo(() => {
    const counts: Record<string, number> = { invited: 0, opened: 0, submitted: 0, completed: 0 }
    for (const t of targets) {
      if (counts[t.status] !== undefined) counts[t.status] += 1
    }
    return counts
  }, [targets])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return targets.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (q) {
        const hay = `${t.vendor_name ?? ''} ${t.legal_name ?? ''} ${t.contact_email ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [targets, statusFilter, search])

  const completionPct = campaign && campaign.invited_count
    ? Math.round((campaign.completed_count / campaign.invited_count) * 100)
    : 0

  async function remind(payeeId: string) {
    setRemindingId(payeeId)
    try {
      await api.remindCampaignTarget(id, { payee_id: payeeId })
      setToast('Reminder sent')
      await load()
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Failed to send reminder')
    } finally {
      setRemindingId(null)
    }
  }

  async function remindOutstanding() {
    const outstanding = filtered.filter((t) => t.status !== 'completed')
    if (outstanding.length === 0) {
      setToast('No outstanding targets to remind')
      return
    }
    setBulkReminding(true)
    let ok = 0
    let fail = 0
    for (const t of outstanding) {
      try {
        await api.remindCampaignTarget(id, { payee_id: t.payee_id })
        ok += 1
      } catch {
        fail += 1
      }
    }
    setBulkReminding(false)
    setToast(`Reminded ${ok} target${ok === 1 ? '' : 's'}${fail ? `, ${fail} failed` : ''}`)
    await load()
  }

  async function setStatus(status: string) {
    if (!campaign) return
    setStatusSaving(true)
    try {
      const updated = await api.updateCampaign(id, { status })
      setCampaign(updated ?? { ...campaign, status })
      setToast(`Campaign marked ${status}`)
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Failed to update campaign')
    } finally {
      setStatusSaving(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading campaign..." />

  if (error || !campaign) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/campaigns" className="text-sm text-emerald-400 hover:underline">
          ← Back to campaigns
        </Link>
        <EmptyState
          title="Campaign not found"
          description={error ?? 'This campaign may have been deleted.'}
          icon="⚠️"
          action={<Button onClick={() => router.push('/dashboard/campaigns')}>Back to campaigns</Button>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-emerald-500/40 bg-slate-900 px-4 py-2 text-sm text-emerald-200 shadow-lg shadow-black/40">
          {toast}
        </div>
      )}

      <div>
        <Link href="/dashboard/campaigns" className="text-sm text-emerald-400 hover:underline">
          ← Back to campaigns
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-white">{campaign.name}</h1>
              <Badge tone={STATUS_TONE[campaign.status] ?? 'slate'}>{campaign.status}</Badge>
              <Badge tone="slate">{campaign.filter_kind}</Badge>
            </div>
            {campaign.description && <p className="mt-1 max-w-2xl text-sm text-slate-400">{campaign.description}</p>}
            <p className="mt-1 text-xs text-slate-500">
              Created {new Date(campaign.created_at).toLocaleDateString()} · Updated{' '}
              {new Date(campaign.updated_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {campaign.status === 'draft' && (
              <Button onClick={() => setStatus('active')} disabled={statusSaving}>
                {statusSaving ? <Spinner /> : 'Activate'}
              </Button>
            )}
            {campaign.status === 'active' && (
              <>
                <Button onClick={remindOutstanding} disabled={bulkReminding}>
                  {bulkReminding ? <Spinner label="Reminding..." /> : 'Remind outstanding'}
                </Button>
                <Button variant="secondary" onClick={() => setStatus('completed')} disabled={statusSaving}>
                  Mark completed
                </Button>
              </>
            )}
            {campaign.status === 'completed' && (
              <Button variant="secondary" onClick={() => setStatus('active')} disabled={statusSaving}>
                Reopen
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Invited" value={campaign.invited_count} />
        <Stat label="Opened" value={campaign.opened_count} tone="default" />
        <Stat label="Submitted" value={campaign.submitted_count} tone="yellow" />
        <Stat
          label="Completed"
          value={campaign.completed_count}
          tone="green"
          hint={`${completionPct}% completion`}
        />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Funnel</h2>
        </CardHeader>
        <CardBody>
          <div className="space-y-3">
            {TARGET_ORDER.map((stage) => {
              const total = targets.length || 1
              const count = funnel[stage] ?? 0
              const pct = Math.round((count / total) * 100)
              return (
                <div key={stage}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="capitalize text-slate-300">{stage}</span>
                    <span className="tabular-nums text-slate-500">
                      {count} · {pct}%
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full ${
                        stage === 'completed'
                          ? 'bg-emerald-500'
                          : stage === 'submitted'
                            ? 'bg-amber-500'
                            : stage === 'opened'
                              ? 'bg-sky-500'
                              : 'bg-slate-500'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {['all', ...TARGET_ORDER].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  statusFilter === s
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {s}
                {s !== 'all' && (
                  <span className="ml-1 text-slate-400">{funnel[s] ?? 0}</span>
                )}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payees..."
            className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={targets.length === 0 ? 'No targets in this campaign' : 'No targets match your filters'}
                description={
                  targets.length === 0
                    ? 'This campaign did not match any payees with its audience filter.'
                    : 'Try a different status or search term.'
                }
                icon="👥"
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Payee</TH>
                  <TH>Contact</TH>
                  <TH>Country</TH>
                  <TH>Status</TH>
                  <TH>Reminders</TH>
                  <TH>Last reminder</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((t) => (
                  <TR key={t.id}>
                    <TD>
                      <Link
                        href={`/dashboard/payees/${t.payee_id}`}
                        className="font-medium text-slate-100 hover:text-emerald-400"
                      >
                        {t.vendor_name ?? t.legal_name ?? t.payee_id}
                      </Link>
                      {t.legal_name && t.vendor_name && t.legal_name !== t.vendor_name && (
                        <div className="text-xs text-slate-500">{t.legal_name}</div>
                      )}
                    </TD>
                    <TD>{t.contact_email ?? <span className="text-slate-600">—</span>}</TD>
                    <TD>{t.country ?? <span className="text-slate-600">—</span>}</TD>
                    <TD>
                      <Badge tone={TARGET_TONE[t.status] ?? 'slate'}>{t.status}</Badge>
                    </TD>
                    <TD className="tabular-nums">{t.reminder_count}</TD>
                    <TD className="text-xs text-slate-400">
                      {t.last_reminder_at ? new Date(t.last_reminder_at).toLocaleDateString() : '—'}
                    </TD>
                    <TD className="text-right">
                      {t.status === 'completed' ? (
                        <span className="text-xs text-emerald-400">Done</span>
                      ) : (
                        <Button
                          variant="secondary"
                          className="px-3 py-1 text-xs"
                          onClick={() => remind(t.payee_id)}
                          disabled={remindingId === t.payee_id}
                        >
                          {remindingId === t.payee_id ? <Spinner /> : 'Remind'}
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
