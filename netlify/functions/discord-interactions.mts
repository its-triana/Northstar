// Discord interactions endpoint (Netlify Function).
// Every button click, modal submit and slash command lands here as an HTTPS
// POST from Discord. Signature-verified with the app public key, then routed.
// Supabase is the single source of truth; the card is edited in place so the
// message IS the tracker row (PRD §12).
import { verifyKey } from 'discord-interactions';
import { createClient } from '@supabase/supabase-js';

const IT = { PING: 1, COMMAND: 2, COMPONENT: 3, MODAL: 5 } as const;
const RT = {
  PONG: 1,
  REPLY: 4, // channel message
  UPDATE_MESSAGE: 7, // edit the message the component is on
  MODAL: 9,
} as const;
const EPHEMERAL = 64;

const sb = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false },
  });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const ephemeral = (content: string) =>
  json({ type: RT.REPLY, data: { content, flags: EPHEMERAL } });

// ---------------------------------------------------------------------------
export default async (req: Request): Promise<Response> => {
  const signature = req.headers.get('x-signature-ed25519') ?? '';
  const timestamp = req.headers.get('x-signature-timestamp') ?? '';
  const raw = await req.text();

  const valid = await verifyKey(raw, signature, timestamp, process.env.DISCORD_PUBLIC_KEY!);
  if (!valid) return new Response('invalid request signature', { status: 401 });

  const i = JSON.parse(raw);
  if (i.type === IT.PING) return json({ type: RT.PONG });

  try {
    if (i.type === IT.COMPONENT) return await onComponent(i);
    if (i.type === IT.MODAL) return await onModal(i);
    if (i.type === IT.COMMAND) return await onCommand(i);
  } catch (err) {
    console.error('interaction failed:', err);
    return ephemeral(`⚠️ That didn't stick: ${(err as Error).message}`);
  }
  return ephemeral('Unhandled interaction.');
};

// ---- buttons ---------------------------------------------------------------
async function onComponent(i: any): Promise<Response> {
  const [ns, action, id] = String(i.data.custom_id).split(':');

  if (ns === 'job' && action === 'applied') return applyToJob(i, id);
  if (ns === 'job' && action === 'dismiss') {
    return json({
      type: RT.MODAL,
      data: {
        custom_id: `dismiss:${id}`,
        title: 'Why dismiss? (trains the scorer)',
        components: [textRow('reason', 'Reason — required', true)],
      },
    });
  }
  if (ns === 'job' && action === 'details') return showDetails(i, id);
  if (ns === 'pl' && action === 'status') {
    return json({
      type: RT.MODAL,
      data: {
        custom_id: `plstatus:${id}`,
        title: 'Update status',
        components: [
          textRow('status', 'applied|interviewing|offer|rejected|ghosted', true),
          textRow('note', 'Note (optional)', false, true),
        ],
      },
    });
  }
  if (ns === 'pl' && action === 'note') {
    return json({
      type: RT.MODAL,
      data: {
        custom_id: `plnote:${id}`,
        title: 'Add note',
        components: [textRow('note', 'Note', true, true)],
      },
    });
  }
  if (ns === 'co') return decideCompany(i, action, id);
  return ephemeral('Unknown button.');
}

async function applyToJob(i: any, jobId: string): Promise<Response> {
  const db = sb();
  const now = new Date().toISOString();
  const { data: job, error } = await db
    .from('jobs')
    .update({ status: 'applied', applied_at: now, last_touched_at: now })
    .eq('id', jobId)
    .select('title, url, companies(name)')
    .single();
  if (error) throw new Error(error.message);
  await db.from('application_events').insert({
    job_id: jobId, event_type: 'status_change', from_status: 'notified', to_status: 'applied',
  });

  // Copy the card to #pipeline with tracker buttons (the card moves; PRD §12).
  const pipelineChannel = process.env.DISCORD_CHANNEL_PIPELINE;
  if (pipelineChannel) {
    const embeds = i.message.embeds ?? [];
    const res = await botPost(`/channels/${pipelineChannel}/messages`, {
      embeds: restamp(embeds, 0x2ecc71, '✅ Applied'),
      components: [{ type: 1, components: [
        btn(`pl:status:${jobId}`, 'Update status', 1),
        btn(`pl:note:${jobId}`, 'Add note', 2),
      ]}],
    });
    await db.from('jobs').update({ discord_message_id: `${pipelineChannel}:${res.id}` }).eq('id', jobId);
  }

  // Rewrite the digest card in place: badge swap, buttons gone.
  return json({
    type: RT.UPDATE_MESSAGE,
    data: { embeds: restamp(i.message.embeds ?? [], 0x2ecc71, '✅ Applied — moved to #pipeline'), components: [] },
  });
}

async function showDetails(i: any, jobId: string): Promise<Response> {
  const db = sb();
  const { data: job, error } = await db
    .from('jobs')
    .select('title, fit_reasons, company_id, companies(name)')
    .eq('id', jobId).single();
  if (error) throw new Error(error.message);
  const { data: intel } = await db.from('company_intel').select('*').eq('company_id', job.company_id).maybeSingle();

  const s = (job.fit_reasons ?? {}) as Record<string, any>;
  const lines: string[] = [];
  const co = (job.companies as any)?.name ?? '?';
  if (s.strengths?.length) lines.push(`**Strengths**\n${s.strengths.map((x: string) => `• ${x}`).join('\n')}`);
  if (s.gaps?.length) lines.push(`**Gaps**\n${s.gaps.map((x: string) => `• ${x}`).join('\n')}`);
  if (s.lead_case_study) lines.push(`**Lead case study**\n${s.lead_case_study}`);
  if (s.resume_edits?.length) lines.push(`**Resume edits**\n${s.resume_edits.map((x: string) => `• ${x}`).join('\n')}`);
  if (intel) {
    const cq = (k: string, label: string) => {
      const v = intel[k];
      return v ? `• ${label}: **${v.verdict}** (${v.confidence})${v.evidence?.length ? ` — ${v.evidence[0]}` : ''}` : null;
    };
    const culture = [
      cq('weekend_work', 'Weekend work'), cq('six_day_week', 'Six-day week'),
      cq('micromanagement', 'Micromanagement'), cq('politics_leadership', 'Politics/leadership'),
      cq('wlb', 'Work-life balance'),
    ].filter(Boolean).join('\n');
    lines.push(`**Dossier — ${co}**\n${culture}`);
    if (intel.salary_band_senior) lines.push(`**Senior band:** ${intel.salary_band_senior}`);
    if (intel.reddit_summary) lines.push(`**Reddit:** ${intel.reddit_summary}`);
    if ((intel.sources ?? []).length) lines.push(`**Sources**\n${(intel.sources as string[]).slice(0, 5).join('\n')}`);
  }

  // Thread on the card, full detail inside.
  const ref = `${i.channel_id}:${i.message.id}`;
  const thread = await botPost(`/channels/${i.channel_id}/messages/${i.message.id}/threads`, {
    name: `${co} — details`.slice(0, 100), auto_archive_duration: 10080,
  });
  const content = lines.join('\n\n');
  for (const chunk of content.match(/[\s\S]{1,1900}/g) ?? []) {
    await botPost(`/channels/${thread.id}/messages`, { content: chunk });
  }
  return ephemeral(`🧵 Details expanded in the thread on that card.`);
}

async function decideCompany(i: any, action: string, companyId: string): Promise<Response> {
  const db = sb();
  const status = action === 'approve' ? 'active' : 'rejected';
  const patch: Record<string, unknown> = { status };
  if (status === 'active') patch.tier = 3; // approved discoveries start at tier 3 polling
  const { data: co, error } = await db.from('companies').update(patch).eq('id', companyId).select('name').single();
  if (error) throw new Error(error.message);
  const badge = status === 'active' ? `✅ Approved — ${co.name} is now polled` : `🚫 Rejected — ${co.name} won't surface again`;
  return json({
    type: RT.UPDATE_MESSAGE,
    data: { embeds: restamp(i.message.embeds ?? [], status === 'active' ? 0x2ecc71 : 0x95a5a6, badge), components: [] },
  });
}

// ---- modals ----------------------------------------------------------------
async function onModal(i: any): Promise<Response> {
  const [kind, id] = String(i.data.custom_id).split(':');
  const values = modalValues(i);
  const db = sb();
  const now = new Date().toISOString();

  if (kind === 'dismiss') {
    const reason = values.reason?.trim();
    if (!reason) return ephemeral('A reason is required — it is the only training data the scorer gets.');
    await db.from('jobs').update({ status: 'dismissed', dismiss_reason: reason, last_touched_at: now }).eq('id', id);
    await db.from('application_events').insert({ job_id: id, event_type: 'status_change', to_status: 'dismissed', note: reason });
    return json({
      type: RT.UPDATE_MESSAGE,
      data: { embeds: restamp(i.message?.embeds ?? [], 0x95a5a6, `🗑 Dismissed — ${reason.slice(0, 80)}`), components: [] },
    });
  }
  if (kind === 'plstatus') {
    const status = values.status?.trim().toLowerCase();
    const allowed = ['applied', 'interviewing', 'offer', 'rejected', 'ghosted'];
    if (!allowed.includes(status)) return ephemeral(`Status must be one of: ${allowed.join(', ')}`);
    await db.from('jobs').update({ status, last_touched_at: now }).eq('id', id);
    await db.from('application_events').insert({ job_id: id, event_type: 'status_change', to_status: status, note: values.note || null });
    const colors: Record<string, number> = { applied: 0x2ecc71, interviewing: 0x3498db, offer: 0xf1c40f, rejected: 0xe74c3c, ghosted: 0x95a5a6 };
    return json({
      type: RT.UPDATE_MESSAGE,
      data: { embeds: restamp(i.message?.embeds ?? [], colors[status], `${statusEmoji(status)} ${status[0].toUpperCase()}${status.slice(1)}`),
        components: i.message?.components ?? [] },
    });
  }
  if (kind === 'plnote') {
    if (!values.note?.trim()) return ephemeral('Empty note.');
    await db.from('jobs').update({ last_touched_at: now }).eq('id', id);
    await db.from('application_events').insert({ job_id: id, event_type: 'note', note: values.note.trim() });
    return ephemeral('📝 Note saved.');
  }
  return ephemeral('Unknown modal.');
}

// ---- slash commands --------------------------------------------------------
async function onCommand(i: any): Promise<Response> {
  const name = i.data.name;
  const db = sb();

  if (name === 'pipeline') {
    const { data } = await db
      .from('jobs')
      .select('title, status, last_touched_at, companies(name)')
      .in('status', ['applied', 'interviewing', 'offer'])
      .order('last_touched_at', { ascending: false })
      .limit(25);
    if (!data?.length) return ephemeral('Pipeline is empty — nothing applied yet.');
    const lines = data.map((j: any) => {
      const days = j.last_touched_at ? Math.floor((Date.now() - Date.parse(j.last_touched_at)) / 86_400_000) : '?';
      return `${statusEmoji(j.status)} **${j.companies?.name}** — ${j.title} · ${j.status} · ${days}d`;
    });
    return ephemeral(`**Pipeline (${data.length})**\n${lines.join('\n')}`);
  }

  if (name === 'company') {
    const q = i.data.options?.find((o: any) => o.name === 'name')?.value ?? '';
    const { data: cos } = await db.from('companies').select('id, name').ilike('name', `%${q}%`).limit(1);
    if (!cos?.length) return ephemeral(`No company matching "${q}".`);
    const { data: intel } = await db.from('company_intel').select('*').eq('company_id', cos[0].id).maybeSingle();
    if (!intel) return ephemeral(`**${cos[0].name}** — no dossier yet. It's built on the next /score run that sees one of its roles.`);
    const cq = (k: string, label: string) => {
      const v = intel[k];
      return v ? `• ${label}: **${v.verdict}** (${v.confidence})` : `• ${label}: —`;
    };
    return ephemeral(
      [
        `**${cos[0].name}** — dossier (refreshed ${String(intel.refreshed_at).slice(0, 10)})`,
        intel.glassdoor_rating ? `Glassdoor ${intel.glassdoor_rating}` : null,
        cq('weekend_work', 'Weekend work'), cq('six_day_week', 'Six-day week'),
        cq('micromanagement', 'Micromanagement'), cq('politics_leadership', 'Politics/leadership'), cq('wlb', 'WLB'),
        intel.salary_band_senior ? `Senior band: ${intel.salary_band_senior}` : null,
        intel.reddit_summary ? `Reddit: ${intel.reddit_summary}` : null,
      ].filter(Boolean).join('\n'),
    );
  }

  if (name === 'status' || name === 'note') {
    const q = i.data.options?.find((o: any) => o.name === 'company')?.value ?? '';
    const { data: jobs } = await db
      .from('jobs')
      .select('id, title, companies!inner(name)')
      .in('status', ['applied', 'interviewing', 'offer', 'notified'])
      .ilike('companies.name', `%${q}%`)
      .order('last_touched_at', { ascending: false })
      .limit(1);
    if (!jobs?.length) return ephemeral(`No active application matching "${q}".`);
    const job = jobs[0] as any;
    return json({
      type: RT.MODAL,
      data: name === 'status'
        ? { custom_id: `plstatus:${job.id}`, title: `${job.companies.name} — update status`,
            components: [textRow('status', 'applied|interviewing|offer|rejected|ghosted', true), textRow('note', 'Note (optional)', false, true)] }
        : { custom_id: `plnote:${job.id}`, title: `${job.companies.name} — add note`,
            components: [textRow('note', 'Note', true, true)] },
    });
  }
  return ephemeral('Unknown command.');
}

// ---- small helpers ---------------------------------------------------------
function textRow(id: string, label: string, required: boolean, paragraph = false) {
  return { type: 1, components: [{ type: 4, custom_id: id, label: label.slice(0, 45), style: paragraph ? 2 : 1, required }] };
}
function btn(custom_id: string, label: string, style: number) {
  return { type: 2, custom_id, label, style };
}
function modalValues(i: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of i.data.components ?? []) for (const c of row.components ?? []) out[c.custom_id] = c.value;
  return out;
}
// Swap the score badge for a status badge by prefixing the first embed.
function restamp(embeds: any[], color: number, badge: string): any[] {
  if (!embeds.length) return [{ description: badge, color }];
  const [first, ...rest] = embeds;
  return [{ ...first, color, fields: [{ name: 'Status', value: badge, inline: false }, ...(first.fields ?? []).filter((f: any) => f.name !== 'Status')] }, ...rest];
}
function statusEmoji(s: string): string {
  return { applied: '✅', interviewing: '🎙', offer: '🎉', rejected: '❌', ghosted: '👻' }[s] ?? '•';
}
async function botPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method: 'POST',
    headers: { authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`discord POST ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
