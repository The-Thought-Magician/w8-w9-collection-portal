'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

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

const FILTER_KINDS: { value: string; label: string; hint: string }[] = [
  { value: 'expiring', label: 'Expiring soon', hint: 'Payees whose forms expire within the window' },
  { value: 'missing', label: 'Missing forms', hint: 'Payees with no valid form on file' },
  { value: 'all', label: 'Entire roster', hint: 'Every payee in your book' },
  { value: 'custom', label: 'Custom selection', hint: 'Hand-picked recipients' },
]

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'slate',
  active: 'green',
  completed: 'blue',
}

const FILTER_TONE: Record<string, BadgeTone> = {
  expiring: 'yellow',
  missing: 'red',
  all: 'blue',
  custom: 'slate',
}

function progressPct(c: Campaign): number {
  if (!c.invited_count) return 0
  return Math.round((c.completed_count / c.invited_count) * 100)
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [filterKind, setFilterKind] = useState('expiring')

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await api.listCampaigns()
      setCampaigns(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load campaigns')
      setCampaigns([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    if (!campaigns) return []
    const q = search.trim().toLowerCase()
    return campaigns.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (q && !`${c.name} ${c.description ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [campaigns, search, statusFilter])

  const totals = useMemo(() => {
    const base = { campaigns: 0, invited: 0, submitted: 0, completed: 0, active: 0 }
    if (!campaigns) return base
    return campaigns.reduce((acc, c) => {
      acc.campaigns += 1
      acc.invited += c.invited_count
      acc.submitted += c.submitted_count
      acc.completed += c.completed_count
      if (c.status === 'active') acc.active += 1
      return acc
    }, base)
  }, [campaigns])

  function resetForm() {
    setName('')
    setDescription('')
    setFilterKind('expiring')
    setFormError(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setFormError('Campaign name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.createCampaign({
        name: name.trim(),
        description: description.trim() || undefined,
        filter_kind: filterKind,
      })
      setCreateOpen(false)
      resetForm()
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create campaign')
    } finally {
      setSaving(false)
    }
  }

  if (campaigns === null) return <FullPageSpinner label="Loading campaigns..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Recertification Campaigns</h1>
          <p className="mt-1 text-sm text-slate-400">
            Batch-request fresh W-8/W-9 forms from payees whose certifications are expiring or missing.
          </p>
        </div>
        <Button onClick={() => { resetForm(); setCreateOpen(true) }}>+ New campaign</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Campaigns" value={totals.campaigns} hint={`${totals.active} active`} />
        <Stat label="Payees invited" value={totals.invited.toLocaleString()} />
        <Stat label="Forms submitted" value={totals.submitted.toLocaleString()} tone="green" />
        <Stat
          label="Completed"
          value={totals.completed.toLocaleString()}
          hint={totals.invited ? `${Math.round((totals.completed / totals.invited) * 100)}% of invited` : undefined}
          tone="green"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {['all', 'draft', 'active', 'completed'].map((s) => (
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
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns..."
            className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {error && (
            <div className="m-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={campaigns.length === 0 ? 'No campaigns yet' : 'No campaigns match your filters'}
                description={
                  campaigns.length === 0
                    ? 'Launch a recertification campaign to chase down expiring or missing tax forms.'
                    : 'Try adjusting your search or status filter.'
                }
                icon="📣"
                action={
                  campaigns.length === 0 ? (
                    <Button onClick={() => { resetForm(); setCreateOpen(true) }}>Create your first campaign</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {filtered.map((c) => {
                const pct = progressPct(c)
                return (
                  <li key={c.id} className="px-5 py-4 transition-colors hover:bg-slate-900/60">
                    <Link href={`/dashboard/campaigns/${c.id}`} className="block">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-semibold text-white">{c.name}</span>
                            <Badge tone={STATUS_TONE[c.status] ?? 'slate'}>{c.status}</Badge>
                            <Badge tone={FILTER_TONE[c.filter_kind] ?? 'slate'}>{c.filter_kind}</Badge>
                          </div>
                          {c.description && (
                            <p className="mt-1 line-clamp-1 max-w-xl text-sm text-slate-400">{c.description}</p>
                          )}
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          Updated {new Date(c.updated_at).toLocaleDateString()}
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-4 gap-3 text-center">
                        <FunnelCell label="Invited" value={c.invited_count} />
                        <FunnelCell label="Opened" value={c.opened_count} tone="text-sky-300" />
                        <FunnelCell label="Submitted" value={c.submitted_count} tone="text-amber-300" />
                        <FunnelCell label="Completed" value={c.completed_count} tone="text-emerald-300" />
                      </div>

                      <div className="mt-3 flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs font-medium tabular-nums text-slate-400">{pct}%</span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New recertification campaign"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="create-campaign-form" disabled={saving}>
              {saving ? <Spinner label="Creating..." /> : 'Create campaign'}
            </Button>
          </>
        }
      >
        <form id="create-campaign-form" onSubmit={handleCreate} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q3 2026 W-9 recertification"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Short note about why this batch is going out."
              className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Target audience</label>
            <div className="space-y-2">
              {FILTER_KINDS.map((f) => (
                <label
                  key={f.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors ${
                    filterKind === f.value
                      ? 'border-emerald-500/60 bg-emerald-500/10'
                      : 'border-slate-700 bg-slate-950 hover:border-slate-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="filter_kind"
                    value={f.value}
                    checked={filterKind === f.value}
                    onChange={() => setFilterKind(f.value)}
                    className="mt-1 accent-emerald-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-200">{f.label}</span>
                    <span className="block text-xs text-slate-500">{f.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function FunnelCell({ label, value, tone = 'text-slate-200' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-950/60 py-2">
      <div className={`text-lg font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  )
}
